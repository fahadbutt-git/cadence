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

// Older files used mode1 / mode2.
export function normalizeStyle(raw = {}) {
  if (raw.style === 'academic' || raw.style === 'narrative') return raw.style;
  return raw.mode === 'mode2' ? 'academic' : 'narrative';
}

/**
 * Comments: { id, paraId (null for a general comment), quote (optional exact text), text, createdAt, resolved }.
 */
export function sanitizeComments(list = [], paragraphs = []) {
  if (!Array.isArray(list)) return [];
  const ids = new Set(paragraphs.map((p) => p.id));
  return list
    .filter((c) => c && typeof c.text === 'string' && c.text.trim())
    .map((c) => ({
      id: String(c.id || uid('c')),
      paraId: c.paraId && ids.has(c.paraId) ? c.paraId : null,
      quote: c.paraId && ids.has(c.paraId) && typeof c.quote === 'string' ? c.quote.slice(0, 2000) : '',
      text: c.text.trim().slice(0, 5000),
      createdAt: c.createdAt || new Date().toISOString(),
      resolved: Boolean(c.resolved),
    }))
    .slice(0, 1000);
}

/** Tracked changes: { on, baseline: [{ id, type, text }] | null, startedAt }. */
export function sanitizeTracking(raw) {
  if (!raw || typeof raw !== 'object') return { on: false, baseline: null, startedAt: null };
  const baseline = Array.isArray(raw.baseline)
    ? raw.baseline.slice(0, 20000).map((p) => ({ id: String(p.id || uid()), type: p.type === 'heading' ? 'heading' : 'body', text: String(p.text ?? '') }))
    : null;
  return { on: Boolean(raw.on), baseline, startedAt: raw.startedAt || null };
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
      { id: 'w-4', type: 'body', text: 'Press Option and M, or the microphone button, and speak an instruction such as replace pivotal with important. This sentence is a deliberate example of a pivotal phrase that the checks will flag.' },
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
  const snapshot = { revId, docId: doc.id, reason, createdAt, title: doc.title, paragraphs: doc.paragraphs, comments: doc.comments || [], wordCount: computeWordCount(doc.paragraphs || []) };
  writeJson(path.join(dir, `${revId}.json`), snapshot);
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.json')).sort();
  for (const old of files.slice(0, Math.max(0, files.length - MAX_REVISIONS))) {
    try { fs.unlinkSync(path.join(dir, old)); } catch (e) {}
  }
  return snapshot;
}

