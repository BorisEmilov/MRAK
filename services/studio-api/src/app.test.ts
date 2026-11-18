import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from './app.js';

describe('studio-api app', () => {
  const app = createApp();

  it('GET /health returns 200', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok', service: 'studio-api' });
  });

  it('sends rate-limit headers', async () => {
    const res = await request(app).get('/health');
    expect(res.headers['ratelimit-policy']).toBeDefined();
  });

  it('does not reveal the framework', async () => {
    const res = await request(app).get('/health');
    expect(res.headers['x-powered-by']).toBeUndefined();
  });

  it('returns 404 JSON for unknown routes', async () => {
    const res = await request(app).get('/nope');
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'not_found' });
  });

  it('rejects bodies over the size limit', async () => {
    const res = await request(app)
      .post('/health')
      .set('content-type', 'application/json')
      .send(JSON.stringify({ x: 'a'.repeat(1_100_000) }));
    expect(res.status).toBe(413);
  });
});
