import express from 'express';
import path from 'node:path';
import { ROOT_DIR, ensureDataDirectories } from './domains/config/configService.js';
import { ensureStarterDocuments } from './domains/projects/projectRepository.js';
import { createApiRouter } from './routes/apiRouter.js';
import { warmUp } from './domains/language/grammarService.js';

export function createApp(options = {}) {
  ensureDataDirectories();
  ensureStarterDocuments();
  if (!options.grammar) warmUp();

  const app = express();
  app.disable('x-powered-by');
  // Cadence only serves this computer. Refuse other host names (DNS rebinding) and requests that change
  // data from other websites.
  app.use(localOnly);
  app.use(express.json({ limit: '60mb', type: ['application/json', 'text/plain'] }));
  app.use(express.static(path.join(ROOT_DIR, 'public'), { etag: true, maxAge: 0 }));
  app.use('/api', createApiRouter(options));
  // Any error, including bad JSON and oversized bodies, comes back as a short JSON message.
  app.use((err, req, res, next) => {
    const status = err.status || err.statusCode || 500;
    const message =
      err.type === 'entity.too.large' ? 'That is too large to save. Split it into smaller documents.'
        : err.type === 'entity.parse.failed' ? 'The request was not valid JSON.'
          : status >= 500 ? 'Something went wrong on the Cadence server.' : err.message;
    if (status >= 500) console.error(err);
    res.status(status).json({ error: message, ...(err.current ? { current: err.current } : {}) });
  });
  return app;
}

const LOCAL_HOSTS = /^(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/i;
export function localOnly(req, res, next) {
  if (!LOCAL_HOSTS.test(req.headers.host || '')) return res.status(403).json({ error: 'Cadence only accepts requests from this computer.' });
  if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
    const origin = req.headers.origin;
    const site = req.headers['sec-fetch-site'];
    if ((origin && origin !== 'null' && !LOCAL_HOSTS.test(origin.replace(/^https?:\/\//, ''))) || origin === 'null' || site === 'cross-site' || site === 'same-site') {
      return res.status(403).json({ error: 'Cadence does not accept changes from other websites.' });
    }
  }
  next();
}
