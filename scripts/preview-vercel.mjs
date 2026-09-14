import express from 'express';
import { randomBytes } from 'node:crypto';
import path from 'node:path';
import { createVercelApp } from '../server/vercel/app.js';
import { VercelStore } from '../server/vercel/store.js';
import { FakeRedis } from '../tests/support/fake-redis.js';

if (process.env.VERCEL || process.env.LAST_LIGHT_ENABLE_TEST_STORE !== '1') throw new Error('Local preview requires LAST_LIGHT_ENABLE_TEST_STORE=1 and cannot run on Vercel.');
const port = Number(process.env.PORT || 3004);
const api = createVercelApp({ env: {}, store: new VercelStore(new FakeRedis()), secret: randomBytes(32).toString('hex'),
  adminPassword: process.env.LAST_LIGHT_ADMIN_PASSWORD || 'local-preview-only', publicOrigin: `http://127.0.0.1:${port}` });
const app = express();
app.use((req, res, next) => req.path.startsWith('/api/') ? api(req, res, next) : next());
app.use(express.static(path.resolve('dist')));
app.get('/{*path}', (req, res) => res.sendFile(path.resolve('dist/index.html')));
const server = app.listen(port, '127.0.0.1', () => console.log(`TEST MEMORY STORE ONLY — local replay preview: http://127.0.0.1:${port}`));
for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => server.close(() => process.exit(0)));
