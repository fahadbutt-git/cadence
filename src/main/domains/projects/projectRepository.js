import fs from 'node:fs';
import path from 'node:path';
import mammoth from 'mammoth';
import JSZip from 'jszip';
import { Document, Packer, Paragraph, TextRun, InsertedTextRun, DeletedTextRun, AlignmentType, HeadingLevel, CommentRangeStart, CommentRangeEnd, CommentReference } from 'docx';
import { trackChanges } from '../../../../public/js/core/textUtils.js';
import { DOCS_DIR, REVISIONS_DIR, ensureDataDirectories } from '../config/configService.js';

const MAX_REVISIONS = 40;
const uid = (prefix = 'p') => `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
const safeId = (id = '') => String(id).replace(/[^a-zA-Z0-9_-]/g, '');
// Ids end up in HTML attributes and file names, so only plain characters are kept.
const cleanId = (id, prefix) => (typeof id === 'string' || typeof id === 'number') && safeId(id).length ? safeId(id).slice(0, 80) : uid(prefix);
const validDate = (d) => (typeof d === 'string' || typeof d === 'number') && !Number.isNaN(new Date(d).getTime()) ? new Date(d).toISOString() : null;
export const httpError = (status, message, extra = {}) => Object.assign(new Error(message), { status, ...extra });

// Older files used mode1 / mode2.
export function normalizeStyle(raw = {}) {
  if (raw.style === 'academic' || raw.style === 'narrative') return raw.style;
  return raw.mode === 'mode2' ? 'academic' : 'narrative';
}

/**
 * Comments: { id, paraId (null for a general comment), quote (optional exact text), at (offset of the quote),
 * text, author, createdAt, resolved }. A comment may point at a paragraph that only exists in the tracked-changes
 * baseline (a deleted paragraph that can still come back), so those ids are kept too.
 */
export function sanitizeComments(list = [], paragraphs = [], keepIds = []) {
  if (!Array.isArray(list)) return [];
  const ids = new Set([...paragraphs.map((p) => p.id), ...keepIds]);
  const seen = new Set();
  return list
    .filter((c) => c && typeof c === 'object' && typeof c.text === 'string' && c.text.trim())
    .map((c) => {
      let id = cleanId(c.id, 'c');
      while (seen.has(id)) id = uid('c');
      seen.add(id);
      const anchored = typeof c.paraId === 'string' && ids.has(c.paraId);
      const out = {
        id,
        paraId: anchored ? c.paraId : null,
        quote: anchored && typeof c.quote === 'string' ? c.quote.slice(0, 2000) : '',
        text: c.text.trim().slice(0, 5000),
        createdAt: validDate(c.createdAt) || new Date().toISOString(),
        resolved: Boolean(c.resolved),
      };
      if (anchored && Number.isInteger(c.at) && c.at >= 0) out.at = c.at;
      if (typeof c.author === 'string' && c.author.trim()) out.author = c.author.trim().slice(0, 80);
      return out;
    })
    .slice(0, 1000);
}

/** Paragraphs from any input: plain ids, unique, known types, string text. */
export function sanitizeParagraphs(list) {
  if (!Array.isArray(list)) return null;
  const seen = new Set();
  return list
    .filter((p) => p && typeof p === 'object')
    .slice(0, 50000)
    .map((p) => {
      let id = cleanId(p.id, 'p');
      while (seen.has(id)) id = uid('p');
      seen.add(id);
      return { id, type: p.type === 'heading' ? 'heading' : 'body', text: typeof p.text === 'string' ? p.text : p.text == null ? '' : String(p.text) };
    });
}

/** Tracked changes: { on, baseline: [{ id, type, text }] | null, startedAt }. */
export function sanitizeTracking(raw) {
  if (!raw || typeof raw !== 'object') return { on: false, baseline: null, startedAt: null };
  const baseline = Array.isArray(raw.baseline) ? sanitizeParagraphs(raw.baseline) : null;
  return { on: Boolean(raw.on), baseline, startedAt: validDate(raw.startedAt) };
}

export function computeWordCount(paragraphs = []) {
  return paragraphs.map((p) => (p.text || '').trim()).join(' ').split(/\s+/).filter(Boolean).length;
}

export function computeDocumentMetadata(raw) {
  const paragraphs = raw.paragraphs || [];
  const bm = raw.bookmark || { paraIndex: 0, sentIndex: 0 };
  const paraIndex = Math.min(Math.max(0, bm.paraIndex || 0), Math.max(0, paragraphs.length - 1));
  const firstBody = paragraphs.find((p) => p.type !== 'heading' && p.text?.trim());
  return {
    id: raw.id,
    title: raw.title,
    style: normalizeStyle(raw),
    wordTarget: raw.wordTarget || null,
    createdAt: raw.createdAt,
    updatedAt: raw.updatedAt,
    paragraphCount: paragraphs.length,
    wordCount: computeWordCount(paragraphs),
    excerpt: (firstBody?.text || '').slice(0, 180),
    bookmark: {
      paraIndex,
      sentIndex: bm.sentIndex || 0,
      snippet: (paragraphs[paraIndex]?.text || '').slice(0, 140),
      updatedAt: bm.updatedAt || raw.updatedAt,
    },
    progressPct: paragraphs.length ? Math.min(100, Math.round((paraIndex / paragraphs.length) * 100)) : 0,
    openComments: (raw.comments || []).filter((c) => !c.resolved).length,
    tracking: Boolean(raw.tracking?.on),
    pendingChanges: raw.tracking?.baseline ? trackChanges(raw.tracking.baseline, paragraphs).hunks.length : 0,
  };
}

function writeJson(file, data) {
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
  fs.renameSync(tmp, file);
}

export function ensureStarterDocuments(docsDir = DOCS_DIR) {
  ensureDataDirectories();
  if (!fs.existsSync(docsDir)) fs.mkdirSync(docsDir, { recursive: true });
  if (fs.readdirSync(docsDir).some((f) => f.endsWith('.json'))) return;
  const now = new Date().toISOString();
  writeJson(path.join(docsDir, 'doc-welcome.json'), {
    id: 'doc-welcome',
    title: 'Getting started with Cadence',
    style: 'narrative',
    wordTarget: null,
    bookmark: { paraIndex: 0, sentIndex: 0, updatedAt: now },
    createdAt: now,
    updatedAt: now,
    paragraphs: [
      { id: 'w-1', type: 'heading', text: 'Getting started' },
      { id: 'w-2', type: 'body', text: 'Click anywhere in this paragraph and press Option and Space to hear it read aloud. Reading starts at your cursor and the current sentence is highlighted as it goes. Press Escape to stop.' },
      { id: 'w-3', type: 'body', text: 'Select a few words to see the edit toolbar. You can listen to the selection, tighten it, clean up stock phrasing, or type an instruction. Suggested edits appear inline so you can accept or reject them in place.' },
      { id: 'w-4', type: 'body', text: 'Press Command, Shift and M, or the Talk button, and speak an instruction such as replace pivotal with important. This sentence is a deliberate example of a pivotal phrase that the checks will flag.' },
      { id: 'w-5', type: 'body', text: 'Your place is saved when you pause, so the library can take you straight back to it next time.' },
    ],
  });
}

export function listDocuments(docsDir = DOCS_DIR) {
  ensureDataDirectories();
  const docs = [];
  for (const f of fs.readdirSync(docsDir).filter((x) => x.endsWith('.json'))) {
    try {
      docs.push(computeDocumentMetadata(JSON.parse(fs.readFileSync(path.join(docsDir, f), 'utf8'))));
    } catch (e) {
      console.warn(`Skipping unreadable document ${f}: ${e.message}`);
    }
  }
  return docs.sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
}

export function getDocumentById(id, docsDir = DOCS_DIR) {
  if (!safeId(id)) return null;
  const file = path.join(docsDir, `${safeId(id)}.json`);
  if (!fs.existsSync(file)) return null;
  const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  return { ...raw, style: normalizeStyle(raw) };
}

export function saveSnapshot(doc, reason = 'Checkpoint', revisionsDir = REVISIONS_DIR) {
  const dir = path.join(revisionsDir, safeId(doc.id));
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const createdAt = new Date().toISOString();
  const revId = `rev-${createdAt.replace(/[:.]/g, '-')}`;
  const snapshot = { revId, docId: doc.id, reason: String(reason || 'Checkpoint').slice(0, 200), createdAt, title: doc.title, paragraphs: doc.paragraphs, comments: doc.comments || [], wordCount: computeWordCount(doc.paragraphs || []) };
  writeJson(path.join(dir, `${revId}.json`), snapshot);
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.json')).sort();
  for (const old of files.slice(0, Math.max(0, files.length - MAX_REVISIONS))) {
    try { fs.unlinkSync(path.join(dir, old)); } catch (e) {}
  }
  return snapshot;
}

/**
 * Save a document. Saves carry the version they were based on (baseVersion). If the file changed since,
 * for example from another window, the save is refused with 409 so nothing is silently overwritten.
 * A save for a document that was deleted elsewhere is refused with 410.
 */
export function upsertDocument(payload = {}, docsDir = DOCS_DIR, revisionsDir = REVISIONS_DIR) {
  ensureDataDirectories();
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw httpError(400, 'Send the document as a JSON object');
  const id = safeId(payload.id) || uid('doc');
  const file = path.join(docsDir, `${id}.json`);
  const existing = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : null;
  const hasBase = payload.baseVersion !== undefined && payload.baseVersion !== null;
  if (hasBase && !existing && payload.id) throw httpError(410, 'This document was deleted in another window.');
  if (hasBase && existing && Number(existing.version || 0) !== Number(payload.baseVersion)) {
    throw httpError(409, 'This document was changed in another window.', { current: { ...existing, style: normalizeStyle(existing) } });
  }
  if (payload.paragraphs !== undefined && !Array.isArray(payload.paragraphs)) throw httpError(400, 'paragraphs must be a list');
  const paragraphs = sanitizeParagraphs(payload.paragraphs) || sanitizeParagraphs(existing?.paragraphs) || [];
  const target = payload.wordTarget !== undefined ? payload.wordTarget : existing?.wordTarget ?? null;
  const bm = payload.bookmark || existing?.bookmark || {};
  const doc = {
    id,
    version: Number(existing?.version || 0) + 1,
    title: String(payload.title ?? existing?.title ?? 'Untitled').trim().slice(0, 300) || 'Untitled',
    style: normalizeStyle({ ...existing, ...payload }),
    wordTarget: Number.isFinite(Number(target)) && Number(target) > 0 ? Math.round(Number(target)) : null,
    bookmark: { paraIndex: Math.max(0, Number(bm.paraIndex) || 0), sentIndex: Math.max(0, Number(bm.sentIndex) || 0), updatedAt: validDate(bm.updatedAt) || new Date().toISOString() },
    createdAt: validDate(existing?.createdAt) || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    paragraphs: paragraphs.length ? paragraphs : [{ id: uid(), type: 'body', text: '' }],
  };
  if (payload.ignored !== undefined || existing?.ignored) {
    const ig = Array.isArray(payload.ignored) ? payload.ignored : existing?.ignored || [];
    doc.ignored = [...new Set(ig.filter((x) => typeof x === 'string' && x.length < 200))].slice(0, 2000);
  }
  doc.tracking = sanitizeTracking(payload.tracking !== undefined ? payload.tracking : existing?.tracking);
  const keepIds = doc.tracking.baseline ? doc.tracking.baseline.map((p) => p.id) : [];
  doc.comments = sanitizeComments(payload.comments !== undefined ? payload.comments : existing?.comments || [], doc.paragraphs, keepIds);
  writeJson(file, doc);
  if (payload.createSnapshot) saveSnapshot(doc, payload.snapshotReason || 'Checkpoint', revisionsDir);
  return doc;
}

export function updateBookmark(docId, { paraIndex = 0, sentIndex = 0 } = {}, docsDir = DOCS_DIR) {
  const doc = getDocumentById(docId, docsDir);
  if (!doc) return null;
  doc.bookmark = { paraIndex: Number(paraIndex) || 0, sentIndex: Number(sentIndex) || 0, updatedAt: new Date().toISOString() };
  writeJson(path.join(docsDir, `${safeId(docId)}.json`), doc);
  return doc.bookmark;
}

export function deleteDocument(docId, docsDir = DOCS_DIR) {
  const file = path.join(docsDir, `${safeId(docId)}.json`);
  if (!fs.existsSync(file)) return false;
  fs.unlinkSync(file);
  return true;
}

export function listRevisions(docId, revisionsDir = REVISIONS_DIR) {
  const dir = path.join(revisionsDir, safeId(docId));
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .sort()
    .reverse()
    .map((f) => {
      try { return JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')); } catch (e) { return null; }
    })
    .filter(Boolean);
}

const decodeEntities = (s) =>
  s.replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&#(\d+);/g, (m, n) => String.fromCodePoint(Number(n))).replace(/&amp;/g, '&');

const SUP = { 0: '⁰', 1: '¹', 2: '²', 3: '³', 4: '⁴', 5: '⁵', 6: '⁶', 7: '⁷', 8: '⁸', 9: '⁹', '-': '⁻', '–': '⁻' };
/** Superscript citation numbers ("excluded²⁶") keep their look in plain text and go back to Word as superscript. */
export function toSuperscript(text = '') {
  return /^[\d,\s\-–]+$/.test(text) ? [...text.replace(/\s+/g, '')].map((c) => SUP[c] ?? c).join('') : text;
}

/**
 * Turn mammoth HTML into paragraphs, keeping headings. Walks the tags so nested list items stay separate,
 * superscript citations are kept, and each table row becomes one line with cells separated by " | ".
 */
export function paragraphsFromHtml(html = '', notes = null) {
  const out = [];
  let buf = '';
  let type = 'body';
  let inSup = 0;
  let supBuf = '';
  let row = null;
  const flush = () => {
    const text = decodeEntities(buf).replace(/\s+/g, ' ').trim();
    if (text) {
      if (row) row.push(text);
      else out.push({ id: uid(), type, text });
    }
    buf = '';
    type = 'body';
  };
  for (const m of html.matchAll(/<(\/?)([a-z0-9]+)[^>]*?(\/?)>|([^<]+)/gi)) {
    if (m[4] !== undefined) { if (inSup) supBuf += m[4]; else buf += m[4]; continue; }
    const close = m[1] === '/';
    const tag = m[2].toLowerCase();
    if (tag === 'sup') {
      if (!close) { inSup++; supBuf = ''; } else { inSup = Math.max(0, inSup - 1); buf += toSuperscript(decodeEntities(supBuf)); supBuf = ''; }
    } else if (tag === 'br') buf += ' ';
    else if (tag === 'table' && !close && notes) notes.add('Tables were turned into lines of text, one per row.');
    else if (tag === 'tr') { if (!close) row = []; else { flush(); const r = row; row = null; if (r.length) out.push({ id: uid(), type: 'body', text: r.join(' | ') }); } }
    else if (/^(p|li|h[1-6]|td|th)$/.test(tag)) {
      flush();
      if (!close && tag.startsWith('h')) type = 'heading';
    } else if (/^(ul|ol)$/.test(tag)) flush();
  }
  flush();
  return out;
}

/** Strip Markdown emphasis markers that would otherwise stay in the text. */
const unmark = (t) => t.replace(/\*\*(.+?)\*\*|__(.+?)__/g, '$1$2').replace(/(^|[\s(])[*_](\S.*?\S|\S)[*_](?=[\s).,;:!?]|$)/g, '$1$2').replace(/`([^`]+)`/g, '$1');

/**
 * Plain text or Markdown. Blank lines separate paragraphs. A line that starts a heading, a list item or a table
 * row starts a new paragraph even without a blank line, so reference lists stay one reference per paragraph.
 */
export function paragraphsFromText(raw = '') {
  const lines = String(raw).replace(/^﻿/, '').replace(/\r\n?/g, '\n').split('\n');
  const out = [];
  let cur = [];
  const push = () => {
    const t = cur.join(' ').replace(/\s+/g, ' ').trim();
    cur = [];
    if (!t) return;
    if (/^#{1,6}\s/.test(t)) out.push({ id: uid(), type: 'heading', text: unmark(t.replace(/^#{1,6}\s+/, '').replace(/\s+#+$/, '')) });
    else out.push({ id: uid(), type: 'body', text: unmark(t) });
  };
  for (const line of lines) {
    const l = line.trim();
    if (!l) { push(); continue; }
    if (/^\|?\s*:?-{3,}/.test(l) && l.includes('-') && /^[|:\-\s]+$/.test(l)) continue; // table divider
    if (/^#{1,6}\s/.test(l) || /^([-*+]|\d+[.)])\s+/.test(l) || l.startsWith('|')) {
      push();
      cur.push(l.startsWith('|') ? l.replace(/^\||\|$/g, '').split('|').map((c) => c.trim()).join(' | ') : l.replace(/^[-*+]\s+/, ''));
      continue;
    }
    cur.push(l);
  }
  push();
  return out;
}

/** Read a text file whatever its encoding: UTF-8, UTF-16 (Windows "Unicode"), or Windows-1252. */
export function decodeText(buf) {
  if (buf[0] === 0xff && buf[1] === 0xfe) return new TextDecoder('utf-16le').decode(buf.subarray(2));
  if (buf[0] === 0xfe && buf[1] === 0xff) return new TextDecoder('utf-16be').decode(buf.subarray(2));
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buf).replace(/^﻿/, '');
  } catch (e) {
    return new TextDecoder('windows-1252').decode(buf);
  }
}