export function upsertDocument(payload = {}, docsDir = DOCS_DIR, revisionsDir = REVISIONS_DIR) {
  ensureDataDirectories();
  const id = safeId(payload.id) || uid('doc');
  const file = path.join(docsDir, `${id}.json`);
  const existing = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : null;
  const paragraphs = (payload.paragraphs || existing?.paragraphs || [{ id: uid(), type: 'body', text: '' }]).map((p) => ({
    id: p.id || uid(),
    type: p.type === 'heading' ? 'heading' : 'body',
    text: String(p.text ?? ''),
  }));
  const doc = {
    id,
    title: (payload.title ?? existing?.title ?? 'Untitled').toString().trim() || 'Untitled',
    style: normalizeStyle({ ...existing, ...payload }),
    wordTarget: payload.wordTarget !== undefined ? payload.wordTarget : existing?.wordTarget ?? null,
    bookmark: payload.bookmark || existing?.bookmark || { paraIndex: 0, sentIndex: 0, updatedAt: new Date().toISOString() },
    createdAt: existing?.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    paragraphs: paragraphs.length ? paragraphs : [{ id: uid(), type: 'body', text: '' }],
  };
  doc.comments = sanitizeComments(payload.comments !== undefined ? payload.comments : existing?.comments || [], doc.paragraphs);
  doc.tracking = sanitizeTracking(payload.tracking !== undefined ? payload.tracking : existing?.tracking);
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
  s.replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');

/** Turn mammoth HTML into paragraphs, keeping headings. */
export function paragraphsFromHtml(html = '') {
  const out = [];
  const re = /<(h[1-6]|p|li)[^>]*>([\s\S]*?)<\/\1>/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    const text = decodeEntities(m[2].replace(/<br\s*\/?>/gi, ' ').replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim();
    if (!text) continue;
    out.push({ id: uid(), type: m[1].toLowerCase().startsWith('h') ? 'heading' : 'body', text });
  }
  return out;
}

/** Plain text or markdown: blank lines separate paragraphs, "#" lines are headings. */
export function paragraphsFromText(raw = '') {
  const blocks = raw.replace(/\r\n/g, '\n').split(/\n\s*\n|\n(?=#)/);
  const lines = blocks.length > 1 ? blocks : raw.split(/\n/);
  return lines
    .map((b) => b.replace(/\s*\n\s*/g, ' ').trim())
    .filter(Boolean)
    .map((t) => (/^#{1,6}\s/.test(t) ? { id: uid(), type: 'heading', text: t.replace(/^#+\s*/, '') } : { id: uid(), type: 'body', text: t }));
}

export async function importDocumentFromFile(filePath, originalName, docsDir = DOCS_DIR, revisionsDir = REVISIONS_DIR) {
  const ext = path.extname(originalName).toLowerCase();
  let paragraphs;
  let comments = [];
  if (ext === '.docx') {
    const { value } = await mammoth.convertToHtml({ path: filePath });
    paragraphs = paragraphsFromHtml(value);
    try {
      comments = commentsForParagraphs(await extractDocxComments(fs.readFileSync(filePath)), paragraphs);
    } catch (e) {
      comments = [];
    }
  } else if (['.txt', '.md', '.markdown'].includes(ext)) {
    paragraphs = paragraphsFromText(fs.readFileSync(filePath, 'utf8'));
  } else {
    throw Object.assign(new Error('Use a .docx, .txt or .md file'), { status: 400 });
  }
  return upsertDocument(
    {
      title: path.basename(originalName, ext),
      style: 'narrative',
      paragraphs: paragraphs.length ? paragraphs : [{ id: uid(), type: 'body', text: '' }],
      comments,
      createSnapshot: true,
      snapshotReason: `Imported ${originalName}`,
    },
    docsDir,
    revisionsDir
  );
}

/** Character ranges [start, end) for each comment inside a paragraph's text. Unmatched quotes cover the paragraph. */
export function commentRanges(text = '', comments = []) {
  return comments.map((c) => {
    const at = c.quote ? text.indexOf(c.quote) : -1;
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
      out.push(mk(seg.text, 'del'));
      continue;
    }
    const points = [seg.curStart, ...cuts.filter((c) => c > seg.curStart && c < seg.curEnd), seg.curEnd];
    for (let i = 0; i < points.length - 1; i++) {
      markers(points[i]);
      out.push(mk(text.slice(points[i], points[i + 1]), seg.type));
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
  const runMaker = (type) => (t, kind) => {
    const props = { text: t, font: fontFamily, size: 24, bold: type === 'heading', color: '000000' };
    if (kind === 'ins') return new InsertedTextRun({ ...props, id: rev++, author: who, date });
    if (kind === 'del') return new DeletedTextRun({ ...props, id: rev++, author: who, date });
    return new TextRun(props);
  };
  const deletedAfter = (afterId) =>
    (tracked?.deleted || []).filter((d) => d.afterId === afterId && d.text.trim()).map((d) => para(d.type, [runMaker(d.type)(d.text, 'del')], 'del'));

  const children = [...deletedAfter(null)];
  for (const p of paragraphs) {
    const mine = open.filter((c) => c.paraId === p.id || (!c.paraId && p.id === firstId));
    const ranges = commentRanges(p.text || '', mine).map((r) => (r.c.paraId ? r : { ...r, start: 0, end: (p.text || '').length }));
    const info = byId.get(p.id);
    children.push(para(p.type, buildRuns(p.text || '', info?.segments, ranges, idOf, runMaker(p.type)), info?.status === 'inserted' ? 'ins' : null));
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
        author: who,
        initials,
        date: new Date(c.createdAt || Date.now()),
        children: [new Paragraph({ children: [new TextRun({ text: c.paraId ? c.text : `General comment: ${c.text}` })] })],
      })),
    },
    sections: [{ properties: {}, children }],
  });
  return Packer.toBuffer(doc);
}

// ---------- Word comments on import ----------

const xmlText = (s = '') => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
const squash = (s = '') => s.replace(/\s+/g, ' ').trim();

/** Read comments from a .docx: [{ author, text, paraText, quote }]. */
export async function extractDocxComments(buffer) {
  const zip = await JSZip.loadAsync(buffer);
  const commentsXml = await zip.file('word/comments.xml')?.async('string');
  const docXml = await zip.file('word/document.xml')?.async('string');
  if (!commentsXml || !docXml) return [];
  const notes = new Map();
  for (const m of commentsXml.matchAll(/<w:comment\b([^>]*)>([\s\S]*?)<\/w:comment>/g)) {
    const id = (m[1].match(/w:id="([^"]+)"/) || [])[1];
    const author = xmlText((m[1].match(/w:author="([^"]*)"/) || [])[1] || '');
    const paras = [...m[2].matchAll(/<w:p\b[\s\S]*?<\/w:p>/g)].map((p) => [...p[0].matchAll(/<w:t\b[^>]*>([^<]*)<\/w:t>/g)].map((t) => xmlText(t[1])).join(''));
    notes.set(id, { author, text: squash(paras.join(' ')) });
  }
  const found = new Map();
  for (const pm of docXml.matchAll(/<w:p\b[\s\S]*?<\/w:p>/g)) {
    let text = '';
    const starts = new Map();
    const ends = new Map();
    for (const tok of pm[0].matchAll(/<w:t\b[^>]*>([^<]*)<\/w:t>|<w:commentRangeStart\b[^>]*w:id="([^"]+)"|<w:commentRangeEnd\b[^>]*w:id="([^"]+)"|<w:commentReference\b[^>]*w:id="([^"]+)"/g)) {
      if (tok[1] !== undefined) text += xmlText(tok[1]);
      else if (tok[2] !== undefined) starts.set(tok[2], text.length);
      else if (tok[3] !== undefined) ends.set(tok[3], text.length);
      else if (tok[4] !== undefined && !starts.has(tok[4]) && !found.has(tok[4])) starts.set(tok[4], 0);
    }
    for (const [id, s] of starts) {
      if (found.has(id)) continue;
      const e = ends.has(id) ? ends.get(id) : text.length;
      found.set(id, { paraText: text, quote: text.slice(s, e) });
    }
  }
  const out = [];
  for (const [id, n] of notes) {
    if (!n.text) continue;
    const where = found.get(id) || { paraText: '', quote: '' };
    out.push({ author: n.author, text: n.text, paraText: where.paraText, quote: where.quote });
  }
  return out;
}

/** Attach extracted Word comments to imported paragraphs by matching paragraph text. */
export function commentsForParagraphs(list = [], paragraphs = []) {
  const now = new Date().toISOString();
  return list.map((c) => {
    const general = /^general comment:\s*/i.test(c.text);
    const text = c.text.replace(/^general comment:\s*/i, '');
    const target = squash(c.paraText);
    const p = !general && target ? paragraphs.find((x) => squash(x.text) === target) || paragraphs.find((x) => target && squash(x.text).includes(target.slice(0, 60))) : null;
    const quote = p && c.quote && p.text.includes(c.quote) && c.quote.length < p.text.length ? c.quote : '';
    return { id: uid('c'), paraId: p ? p.id : null, quote, text, createdAt: now, resolved: false };
  });
}

export function documentAsMarkdown(doc, { includeComments = true } = {}) {
  const body = (doc.paragraphs || []).map((p) => (p.type === 'heading' ? `## ${p.text}` : p.text)).join('\n\n') + '\n';
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
