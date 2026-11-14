import 'dotenv/config';
import { createApp } from './src/main/app.js';

const PORT = Number(process.env.PORT) || 3847;
const HOST = process.env.HOST || '127.0.0.1';

const server = createApp().listen(PORT, HOST, () => {
  console.log(`Cadence running at http://localhost:${PORT}`);
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.log(`Port ${PORT} is already in use. Cadence is probably already running.`);
    process.exit(0);
  }
  throw err;
});
