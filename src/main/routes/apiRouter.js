import express from 'express';
import multer from 'multer';
import fs from 'node:fs';
import { UPLOADS_DIR, getConfig, saveConfig, publicConfig } from '../domains/config/configService.js';
import {
  listDocuments,
  getDocumentById,
  upsertDocument,
  updateBookmark,
  deleteDocument,
  listRevisions,
  saveSnapshot,
  importDocumentFromFile,
  generateCleanDocxBuffer,
  documentAsMarkdown,
} from '../domains/projects/projectRepository.js';
import { synthesizeSpeech, synthesizeDocumentMp3 } from '../domains/voice/ttsService.js';
import { runForensicAuditReport } from '../domains/forensics/forensicsService.js';
import { checkParagraphs } from '../domains/language/grammarService.js';
import { generateEditorialRevision, generateReview, generateAlternatives } from '../domains/editorial/editorialService.js';
import { findSynonyms } from '../domains/language/thesaurusService.js';

const upload = multer({ dest: UPLOADS_DIR, limits: { fileSize: 25 * 1024 * 1024 } });
const fileSafe = (s = 'Document') => String(s).replace(/[^\w .-]+/g, '').trim().replace(/\s+/g, '_') || 'Document';
const wrap = (fn) => (req, res) => Promise.resolve(fn(req, res)).catch((err) => {
  console.error(err);
  res.status(err.status || 500).json({ error: err.message || 'Request failed' });
});

