import { describe, it, expect } from 'vitest';
import { createApp } from '../index.js';

// Lightweight fetch-based API client for integration tests without supertest dependency
async function api(
  app: ReturnType<typeof createApp>['app'],
  method: string,
  path: string,
  token?: string,
  body?: unknown
) {
  return new Promise<{ status: number; body: unknown }>((resolve, reject) => {
    const serverInstance = app.listen(0, async () => {
      const addr = serverInstance.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;
      try {
        const res = await fetch(`http://127.0.0.1:${port}${path}`, {
          method,
          headers: {
            'Content-Type': 'application/json',
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          body: body ? JSON.stringify(body) : undefined,
        });
        const json = await res.json().catch(() => ({}));
        serverInstance.close();
        resolve({ status: res.status, body: json });
      } catch (err) {
        serverInstance.close();
        reject(err);
      }
    });
  });
}

describe('API auth', () => {
  it('rejects unauthenticated requests', async () => {
    const { app, store } = createApp();
    const parent = store.createParent('P');
    const child = store.createChild(parent.id, 'C', 5);
    const res = await api(app, 'GET', `/api/children/${child.id}/balance`);
    expect(res.status).toBe(401);
  });

  it('allows parent to read child balance', async () => {
    const { app, store } = createApp();
    const parent = store.createParent('P');
    const child = store.createChild(parent.id, 'C', 12);
    const res = await api(app, 'GET', `/api/children/${child.id}/balance`, parent.token);
    expect(res.status).toBe(200);
    expect((res.body as { balance: number }).balance).toBe(12);
  });
});
