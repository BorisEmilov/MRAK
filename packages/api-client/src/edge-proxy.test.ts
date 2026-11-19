import { describe, expect, it } from 'vitest';
import { proxyApi } from './edge-proxy';

const env = { API_ORIGIN: 'https://mrak-api.onrender.com', EDGE_SECRET: 's'.repeat(40) };

function capture() {
  const calls: { url: string; init: RequestInit }[] = [];
  const doFetch = ((url: URL, init: RequestInit) => {
    calls.push({ url: String(url), init });
    return Promise.resolve(new Response('ok', { status: 200 }));
  }) as unknown as typeof fetch;
  return { calls, doFetch };
}

const sent = (init: RequestInit) => new Headers(init.headers);

describe('edge proxy (SEC-EDGE-46)', () => {
  it('forwards /api/<path> to the origin with the edge secret and the client IP', async () => {
    const { calls, doFetch } = capture();
    const req = new Request('https://play.mrak.game/api/v1/auth/login?x=1', {
      method: 'POST',
      headers: { 'cf-connecting-ip': '203.0.113.7', cookie: 'mrak_rt=abc', 'content-type': 'a/b' },
      body: '{"a":1}',
    });
    const res = await proxyApi(req, env, doFetch);
    expect(res.status).toBe(200);
    expect(calls[0]?.url).toBe('https://mrak-api.onrender.com/v1/auth/login?x=1');
    const h = sent(calls[0]?.init ?? {});
    expect(h.get('x-mrak-edge')).toBe(env.EDGE_SECRET);
    expect(h.get('x-mrak-client-ip')).toBe('203.0.113.7');
    expect(h.get('cookie')).toBe('mrak_rt=abc');
    expect(h.get('cf-connecting-ip')).toBeNull();
    expect(calls[0]?.init.redirect).toBe('manual');
  });

  it('never forwards client-sent edge, IP or forwarding headers', async () => {
    const { calls, doFetch } = capture();
    const req = new Request('https://mrak.game/api/health', {
      headers: {
        'x-mrak-edge': 'forged',
        'x-mrak-client-ip': '6.6.6.6',
        'x-forwarded-for': '6.6.6.6',
        forwarded: 'for=6.6.6.6',
      },
    });
    await proxyApi(req, env, doFetch);
    const h = sent(calls[0]?.init ?? {});
    expect(h.get('x-mrak-edge')).toBe(env.EDGE_SECRET);
    expect(h.get('x-mrak-client-ip')).toBeNull();
    expect(h.get('x-forwarded-for')).toBeNull();
    expect(h.get('forwarded')).toBeNull();
  });

  it.each(['/api//evil.test/x', '/api/\\evil.test', '/apix/v1', '/v1/auth/login'])(
    'refuses %s without calling the origin',
    async (path) => {
      const { calls, doFetch } = capture();
      const res = await proxyApi(new Request(`https://mrak.game${path}`), env, doFetch);
      expect(res.status).toBe(404);
      expect(calls).toHaveLength(0);
    },
  );

  it('fails closed when not configured (no secret, short secret, http origin)', async () => {
    const { calls, doFetch } = capture();
    const req = () => new Request('https://mrak.game/api/health');
    for (const bad of [
      {},
      { ...env, EDGE_SECRET: 'short' },
      { ...env, API_ORIGIN: 'http://mrak-api.onrender.com' },
    ]) {
      expect((await proxyApi(req(), bad, doFetch)).status).toBe(503);
    }
    expect(calls).toHaveLength(0);
  });

  it('rejects oversized bodies before the origin', async () => {
    const { calls, doFetch } = capture();
    const big = new Request('https://mrak.game/api/v1/bug-reports', {
      method: 'POST',
      body: 'x'.repeat(2 * 1024 * 1024 + 1),
    });
    expect((await proxyApi(big, env, doFetch)).status).toBe(413);
    expect(calls).toHaveLength(0);
  });

  it('answers 502 when the origin is unreachable', async () => {
    const res = await proxyApi(new Request('https://mrak.game/api/health'), env, () =>
      Promise.reject(new Error('down')),
    );
    expect(res.status).toBe(502);
  });
});
