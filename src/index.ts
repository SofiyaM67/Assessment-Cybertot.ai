import express from 'express';
import { Store } from './store.js';
import { RewardBankService } from './service.js';
import { createAuthMiddleware, createRouter } from './routes.js';

export function createApp(store = new Store()) {
  const app = express();
  const service = new RewardBankService(store);
  app.locals.store = store;
  app.locals.service = service;
  app.use(express.json());
  app.get('/health', (_req, res) => res.json({ ok: true }));
  app.use('/api', (req, res, next) => {
    if (req.path === '/setup') {
      next();
      return;
    }
    createAuthMiddleware(store)(req, res, next);
  });
  app.use('/api', createRouter(service, store));
  return { app, store, service };
}

export function startServer(port = Number(process.env.PORT) || 3000) {
  const { app } = createApp();
  return app.listen(port, () => {
    console.log(`RewardBank listening on http://localhost:${port}`);
  });
}

const isMain =
  process.argv[1] &&
  (process.argv[1].endsWith('index.ts') || process.argv[1].endsWith('index.js'));
if (isMain) {
  startServer();
}
