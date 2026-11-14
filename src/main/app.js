import express from 'express';
import path from 'node:path';
import { ROOT_DIR, ensureDataDirectories } from './domains/config/configService.js';
import { ensureStarterDocuments } from './domains/projects/projectRepository.js';
import { createApiRouter } from './routes/apiRouter.js';

export function createApp(options = {}) {
  ensureDataDirectories();
  ensureStarterDocuments();

  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '10mb' }));
  app.use(express.static(path.join(ROOT_DIR, 'public'), { etag: true, maxAge: 0 }));
  app.use('/api', createApiRouter(options));
  return app;
}
