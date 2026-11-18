/** Store security tests (docs/systems/store.md, threat model C-27…C-31). */
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from '../app.js';
import type { AuditRow } from '../auth/repository.js';
import { presignGet } from '../content/presign.js';
import type { Account } from '../routes/progress.js';
import { PaddleProvider, paddleSignature } from './paddle.js';
import { LocalSigner, MemoryStoreRepo, Store, type ContentSigner } from './store.js';

const SECRET = 'pdl_ntfset_test_secret';
const USER = '0b9f0c4e-4c1e-4a39-9f5a-2f1f0d6a9b11';
const PRICES = { 'full-game': 'pri_full', collector: 'pri_coll' } as const;
const PACK = Buffer.from('{"packId":"mrak-full"}');

function harness(opts: { verified?: boolean; signer?: 'local' | 'r2'; status?: string } = {}) {
  let now = new Date('2026-11-18T12:00:00Z');
  const orders = new Map<string, { status: string; price: string; user: string }>([
    ['txn_01', { status: opts.status ?? 'completed', price: PRICES['full-game'], user: USER }],
    ['txn_02', { status: 'completed', price: PRICES.collector, user: USER }],
  ]);
  const calls: string[] = [];
  const fetchStub = ((url: string, init?: RequestInit) => {
    calls.push(`${init?.method ?? 'GET'} ${url}`);
    const id = url.split('/').pop() ?? '';
    const o = orders.get(id);
    const data =
      init?.method === 'POST'
        ? { id: 'txn_new', status: 'ready' }
        : o && {
            id,
            status: o.status,
            custom_data: { user_id: o.user },
            items: [{ price: { id: o.price } }],
            billed_at: now.toISOString(),
          };
    return Promise.resolve(new Response(JSON.stringify({ data }), { status: data ? 200 : 404 }));
  }) as typeof fetch;
  const provider = new PaddleProvider({
    apiKey: 'test',
    webhookSecret: SECRET,
    apiUrl: 'https://sandbox-api.paddle.com',
    checkoutUrl: 'https://mrak.game/buy/checkout/',
    fetch: fetchStub,
  });
  const local = new LocalSigner('x'.repeat(32), 'http://api.test');
  const r2: ContentSigner = {
    sign: (path, seconds, at) =>
      presignGet({
        host: 'acc.r2.cloudflarestorage.com',
        path,
        accessKeyId: 'k',
        secretAccessKey: 's',
        region: 'auto',
        now: at,
        expiresSeconds: seconds,
      }),
  };
  const repo = new MemoryStoreRepo();
  const audit: AuditRow[] = [];
  const store = new Store({
    repo,
    provider,
    prices: PRICES,
    signer: opts.signer === 'r2' ? r2 : local,
    fullPack: {
      path: '/paid/full/mrak-full-1.0.0.json',
      version: '1.0.0',
      sha256: 'a'.repeat(64),
      bytes: PACK.length,
    },
    audit: (row) => {
      audit.push(row);
      return Promise.resolve();
    },
    hashIp: () => 'h',
    userExists: (id) => Promise.resolve(id === USER),
    now: () => now,
  });
  const account: Account = { userId: USER, entitlements: [], verified: opts.verified ?? true };
  const app = createApp({
    now: () => now,
    store,
    authenticate: async () => ({ ...account, entitlements: await store.activeSkus(USER) }),
    localContent: {
      signer: local,
      read: (n) => (n === 'mrak-full-1.0.0.json' ? PACK : null),
      now: () => now,
    },
  });
  const hook = (body: object, sig?: string) => {
    const raw = JSON.stringify(body);
    return request(app)
      .post('/v1/store/webhook')
      .set('Content-Type', 'application/json')
      .set(
        'Paddle-Signature',
        sig ?? paddleSignature(SECRET, Math.floor(now.getTime() / 1000), raw),
      )
      .send(raw);
  };
  const completed = (id: string, txn = 'txn_01') => ({
    event_id: id,
    event_type: 'transaction.completed',
    data: { id: txn },
  });
  const adjustment = (id: string, action: string, txn = 'txn_01') => ({
    event_id: id,
    event_type: 'adjustment.updated',
    data: { action, status: 'approved', type: 'full', transaction_id: txn },
  });
  return {
    app,
    repo,
    audit,
    calls,
    hook,
    completed,
    adjustment,
    tick: (ms: number) => {
      now = new Date(now.getTime() + ms);
    },
  };
}

