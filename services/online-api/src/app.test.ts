import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from './app.js';

describe('online-api app', () => {
  const app = createApp();

  it('GET /health returns 200', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok', service: 'online-api' });
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
    expect(res.type).toBe('application/problem+json');
    expect(res.body).toMatchObject({ status: 404, error: 'not_found' });
  });

  it('rejects bodies over the route limit (16 KB) and anything over 2 MB up front', async () => {
    const res = await request(app)
      .post('/v1/auth/login')
      .set('content-type', 'application/json')
      .send(JSON.stringify({ x: 'a'.repeat(20_000) }));
    expect(res.status).toBe(413);
    expect(res.type).toBe('application/problem+json');
    const huge = await request(app)
      .post('/v1/auth/login')
      .set('content-type', 'application/json')
      .set('content-length', String(3 * 1024 * 1024))
      .send('{}');
    expect(huge.status).toBe(413);
  });

  it('ADR 0011: behind the edge only requests with the edge secret are served', async () => {
    const edge = createApp({ edgeSecret: 'e'.repeat(32) });
    expect((await request(edge).get('/v1/seasonal')).status).toBe(403);
    expect((await request(edge).get('/v1/seasonal').set('x-mrak-edge', 'wrong')).status).toBe(403);
    expect((await request(edge).get('/health')).status).toBe(200); // platform probes
    const ok = await request(edge)
      .get('/v1/seasonal')
      .set('x-mrak-edge', 'e'.repeat(32))
      .set('cf-connecting-ip', '203.0.113.7');
    expect(ok.status).not.toBe(403);
  });
});
