import { createServer } from 'node:https';
import { readFileSync } from 'node:fs';
import { createApp } from './app.js';
const app = createApp();
const port = Number(process.env.PORT || 3001);
if (process.env.LOCAL_HTTPS === '1') {
  createServer({ cert: readFileSync(process.env.TLS_CERT_PATH), key: readFileSync(process.env.TLS_KEY_PATH) }, app)
    .listen(port, process.env.HOST || '127.0.0.1', () => console.log(`Lieferklar https://localhost:${port}`));
} else app.listen(port, process.env.HOST || '127.0.0.1', () => console.log(`Lieferklar API http://localhost:${port}`));