const STYLE_MAP = ["p[style-name='Title'] => h1:fresh", "p[style-name='Subtitle'] => h2:fresh"];

/** A copy of a .docx with every tracked change rejected: insertions removed, deletions restored. */
async function rejectedDocx(buffer) {
  const zip = await JSZip.loadAsync(buffer);
  const xml = await zip.file('word/document.xml').async('string');
  const rejected = xml
    .replace(/<w:ins\b[^>]*\/>/g, '')
    .replace(/<w:ins\b[^>]*>[\s\S]*?<\/w:ins>/g, '')
    .replace(/<w:del\b[^>]*\/>/g, '')
    .replace(/<w:del\b[^>]*>([\s\S]*?)<\/w:del>/g, '$1')
    .replace(/<w:moveTo\b[^>]*>[\s\S]*?<\/w:moveTo>/g, '')
    .replace(/<w:moveFrom\b[^>]*>([\s\S]*?)<\/w:moveFrom>/g, '$1')
    .replace(/<w:(moveFromRangeStart|moveFromRangeEnd|moveToRangeStart|moveToRangeEnd)\b[^>]*\/>/g, '')
    .replace(/<w:delText\b/g, '<w:t').replace(/<\/w:delText>/g, '</w:t>');
  zip.file('word/document.xml', rejected);
  return { buffer: await zip.generateAsync({ type: 'nodebuffer' }), hasChanges: rejected !== xml };
}

