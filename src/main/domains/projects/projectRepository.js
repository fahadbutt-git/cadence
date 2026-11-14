import fs from 'node:fs';
import path from 'node:path';
import mammoth from 'mammoth';
import { Document, Packer, Paragraph, TextRun, AlignmentType, HeadingLevel } from 'docx';
import { DOCS_DIR, REVISIONS_DIR, ensureDataDirectories } from '../config/configService.js';

const MAX_REVISIONS = 40;
const uid = (prefix = 'p') => `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
const safeId = (id = '') => String(id).replace(/[^a-zA-Z0-9_-]/g, '');

// Older files used mode1 / mode2.
export function normalizeStyle(raw = {}) {
  if (raw.style === 'academic' || raw.style === 'narrative') return raw.style;
  return raw.mode === 'mode2' ? 'academic' : 'narrative';
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
  const snapshot = { revId, docId: doc.id, reason, createdAt, title: doc.title, paragraphs: doc.paragraphs, wordCount: computeWordCount(doc.paragraphs || []) };
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
  if (ext === '.docx') {
    const { value } = await mammoth.convertToHtml({ path: filePath });
    paragraphs = paragraphsFromHtml(value);
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
      createSnapshot: true,
      snapshotReason: `Imported ${originalName}`,
    },
    docsDir,
    revisionsDir
  );
}

export async function generateCleanDocxBuffer({ title = 'Document', paragraphs = [], fontFamily = 'Arial', doubleSpaced = true }) {
  const line = doubleSpaced ? 480 : 276;
  const children = paragraphs.map((p) =>
    new Paragraph({
      alignment: AlignmentType.LEFT,
      heading: p.type === 'heading' ? HeadingLevel.HEADING_1 : undefined,
      spacing: { line, after: 0 },
      children: [new TextRun({ text: p.text || '', font: fontFamily, size: 24, bold: p.type === 'heading', color: '000000' })],
    })
  );
  const doc = new Document({
    creator: '',
    lastModifiedBy: '',
    title: title || 'Document',
    description: '',
    styles: { default: { document: { run: { font: fontFamily, size: 24 } } } },
    sections: [{ properties: {}, children }],
  });
  return Packer.toBuffer(doc);
}

export function documentAsMarkdown(doc) {
  return (doc.paragraphs || []).map((p) => (p.type === 'heading' ? `## ${p.text}` : p.text)).join('\n\n') + '\n';
}
