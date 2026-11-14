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
import { generateEditorialRevision } from '../domains/editorial/editorialService.js';

const upload = multer({ dest: UPLOADS_DIR, limits: { fileSize: 25 * 1024 * 1024 } });
const fileSafe = (s = 'Document') => String(s).replace(/[^\w .-]+/g, '').trim().replace(/\s+/g, '_') || 'Document';
const wrap = (fn) => (req, res) => Promise.resolve(fn(req, res)).catch((err) => {
  console.error(err);
  res.status(err.status || 500).json({ error: err.message || 'Request failed' });
});

export function createApiRouter({ tts = synthesizeSpeech, editor = generateEditorialRevision } = {}) {
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
      return res.send(documentAsMarkdown(doc));
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

  return router;
}
