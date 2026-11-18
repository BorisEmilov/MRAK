import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from '../app.js';
import { MemoryCounters } from '../auth/guards.js';
import { MemoryMailer } from '../auth/mailer.js';
import { MemoryLimiter } from '../limits/limiter.js';
import { MemoryNewsletterStore, Newsletter } from './newsletter.js';

const settle = () => new Promise((r) => setImmediate(r));

function harness() {
  let clock = Date.parse('2026-11-18T10:00:00Z');
  const now = () => new Date(clock);
  const mailer = new MemoryMailer();
  const store = new MemoryNewsletterStore();
  const newsletter = new Newsletter({
    store,
    mailer,
    human: (token) => Promise.resolve(token === 'ok'),
    counters: new MemoryCounters(() => clock),
    secret: 'test-secret-test-secret-test-secret!!',
    siteUrl: 'https://mrak.game',
    now,
  });
  const app = createApp({ newsletter, now, limiter: new MemoryLimiter(() => clock) });
  const post = (path: string, body: object, ip = '1.2.3.4') =>
    request(app).post(path).set('X-Forwarded-For', ip).send(body);
  const token = () => mailer.sent.at(-1)?.link?.split('#token=')[1] ?? '';
  return { post, mailer, store, newsletter, token, advance: (ms: number) => (clock += ms) };
}

describe('newsletter (double opt-in)', () => {
  it('subscribes only after the emailed link is confirmed', async () => {
    const h = harness();
    const res = await h.post('/v1/newsletter/subscribe', {
      email: 'Fan@Example.com',
      captcha: 'ok',
    });
    expect(res.status).toBe(202);
    await settle();
    expect(h.mailer.sent[0]).toMatchObject({ to: 'fan@example.com', kind: 'newsletter-confirm' });
    expect(h.mailer.sent[0]?.link?.startsWith('https://mrak.game/newsletter/confirm#token=')).toBe(
      true,
    );
    expect([...h.store.rows.values()][0]?.confirmedAt).toBeNull();
    expect((await h.post('/v1/newsletter/confirm', { token: h.token() })).status).toBe(204);
    expect([...h.store.rows.values()][0]?.confirmedAt).not.toBeNull();
    expect((await h.post('/v1/newsletter/confirm', { token: h.token() })).status).toBe(400);
  });

  it('answers the same for confirmed, disposable and new addresses; needs Turnstile', async () => {
    const h = harness();
    await h.post('/v1/newsletter/subscribe', { email: 'a@x.com', captcha: 'ok' });
    await settle();
    await h.post('/v1/newsletter/confirm', { token: h.token() });
    const again = await h.post(
      '/v1/newsletter/subscribe',
      { email: 'a@x.com', captcha: 'ok' },
      '5.5.5.5',
    );
    const disposable = await h.post(
      '/v1/newsletter/subscribe',
      { email: 'a@mailinator.com', captcha: 'ok' },
      '5.5.5.6',
    );
    const fresh = await h.post(
      '/v1/newsletter/subscribe',
      { email: 'b@x.com', captcha: 'ok' },
      '5.5.5.7',
    );
    expect([again.status, again.body]).toEqual([fresh.status, fresh.body]);
    expect([disposable.status, disposable.body]).toEqual([fresh.status, fresh.body]);
    await settle();
    expect(h.mailer.sent.map((m) => m.to)).toEqual(['a@x.com', 'b@x.com']);
    expect((await h.post('/v1/newsletter/subscribe', { email: 'c@x.com' }, '5.5.5.8')).status).toBe(
      400,
    );
  });

  it('expires links, purges unconfirmed addresses and unsubscribes only with a valid signature', async () => {
    const h = harness();
    await h.post('/v1/newsletter/subscribe', { email: 'late@x.com', captcha: 'ok' });
    await settle();
    h.advance(49 * 3600_000);
    expect((await h.post('/v1/newsletter/confirm', { token: h.token() })).status).toBe(400);
    h.advance(6 * 24 * 3600_000);
    expect(await h.newsletter.purge()).toBe(1);

    await h.post('/v1/newsletter/subscribe', { email: 'u@x.com', captcha: 'ok' }, '9.9.9.9');
    await settle();
    await h.post('/v1/newsletter/confirm', { token: h.token() });
    const id = [...h.store.rows.keys()][0] ?? '';
    expect((await h.post('/v1/newsletter/unsubscribe', { id, sig: 'forged' })).status).toBe(204);
    expect(h.store.rows.size).toBe(1);
    await h.post('/v1/newsletter/unsubscribe', { id, sig: h.newsletter.unsubscribeSig(id) });
    expect(h.store.rows.size).toBe(0);
  });

  it('limits sign-ups per IP (5/hour)', async () => {
    const h = harness();
    for (let i = 0; i < 5; i++)
      await h.post(
        '/v1/newsletter/subscribe',
        { email: `n${String(i)}@x.com`, captcha: 'ok' },
        '7.7.7.7',
      );
    const res = await h.post(
      '/v1/newsletter/subscribe',
      { email: 'z@x.com', captcha: 'ok' },
      '7.7.7.7',
    );
    expect(res.status).toBe(429);
  });
});