describe('webhooks', () => {
  it('rejects a forged or stale signature and grants nothing', async () => {
    const h = harness();
    expect((await h.hook(h.completed('evt_1'), 'ts=1;h1=' + '0'.repeat(64))).status).toBe(400);
    const raw = JSON.stringify(h.completed('evt_1'));
    const old = paddleSignature(SECRET, Math.floor(Date.parse('2026-11-18T11:50:00Z') / 1000), raw);
    expect((await h.hook(h.completed('evt_1'), old)).status).toBe(400);
    const otherKey = paddleSignature(
      'another',
      Math.floor(Date.parse('2026-11-18T12:00:00Z') / 1000),
      raw,
    );
    expect((await h.hook(h.completed('evt_1'), otherKey)).status).toBe(400);
    expect(h.repo.rows).toHaveLength(0);
    expect(h.audit.some((a) => a.action === 'payment-webhook' && a.result === 'fail')).toBe(true);
  });

  it('grants from the provider order once; a repeated event is idempotent', async () => {
    const h = harness();
    const first = await h.hook(h.completed('evt_1'));
    expect(first.body).toEqual({ status: 'processed' });
    expect((await h.hook(h.completed('evt_1'))).body).toEqual({ status: 'duplicate' });
    expect((await h.hook(h.completed('evt_9'))).status).toBe(200); // other event, same order
    expect(h.repo.rows).toHaveLength(1);
    expect(h.repo.rows[0]).toMatchObject({
      userId: USER,
      sku: 'full-game',
      source: 'web',
      status: 'active',
    });
    expect(h.calls).toContain('GET https://sandbox-api.paddle.com/transactions/txn_01');
  });

  it('does not grant when the provider does not report the order completed', async () => {
    const h = harness({ status: 'past_due' });
    expect((await h.hook(h.completed('evt_1'))).body).toEqual({ status: 'ignored' });
    expect(h.repo.rows).toHaveLength(0);
  });

  it('a refund revokes access; a chargeback revokes and blocks new purchases', async () => {
    const h = harness();
    await h.hook(h.completed('evt_1'));
    const auth = { Authorization: 'Bearer t' };
    expect((await request(h.app).post('/v1/content/full').set(auth)).status).toBe(200);
    await h.hook(h.adjustment('evt_2', 'refund'));
    expect(h.repo.rows[0]).toMatchObject({ status: 'revoked' });
    expect((await request(h.app).post('/v1/content/full').set(auth)).status).toBe(403);
    await h.hook(h.completed('evt_3', 'txn_02'));
    await h.hook(h.adjustment('evt_4', 'chargeback', 'txn_02'));
    const res = await request(h.app)
      .post('/v1/store/checkout')
      .set(auth)
      .send({ sku: 'full-game', consent: true });
    expect(res.status).toBe(403);
    expect(res.body).toMatchObject({ error: 'purchases_blocked' });
  });
});

describe('checkout', () => {
  const auth = { Authorization: 'Bearer t' };
  it('needs consent and a verified email; the return page never grants', async () => {
    const h = harness();
    expect(
      (await request(h.app).post('/v1/store/checkout').set(auth).send({ sku: 'full-game' })).status,
    ).toBe(400);
    const res = await request(h.app)
      .post('/v1/store/checkout')
      .set(auth)
      .send({ sku: 'full-game', consent: true });
    expect(res.status).toBe(201);
    expect((res.body as { url: string }).url).toBe('https://mrak.game/buy/checkout/?_ptxn=txn_new');
    expect(h.audit.some((a) => a.action === 'checkout-consent')).toBe(true);
    const owned = await request(h.app).get('/v1/store/entitlements').set(auth);
    expect(owned.body).toEqual({ entitlements: [] });
    const unverified = harness({ verified: false });
    expect(
      (
        await request(unverified.app)
          .post('/v1/store/checkout')
          .set(auth)
          .send({ sku: 'full-game', consent: true })
      ).status,
    ).toBe(403);
  });

  it('SEC-PAY-30: the 6th checkout of an hour is refused', async () => {
    const h = harness();
    const go = () =>
      request(h.app).post('/v1/store/checkout').set(auth).send({ sku: 'full-game', consent: true });
    for (let i = 0; i < 5; i++) expect((await go()).status).toBe(201);
    expect((await go()).status).toBe(429);
  });

  it('refuses a second purchase of an owned sku and price ids from the client', async () => {
    const h = harness();
    await h.hook(h.completed('evt_1'));
    expect(
      (
        await request(h.app)
          .post('/v1/store/checkout')
          .set(auth)
          .send({ sku: 'full-game', consent: true })
      ).status,
    ).toBe(409);
    expect(
      (
        await request(h.app)
          .post('/v1/store/checkout')
          .set(auth)
          .send({ sku: 'full-game', consent: true, price: 'pri_x' })
      ).status,
    ).toBe(400);
  });
});

describe('paid content (signed URLs)', () => {
  const auth = { Authorization: 'Bearer t' };
  it('no entitlement → no URL', async () => {
    const h = harness();
    const res = await request(h.app).post('/v1/content/full').set(auth);
    expect(res.status).toBe(403);
    expect(res.body).toMatchObject({ error: 'entitlement_required' });
  });

  it('the URL works for 5 minutes, then (or tampered) it does not', async () => {
    const h = harness();
    await h.hook(h.completed('evt_1'));
    const ticket = (await request(h.app).post('/v1/content/full').set(auth)).body as {
      url: string;
      expiresAt: string;
    };
    const path = ticket.url.replace('http://api.test', '');
    const ok = await request(h.app).get(path);
    expect(ok.status).toBe(200);
    expect(ok.text).toBe(PACK.toString());
    expect((await request(h.app).get(path.replace(/sig=../, 'sig=00'))).status).toBe(403);
    h.tick(301_000);
    expect((await request(h.app).get(path)).status).toBe(403);
  });

  it('R2 URLs are presigned for at most 300 s', async () => {
    const h = harness({ signer: 'r2' });
    await h.hook(h.completed('evt_1'));
    const { url } = (await request(h.app).post('/v1/content/full').set(auth)).body as {
      url: string;
    };
    expect(new URL(url).searchParams.get('X-Amz-Expires')).toBe('300');
  });
});

describe("collector's edition", () => {
  const auth = { Authorization: 'Bearer t' };
  it('needs the collector entitlement and passes moderation', async () => {
    const h = harness();
    const send = (name: string) =>
      request(h.app).post('/v1/store/collector-name').set(auth).send({ name });
    expect((await send('Stoyan')).status).toBe(403);
    await h.hook(h.completed('evt_2', 'txn_02'));
    expect((await send('<script>')).status).toBe(400);
    expect((await send('Admin Petko')).status).toBe(400);
    expect((await send('Stoyan of Mrak')).body).toEqual({ status: 'pending' });
    expect((await request(h.app).post('/v1/content/full').set(auth)).status).toBe(200); // collector ⊃ full
  });
});