export function createApiRouter({ tts = synthesizeSpeech, editor = generateEditorialRevision, reviewer = generateReview, grammar = checkParagraphs, thesaurus = findSynonyms, alternatives = generateAlternatives } = {}) {
  const router = express.Router();

  router.get('/health', (req, res) => res.json({ ok: true }));

  router.get('/config', (req, res) => res.json(publicConfig(getConfig())));
  router.post('/config', (req, res) => res.json(publicConfig(saveConfig(req.body || {}))));

  router.get('/documents', (req, res) => res.json({ documents: listDocuments() }));

  router.get('/documents/:id', (req, res) => {
    const doc = getDocumentById(req.params.id);
    if (!doc) return res.status(404).json({ error: 'Document not found' });
    saveConfig({ lastOpenedDocId: doc.id });
    res.json(doc);
  });

  router.post('/documents', (req, res) => res.json(upsertDocument(req.body || {})));

  router.post('/documents/:id/bookmark', (req, res) => {
    const bookmark = updateBookmark(req.params.id, req.body || {});
    if (!bookmark) return res.status(404).json({ error: 'Document not found' });
    res.json({ ok: true, bookmark });
  });

  router.delete('/documents/:id', (req, res) => res.json({ ok: deleteDocument(req.params.id) }));

  router.get('/documents/:id/revisions', (req, res) => res.json({ revisions: listRevisions(req.params.id) }));

  router.post('/documents/:id/snapshot', (req, res) => {
    const doc = getDocumentById(req.params.id);
    if (!doc) return res.status(404).json({ error: 'Document not found' });
    res.json(saveSnapshot(doc, req.body?.reason || 'Checkpoint'));
  });

  router.post('/import', upload.single('file'), wrap(async (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    try {
      res.json(await importDocumentFromFile(req.file.path, req.file.originalname));
    } finally {
      fs.rm(req.file.path, { force: true }, () => {});
    }
  }));
  // Old path kept so older builds keep working.
  router.post('/import-docx', upload.single('file'), wrap(async (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    try {
      res.json(await importDocumentFromFile(req.file.path, req.file.originalname));
    } finally {
      fs.rm(req.file.path, { force: true }, () => {});
    }
  }));

  // GET so the macOS app can hand the URL to its download manager.
  router.get('/documents/:id/export', wrap(async (req, res) => {
    const doc = getDocumentById(req.params.id);
    if (!doc) return res.status(404).json({ error: 'Document not found' });
    const format = req.query.format || 'docx';
    const name = fileSafe(doc.title);
    if (format === 'md') {
      res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${name}.md"`);
      return res.send(documentAsMarkdown(doc, { includeComments: req.query.comments !== '0' }));
    }
    if (format === 'mp3') {
      const cfg = getConfig();
      const audio = await synthesizeDocumentMp3({
        paragraphs: doc.paragraphs.map((p) => p.text),
        voice: req.query.voice || cfg.voiceId,
        pronunciations: cfg.pronunciations,
      });
      res.setHeader('Content-Type', 'audio/mpeg');
      res.setHeader('Content-Disposition', `attachment; filename="${name}.mp3"`);
      return res.send(audio);
    }
    const buffer = await generateCleanDocxBuffer({
      title: doc.title,
      paragraphs: doc.paragraphs,
      fontFamily: doc.style === 'academic' ? 'Times New Roman' : 'Arial',
      doubleSpaced: true,
      comments: req.query.comments === '0' ? [] : doc.comments || [],
      author: getConfig().reviewerName || 'Reviewer',
      baseline: req.query.changes === '0' ? null : doc.tracking?.baseline || null,
      changesDate: doc.tracking?.startedAt,
    });
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    res.setHeader('Content-Disposition', `attachment; filename="${name}.docx"`);
    res.send(buffer);
  }));

  router.post('/audit', wrap(async (req, res) => {
    res.json(await runForensicAuditReport(req.body?.text || '', req.body?.style || 'narrative'));
  }));

  // Returns raw audio bytes (no base64 round trip).
  router.post('/tts', wrap(async (req, res) => {
    const cfg = getConfig();
    const result = await tts({
      text: req.body?.text,
      voice: req.body?.voice || cfg.voiceId,
      apiKey: cfg.apiKey,
      ttsModel: cfg.ttsModel,
      pronunciations: cfg.pronunciations,
    });
    res.setHeader('Content-Type', result.mimeType);
    res.setHeader('X-Cadence-Voice', result.voice);
    if (result.notice) res.setHeader('X-Cadence-Notice', encodeURIComponent(result.notice));
    res.setHeader('Cache-Control', 'no-store');
    res.send(result.audio);
  }));

  router.post('/edit', wrap(async (req, res) => {
    const cfg = getConfig();
    const b = req.body || {};
    // Offline proofreading: apply the local grammar checker's first suggestion for each correctness issue.
    if (b.action === 'proofread' && !cfg.apiKey) {
      const target = String(b.targetText || '');
      const fixable = new Set(['Spelling', 'Typo', 'Grammar', 'Agreement', 'Repetition', 'BoundaryError', 'Capitalization', 'Punctuation', 'Miscellaneous', 'Usage', 'WordChoice']);
      const issues = (await grammar([target], { userDictionary: cfg.dictionary || [] }))
        .filter((i) => fixable.has(i.kind) && i.suggestions.length)
        .sort((a, b2) => b2.start - a.start);
      let fixed = target;
      let last = Infinity;
      for (const i of issues) {
        if (i.end > last) continue; // skip overlaps
        fixed = fixed.slice(0, i.start) + i.suggestions[0] + fixed.slice(i.end);
        last = i.start;
      }
      const n = issues.length;
      return res.json(fixed !== target
        ? { proposedText: fixed, rationale: `Fixed ${n} spelling or grammar issue${n === 1 ? '' : 's'} with the local checker. Words that are wrong but correctly spelled need a Gemini key to catch.`, spokenReply: `I fixed ${n} issue${n === 1 ? '' : 's'}. Have a look.`, source: 'offline' }
        : { proposedText: '', rationale: 'The local checker found nothing to fix here.', spokenReply: 'I did not find any errors.', source: 'offline' });
    }
    res.json(
      await editor({
        apiKey: cfg.apiKey,
        model: cfg.textModel,
        action: b.action,
        targetText: b.targetText || '',
        contextText: b.contextText || '',
        instruction: b.instruction || '',
        style: b.style || 'narrative',
      })
    );
  }));

  router.post('/grammar', wrap(async (req, res) => {
    const paragraphs = Array.isArray(req.body?.paragraphs) ? req.body.paragraphs.map((t) => String(t ?? '')) : [];
    res.json({ issues: await grammar(paragraphs, { userDictionary: getConfig().dictionary || [] }) });
  }));

  // Personal dictionary: add or remove a word.
  router.post('/dictionary', (req, res) => {
    const word = String(req.body?.word || '').trim();
    const cfg = getConfig();
    const set = new Set(cfg.dictionary || []);
    if (word) req.body?.remove ? set.delete(word) : set.add(word);
    res.json(publicConfig(saveConfig({ dictionary: [...set].sort((a, b) => a.localeCompare(b)) })));
  });

  router.post('/review', wrap(async (req, res) => {
    const cfg = getConfig();
    const paragraphs = (req.body?.paragraphs || []).map((p) => ({ type: p.type === 'heading' ? 'heading' : 'body', text: String(p.text || '') }));
    res.json(await reviewer({ apiKey: cfg.apiKey, model: cfg.textModel, paragraphs, style: req.body?.style || 'narrative' }));
  }));

  // Word alternatives for one word, using the words either side for context.
  router.get('/synonyms', wrap(async (req, res) => {
    res.json(await thesaurus({ word: String(req.query.word || ''), left: String(req.query.left || ''), right: String(req.query.right || '') }));
  }));

  // Several rewordings of a sentence or phrase to choose from.
  router.post('/alternatives', wrap(async (req, res) => {
    const cfg = getConfig();
    const b = req.body || {};
    res.json(await alternatives({ apiKey: cfg.apiKey, model: cfg.textModel, targetText: String(b.targetText || ''), contextText: String(b.contextText || ''), style: b.style || 'narrative' }));
  }));

  return router;
}