const words = (t) => new Set(String(t).toLowerCase().match(/[\p{L}\p{N}]+/gu) || []);
function similarity(x, y) {
  const a = words(x);
  const b = words(y);
  if (!a.size && !b.size) return 1;
  let both = 0;
  for (const w of a) if (b.has(w)) both++;
  return both / Math.max(a.size, b.size);
}

/**
 * Give baseline paragraphs the ids of the matching current paragraphs, so the differences become tracked changes.
 * Identical paragraphs match first (in order, then anywhere, which shows as a move), then the most similar ones.
 */
export function alignBaseline(baseline, current) {
  const out = baseline.map((p) => ({ ...p }));
  const match = new Array(baseline.length).fill(-1);
  const used = new Set();
  // 1. Identical text, in order.
  let j = 0;
  baseline.forEach((p, i) => {
    for (let k = j; k < current.length; k++) if (!used.has(k) && current[k].text === p.text) { match[i] = k; used.add(k); j = k + 1; break; }
  });
  // 2. Identical text anywhere (a moved paragraph).
  baseline.forEach((p, i) => {
    if (match[i] >= 0) return;
    const k = current.findIndex((c, idx) => !used.has(idx) && c.text === p.text);
    if (k >= 0) { match[i] = k; used.add(k); }
  });
  // 3. The most similar remaining paragraph, if they share at least half their words.
  const pairs = [];
  baseline.forEach((p, i) => {
    if (match[i] >= 0) return;
    current.forEach((c, k) => { if (!used.has(k)) pairs.push([similarity(p.text, c.text), i, k]); });
  });
  pairs.sort((x, y) => y[0] - x[0]);
  for (const [score, i, k] of pairs) {
    if (score < 0.5) break;
    if (match[i] >= 0 || used.has(k)) continue;
    match[i] = k;
    used.add(k);
  }
  match.forEach((k, i) => { if (k >= 0) out[i].id = current[k].id; });
  return out;
}

export async function importDocumentFromFile(filePath, originalName, docsDir = DOCS_DIR, revisionsDir = REVISIONS_DIR) {
  const ext = path.extname(originalName);
  const lower = ext.toLowerCase();
  let paragraphs;
  let comments = [];
  let tracking;
  const notes = new Set();
  if (lower === '.docx') {
    const buffer = fs.readFileSync(filePath);
    let value;
    try {
      ({ value } = await mammoth.convertToHtml({ buffer }, { styleMap: STYLE_MAP }));
    } catch (e) {
      throw httpError(400, 'This Word file could not be read. It may be damaged. Open it in Word and save it again, then import.');
    }
    paragraphs = paragraphsFromHtml(value, notes);
    try {
      comments = commentsForParagraphs(await extractDocxComments(buffer), paragraphs);
    } catch (e) {
      comments = [];
    }
    try {
      const rej = await rejectedDocx(buffer);
      if (rej.hasChanges) {
        const base = paragraphsFromHtml((await mammoth.convertToHtml({ buffer: rej.buffer }, { styleMap: STYLE_MAP })).value);
        tracking = { on: true, baseline: alignBaseline(base, paragraphs), startedAt: new Date().toISOString() };
        notes.add('The file had tracked changes. They are kept as tracked changes for you to accept or reject.');
      }
    } catch (e) {
      notes.add('The file had tracked changes that could not be read, so they were accepted.');
    }
    const xml = await (await JSZip.loadAsync(buffer)).file('word/document.xml').async('string');
    // Formatting inside body paragraphs (not headings, which are bold anyway) is dropped, so say so.
    const bodyParas = [...xml.matchAll(/<w:p\b(?:(?!<w:p\b)[\s\S])*?<\/w:p>/g)].map((m) => m[0]).filter((x) => !/<w:pStyle w:val="(Heading|Title|Subtitle)/i.test(x));
    if (bodyParas.some((x) => /<w:r>\s*<w:rPr>[\s\S]*?<w:(b|i|u)\b(?![^>]*w:val="(0|false|none)")[\s\S]*?<\/w:rPr>/.test(x) || /<w:rPr>(?:(?!<\/w:rPr>)[\s\S])*<w:(b|i|u)\b(?![^>]*w:val="(0|false|none)")/.test(x.replace(/<w:pPr>[\s\S]*?<\/w:pPr>/, '')))) {
      notes.add('Bold, italic and underline are not kept. Cadence works with plain text.');
    }
    if (/<w:numPr>/.test(xml)) notes.add('Bullets and numbering are not kept. List items come in as separate paragraphs.');
  } else if (['.txt', '.md', '.markdown'].includes(lower)) {
    paragraphs = paragraphsFromText(decodeText(fs.readFileSync(filePath)));
  } else {
    throw httpError(400, 'Use a .docx, .txt or .md file');
  }
  const doc = upsertDocument(
    {
      title: path.basename(originalName, ext).slice(0, 200) || 'Untitled',
      style: 'narrative',
      paragraphs: paragraphs.length ? paragraphs : [{ id: uid(), type: 'body', text: '' }],
      comments,
      tracking,
      createSnapshot: true,
      snapshotReason: `Imported ${originalName}`,
    },
    docsDir,
    revisionsDir
  );
  return { ...doc, notices: [...notes] };
}

const SUP_RUN = /^[⁰¹²³⁴⁵⁶⁷⁸⁹⁻,]+$/;
const SUP_SPLIT = /([⁰¹²³⁴⁵⁶⁷⁸⁹⁻](?:[⁰¹²³⁴⁵⁶⁷⁸⁹⁻,]*[⁰¹²³⁴⁵⁶⁷⁸⁹⁻])?)/;
const FROM_SUP = Object.fromEntries(Object.entries({ 0: '⁰', 1: '¹', 2: '²', 3: '³', 4: '⁴', 5: '⁵', 6: '⁶', 7: '⁷', 8: '⁸', 9: '⁹', '-': '⁻' }).map(([k, v]) => [v, k]));
const fromSuperscript = (t) => [...t].map((c) => FROM_SUP[c] ?? c).join('');

/** Character ranges [start, end) for each comment inside a paragraph's text. Unmatched quotes cover the paragraph. */
export function commentRanges(text = '', comments = []) {
  return comments.map((c) => {
    // Use the stored position when the quote is still there, so the second "the" stays the second one.
    const at = !c.quote ? -1 : Number.isInteger(c.at) && text.slice(c.at, c.at + c.quote.length) === c.quote ? c.at : text.indexOf(c.quote);
    return at >= 0 ? { c, start: at, end: at + c.quote.length } : { c, start: 0, end: text.length };
  });
}

/**
 * Runs for one paragraph. segments come from diffSegments (offsets in the current text); deleted
 * segments have zero width. Comment ranges use current-text offsets.
 */
function buildRuns(text, segments, ranges, idOf, mk) {
  const out = [];
  const done = new Set();
  const markers = (at) => {
    if (done.has(at)) return;
    done.add(at);
    for (const r of ranges.filter((x) => x.end === at && x.start !== at)) {
      out.push(new CommentRangeEnd(idOf(r.c)));
      out.push(new TextRun({ children: [new CommentReference(idOf(r.c))] }));
    }
    for (const r of ranges.filter((x) => x.start === at)) out.push(new CommentRangeStart(idOf(r.c)));
    for (const r of ranges.filter((x) => x.start === at && x.end === at)) {
      out.push(new CommentRangeEnd(idOf(r.c)));
      out.push(new TextRun({ children: [new CommentReference(idOf(r.c))] }));
    }
  };
  const cuts = [...new Set([0, text.length, ...ranges.flatMap((r) => [r.start, r.end])])].sort((a, b) => a - b);
  const segs = segments && segments.length ? segments : text ? [{ type: 'same', text, curStart: 0, curEnd: text.length }] : [];
  for (const seg of segs) {
    if (seg.type === 'del') {
      markers(seg.curStart);
      out.push(...[].concat(mk(seg.text, 'del')));
      continue;
    }
    const points = [seg.curStart, ...cuts.filter((c) => c > seg.curStart && c < seg.curEnd), seg.curEnd];
    for (let i = 0; i < points.length - 1; i++) {
      markers(points[i]);
      out.push(...[].concat(mk(text.slice(points[i], points[i + 1]), seg.type)));
    }
  }
  markers(text.length);
  for (const at of cuts) markers(at);
  return out;
}

/**
 * Word export. With tracking.baseline set and showChanges on, edits since tracking started are
 * written as real tracked insertions and deletions that the reader can accept or reject in Word.
 */
export async function generateCleanDocxBuffer({ title = 'Document', paragraphs = [], fontFamily = 'Arial', doubleSpaced = true, comments = [], author = 'Reviewer', baseline = null, changesDate = null }) {
  const line = doubleSpaced ? 480 : 276;
  const open = (comments || []).filter((c) => c && c.text && !c.resolved);
  const ids = new Map(open.map((c, i) => [c.id, i]));
  const idOf = (c) => ids.get(c.id);
  const firstId = paragraphs[0]?.id;
  const who = author || 'Reviewer';
  const date = new Date(changesDate || Date.now()).toISOString().replace(/\.\d+Z$/, 'Z');
  let rev = 1000;
  const tracked = baseline ? trackChanges(baseline, paragraphs) : null;
  const byId = new Map((tracked?.paragraphs || []).map((p) => [p.id, p]));

  // mark: 'ins' or 'del' tracks the paragraph mark itself, so a whole paragraph appears or goes on accept.
  const para = (type, kids, mark = null) =>
    new Paragraph({
      alignment: AlignmentType.LEFT,
      heading: type === 'heading' ? HeadingLevel.HEADING_1 : undefined,
      spacing: { line, after: 0 },
      run: mark === 'ins' ? { insertion: { id: rev++, author: who, date } } : mark === 'del' ? { deletion: { id: rev++, author: who, date } } : undefined,
      children: kids,
    });
  // Superscript citation characters become real superscript digits again.
  const runMaker = (type) => (t, kind) =>
    t.split(SUP_SPLIT).filter((x) => x !== '').map((piece) => {
      const sup = SUP_RUN.test(piece);
      const props = { text: sup ? fromSuperscript(piece) : piece, font: fontFamily, size: 24, bold: type === 'heading', color: '000000', superScript: sup || undefined };
      if (kind === 'ins') return new InsertedTextRun({ ...props, id: rev++, author: who, date });
      if (kind === 'del') return new DeletedTextRun({ ...props, id: rev++, author: who, date });
      return new TextRun(props);
    });
  // Deleted paragraphs, and the old place of moved ones, are written as deleted text with a deleted paragraph mark.
  const lastId = paragraphs[paragraphs.length - 1]?.id;
  // Comments on a paragraph that is deleted (or joined away) stay on its struck-through text.
  const curIds = new Set(paragraphs.map((p) => p.id));
  const delIds = new Set((tracked?.deleted || []).map((d) => d.id));
  const placed = (c) => !c.paraId || curIds.has(c.paraId) || delIds.has(c.paraId);
  const deletedAfter = (afterId) =>
    (tracked?.deleted || []).filter((d) => d.afterId === afterId && d.text.trim()).map((d) => {
      const runs = runMaker(d.type)(d.text, 'del');
      const mine = open.filter((c) => c.paraId === d.id);
      const kids = mine.length
        ? [...mine.map((c) => new CommentRangeStart(idOf(c))), ...runs, ...mine.flatMap((c) => [new CommentRangeEnd(idOf(c)), new TextRun({ children: [new CommentReference(idOf(c))] })])]
        : runs;
      return para(d.type, kids, afterId === lastId && afterId ? null : 'del');
    });

  const children = [...deletedAfter(null)];
  for (const p of paragraphs) {
    // Comments whose paragraph is gone entirely go on the first paragraph, like general comments.
    const mine = open.filter((c) => c.paraId === p.id || ((!c.paraId || !placed(c)) && p.id === firstId));
    const ranges = commentRanges(p.text || '', mine).map((r) => (r.c.paraId === p.id ? r : { ...r, start: 0, end: (p.text || '').length }));
    const info = byId.get(p.id);
    const moved = info?.moved;
    const segs = moved ? (p.text ? [{ type: 'ins', text: p.text, curStart: 0, curEnd: p.text.length }] : []) : info?.segments;
    // A deletion after the last paragraph cannot carry its own paragraph mark, so the mark before it is deleted.
    const trailing = tracked && p.id === lastId && tracked.deleted.some((d) => d.afterId === lastId && d.text.trim());
    children.push(para(p.type, buildRuns(p.text || '', segs, ranges, idOf, runMaker(p.type)), info?.status === 'inserted' || moved ? 'ins' : trailing ? 'del' : null));
    if (tracked) children.push(...deletedAfter(p.id));
  }
  const initials = who.split(/\s+/).map((w) => w[0]).join('').slice(0, 3).toUpperCase();
  const doc = new Document({
    creator: '',
    lastModifiedBy: '',
    title: title || 'Document',
    description: '',
    styles: { default: { document: { run: { font: fontFamily, size: 24 } } } },
    comments: {
      children: open.map((c) => ({
        id: idOf(c),
        author: c.author || who,
        initials: c.author ? c.author.split(/\s+/).map((w) => w[0]).join('').slice(0, 3).toUpperCase() : initials,
        date: new Date(c.createdAt || Date.now()),
        children: [new Paragraph({ children: [new TextRun({ text: c.paraId && placed(c) ? c.text : `General comment: ${c.text}` })] })],
      })),
    },
    // Letter size with one-inch margins, as Canadian and US programs expect.
    sections: [{ properties: { page: { size: { width: 12240, height: 15840 }, margin: { top: 1440, bottom: 1440, left: 1440, right: 1440 } } }, children }],
  });
  return Packer.toBuffer(doc);
}


// ---------- Word comments on import ----------

const xmlText = (s = '') => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
const squash = (s = '') => s.replace(/\s+/g, ' ').trim();

/** Read comments from a .docx: [{ author, date, text, paraText, occurrence, quote, at }]. */
export async function extractDocxComments(buffer) {
  const zip = await JSZip.loadAsync(buffer);
  const commentsXml = await zip.file('word/comments.xml')?.async('string');
  const docXml = await zip.file('word/document.xml')?.async('string');
  if (!commentsXml || !docXml) return [];
  const notes = new Map();
  for (const m of commentsXml.matchAll(/<w:comment\b([^>]*)>([\s\S]*?)<\/w:comment>/g)) {
    const id = (m[1].match(/w:id="([^"]+)"/) || [])[1];
    const author = xmlText((m[1].match(/w:author="([^"]*)"/) || [])[1] || '');
    const date = (m[1].match(/w:date="([^"]*)"/) || [])[1] || '';
    const paras = [...m[2].matchAll(/<w:p\b[\s\S]*?<\/w:p>/g)].map((p) => [...p[0].matchAll(/<w:t\b[^>]*>([^<]*)<\/w:t>/g)].map((t) => xmlText(t[1])).join(''));
    notes.set(id, { author, date, text: squash(paras.join(' ')) });
  }
  const found = new Map();
  const open = new Map(); // comments that started in an earlier paragraph
  const seenText = new Map();
  for (const pm of docXml.matchAll(/<w:p\b(?:(?!<w:p\b)[\s\S])*?<\/w:p>/g)) {
    let text = '';
    const starts = new Map();
    const ends = new Map();
    for (const tok of pm[0].matchAll(/<w:r\b[^>]*>([\s\S]*?)<\/w:r>|<w:commentRangeStart\b[^>]*w:id="([^"]+)"|<w:commentRangeEnd\b[^>]*w:id="([^"]+)"/g)) {
      if (tok[1] !== undefined) {
        const run = tok[1];
        const ref = run.match(/<w:commentReference\b[^>]*w:id="([^"]+)"/);
        if (ref && !starts.has(ref[1]) && !found.has(ref[1]) && !open.has(ref[1])) starts.set(ref[1], 0);
        const sup = /<w:vertAlign\b[^>]*w:val="superscript"/.test(run);
        let piece = '';
        for (const t of run.matchAll(/<w:t\b[^>]*>([^<]*)<\/w:t>|<w:tab\b[^>]*\/>|<w:br\b[^>]*\/>/g)) piece += t[1] !== undefined ? xmlText(t[1]) : ' ';
        text += sup ? toSuperscript(piece) : piece;
      } else if (tok[2] !== undefined) starts.set(tok[2], text.length);
      else if (tok[3] !== undefined) ends.set(tok[3], text.length);
    }
    const key = squash(text);
    const occurrence = seenText.get(key) || 0;
    seenText.set(key, occurrence + 1);
    for (const [id, st] of open) {
      // A comment that spans paragraphs is anchored to the paragraph where it starts.
      if (ends.has(id)) { found.set(id, st); open.delete(id); }
    }
    for (const [id, s] of starts) {
      if (found.has(id)) continue;
      const rec = { paraText: text, occurrence, quote: text.slice(s, ends.has(id) ? ends.get(id) : text.length), at: s };
      if (ends.has(id)) found.set(id, rec);
      else open.set(id, rec);
    }
  }
  for (const [id, rec] of open) found.set(id, rec);
  const out = [];
  for (const [id, n] of notes) {
    if (!n.text) continue;
    const where = found.get(id) || { paraText: '', quote: '', occurrence: 0, at: 0 };
    out.push({ author: n.author, date: n.date, text: n.text, ...where });
  }
  return out;
}

/** Attach extracted Word comments to imported paragraphs: same text, and the same occurrence when text repeats. */
export function commentsForParagraphs(list = [], paragraphs = []) {
  const now = new Date().toISOString();
  return list.map((c) => {
    const general = /^general comment:\s*/i.test(c.text);
    const text = c.text.replace(/^general comment:\s*/i, '');
    const target = squash(c.paraText);
    let p = null;
    if (!general && target) {
      const same = paragraphs.filter((x) => squash(x.text) === target);
      p = same[Math.min(c.occurrence || 0, same.length - 1)] || paragraphs.find((x) => squash(x.text).includes(target.slice(0, 60))) || null;
    }
    let quote = '';
    let at;
    if (p && c.quote && c.quote.length < p.text.length) {
      const exact = p.text.slice(c.at, c.at + c.quote.length) === c.quote ? c.at : p.text.indexOf(c.quote);
      if (exact >= 0) { quote = c.quote; at = exact; }
    }
    const out = { id: uid('c'), paraId: p ? p.id : null, quote, text, createdAt: validDate(c.date) || now, resolved: false };
    if (at !== undefined) out.at = at;
    if (c.author) out.author = c.author;
    return out;
  });
}

export function documentAsMarkdown(doc, { includeComments = true } = {}) {
  const paras = (doc.paragraphs || []).filter((p, i, all) => p.text.trim() || (i > 0 && i < all.length - 1));
  const head = doc.title && doc.title !== 'Untitled' && paras[0]?.text.trim() !== doc.title.trim() ? `# ${doc.title}\n\n` : '';
  const body = head + paras.map((p) => (p.type === 'heading' ? `## ${p.text}` : p.text)).join('\n\n').replace(/^\n+/, '') + '\n';
  const open = (doc.comments || []).filter((c) => !c.resolved);
  if (!includeComments || !open.length) return body;
  const lines = ['', '---', '', '## Comments', ''];
  const general = open.filter((c) => !c.paraId);
  if (general.length) {
    lines.push('### General', '');
    general.forEach((c) => lines.push(`- ${c.text}`));
    lines.push('');
  }
  (doc.paragraphs || []).forEach((p, i) => {
    const mine = open.filter((c) => c.paraId === p.id);
    if (!mine.length) return;
    lines.push(`### Paragraph ${i + 1}`, '');
    mine.forEach((c) => lines.push(c.quote ? `- On "${c.quote}": ${c.text}` : `- ${c.text}`));
    lines.push('');
  });
  return body + lines.join('\n');
}
