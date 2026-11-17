import { generateKeyPair, SignJWT, importJWK, type JWK } from 'jose';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from '../app.js';
import { MemoryProgressStore } from '../progress/store.js';
import { loadCatalog } from '../progress/catalog.js';
import { CSRF_HEADER, REFRESH_COOKIE } from './controller.js';
import { MemoryCounters } from './guards.js';
import { generateSigningJwk } from './keys.js';
import { MemoryMailer } from './mailer.js';
import { MemoryAuthRepository } from './repository.js';
import { buildAuth } from './setup.js';
import { ACCESS_TTL_S } from './tokens.js';
import { fileURLToPath } from 'node:url';

const ORIGIN = 'https://play.mrak.game';
const PASSWORD = 'correct horse battery staple';
const ISS = 'https://api.mrak.game';
const AUD = 'mrak-game';
const catalog = loadCatalog(
  fileURLToPath(new URL('../../../../packages/content/data', import.meta.url)),
);

let ipSeq = 0;
const nextIp = () => `203.0.113.${String((ipSeq++ % 250) + 1)}`;

interface Problem {
  status: number;
  error: string;
  captcha?: boolean;
}
interface IssuedBody {
  accessToken: string;
  refreshToken?: string;
  user: { id: string; emailVerified: boolean; displayName: string | null };
}
const asProblem = (res: { body: unknown }) => res.body as Problem;
const asIssued = (res: { body: unknown }) => res.body as IssuedBody;
const settle = () => new Promise((r) => setImmediate(r));

async function harness(opts: { pwned?: boolean } = {}) {
  let clock = Date.parse('2026-11-17T12:00:00Z');
  const now = () => new Date(clock);
  const repo = new MemoryAuthRepository();
  const mailer = new MemoryMailer();
  const progress = new MemoryProgressStore();
  const human: string[] = [];
  const jwk = await generateSigningJwk('k1');
  const auth = await buildAuth({
    repo,
    counters: new MemoryCounters(() => clock),
    mailer,
    jwtKeys: JSON.stringify([jwk]),
    issuer: ISS,
    audience: AUD,
    appUrl: 'https://play.mrak.game',
    secret: 'test-secret-test-secret-test-secret!!',
    http: { allowedOrigins: [ORIGIN], cookieDomain: 'mrak.game' },
    human: (token, _ip, action) => {
      human.push(action);
      return Promise.resolve(token === 'human-ok');
    },
    ...(opts.pwned ? { pwned: (p: string) => Promise.resolve(p.includes('pwned')) } : {}),
    hooks: [
      { name: 'progress', export: (u) => progress.list(u), erase: (u) => progress.remove(u) },
    ],
    now,
  });
  const app = createApp({ auth, catalog, progress, corsOrigins: [ORIGIN], now });
  const agent = request(app);
  const post = (path: string, body: object, ip = nextIp()) =>
    agent
      .post(path)
      .set(CSRF_HEADER, '1')
      .set('Origin', ORIGIN)
      .set('X-Forwarded-For', ip)
      .send(body);
  const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });
  const lastLink = async (kind: string): Promise<string> => {
    await settle();
    const mail = [...mailer.sent].reverse().find((m) => m.kind === kind);
    return mail?.link?.split('#token=')[1] ?? '';
  };

  /** Registers, verifies and signs in on the web; returns tokens and the refresh cookie. */
  async function account(email: string, password = PASSWORD) {
    expect((await post('/v1/auth/register', { email, password, captcha: 'human-ok' })).status).toBe(
      202,
    );
    const token = await lastLink('verify-email');
    expect((await post('/v1/auth/verify-email', { token })).status).toBe(204);
    return login(email, password);
  }

  async function login(email: string, password = PASSWORD, ip = nextIp()) {
    const res = await post('/v1/auth/login', { email, password }, ip);
    expect(res.status).toBe(200);
    return { access: asIssued(res).accessToken, cookie: refreshCookie(res), res };
  }

  return {
    app,
    agent,
    post,
    bearer,
    repo,
    mailer,
    progress,
    human,
    jwk,
    account,
    login,
    lastLink,
    advance: (ms: number) => {
      clock += ms;
    },
    now,
  };
}

function refreshCookie(res: { headers: Record<string, unknown> }): string {
  const set = (res.headers['set-cookie'] as string[] | undefined) ?? [];
  const c = set.find((s) => s.startsWith(`${REFRESH_COOKIE}=`)) ?? '';
  return c.split(';')[0] ?? '';
}

const DAY = 24 * 3600_000;

describe('registration and email verification', () => {
  it('registers, verifies the email and signs in (happy path)', async () => {
    const h = await harness();
    const { access } = await h.account('Nikola@Example.com');
    const me = await h.agent.get('/v1/me').set(h.bearer(access));
    expect(me.status).toBe(200);
    expect(me.body).toMatchObject({ email: 'nikola@example.com', emailVerified: true });
    expect(me.headers['cache-control']).toBe('no-store');
    expect(h.human).toContain('register');
  });

  it('needs Turnstile, refuses disposable domains, short, common and breached passwords', async () => {
    const h = await harness({ pwned: true });
    const reg = (body: object) => h.post('/v1/auth/register', { captcha: 'human-ok', ...body });
    const noCaptcha = await h.post('/v1/auth/register', { email: 'a@b.com', password: PASSWORD });
    expect(noCaptcha.status).toBe(400);
    expect(asProblem(noCaptcha)).toMatchObject({ error: 'captcha_required', captcha: true });
    expect(noCaptcha.type).toBe('application/problem+json');
    expect((await reg({ email: 'x@mailinator.com', password: PASSWORD })).status).toBe(422);
    expect((await reg({ email: 'x@sub.yopmail.com', password: PASSWORD })).status).toBe(422);
    expect((await reg({ email: 'x@b.com', password: 'short' })).status).toBe(422);
    expect((await reg({ email: 'x@b.com', password: 'password1234' })).status).toBe(422);
    expect((await reg({ email: 'x@b.com', password: 'aaaaaaaaaaaaaa' })).status).toBe(422);
    expect((await reg({ email: 'longname@b.com', password: 'xxlongnamexx99' })).status).toBe(422);
    expect((await reg({ email: 'x@b.com', password: 'a-pwned-password-here' })).status).toBe(422);
    expect((await reg({ email: 'x@b.com', password: 'p'.repeat(129) })).status).toBe(422);
    expect((await reg({ email: 'x@b.com', password: PASSWORD, role: 'admin' })).status).toBe(400);
    expect(
      (await reg({ email: 'x@b.com', password: PASSWORD, displayName: '<img src=x>' })).status,
    ).toBe(400);
  });

  it('answers the same whether or not the email exists (anti-enumeration)', async () => {
    const h = await harness();
    await h.account('taken@example.com');
    const fresh = await h.post('/v1/auth/register', {
      email: 'new@example.com',
      password: PASSWORD,
      captcha: 'human-ok',
    });
    const taken = await h.post('/v1/auth/register', {
      email: 'TAKEN@example.com',
      password: PASSWORD,
      captcha: 'human-ok',
    });
    expect([taken.status, taken.body]).toEqual([fresh.status, fresh.body]);
    await settle();
    expect(h.mailer.sent.map((m) => m.kind)).toContain('already-registered');
  });

  it('verification tokens are single use and expire; resend needs Turnstile', async () => {
    const h = await harness();
    await h.post('/v1/auth/register', {
      email: 'v@example.com',
      password: PASSWORD,
      captcha: 'human-ok',
    });
    const first = await h.lastLink('verify-email');
    expect((await h.post('/v1/auth/resend-verification', { email: 'v@example.com' })).status).toBe(
      400,
    );
    expect(
      (
        await h.post('/v1/auth/resend-verification', {
          email: 'v@example.com',
          captcha: 'human-ok',
        })
      ).status,
    ).toBe(202);
    const second = await h.lastLink('verify-email');
    expect(second).not.toBe(first);
    // Only the newest token is valid.
    expect((await h.post('/v1/auth/verify-email', { token: first })).status).toBe(400);
    h.advance(DAY + 1);
    expect((await h.post('/v1/auth/verify-email', { token: second })).status).toBe(400);
    expect(
      (
        await h.post('/v1/auth/resend-verification', {
          email: 'nobody@example.com',
          captcha: 'human-ok',
        })
      ).status,
    ).toBe(202);
  });
});

describe('login, cookies and CSRF', () => {
  it('web login sets the refresh cookie with exact attributes and no token in the body', async () => {
    const h = await harness();
    const { res } = await h.account('web@example.com');
    const set = (res.headers['set-cookie'] as unknown as string[])[0] ?? '';
    expect(set).toMatch(
      /^__Secure-mrak_rt=[\w-]{43}; Path=\/v1\/auth; Domain=mrak\.game; HttpOnly; Secure; SameSite=Strict; Max-Age=2592000$/,
    );
    expect(asIssued(res).refreshToken).toBeUndefined();
    expect(res.body).toMatchObject({ expiresIn: ACCESS_TTL_S });
  });

  it('native platforms get the refresh token in the body and no cookie', async () => {
    const h = await harness();
    await h.account('app@example.com');
    const res = await h.agent
      .post('/v1/auth/login')
      .set(CSRF_HEADER, '1')
      .send({ email: 'app@example.com', password: PASSWORD, platform: 'android' });
    expect(res.status).toBe(200);
    expect(res.headers['set-cookie']).toBeUndefined();
    const refreshed = await h.agent
      .post('/v1/auth/refresh')
      .set(CSRF_HEADER, '1')
      .send({ refreshToken: asIssued(res).refreshToken });
    expect(refreshed.status).toBe(200);
  });

  it('refuses requests without the CSRF header, from foreign origins, or cookies without Origin', async () => {
    const h = await harness();
    const { cookie } = await h.account('csrf@example.com');
    const noHeader = await h.agent
      .post('/v1/auth/login')
      .set('Origin', ORIGIN)
      .send({ email: 'csrf@example.com', password: PASSWORD });
    expect(noHeader.status).toBe(403);
    const foreign = await h.agent
      .post('/v1/auth/refresh')
      .set(CSRF_HEADER, '1')
      .set('Origin', 'https://evil.example')
      .set('Cookie', cookie)
      .send({});
    expect(foreign.status).toBe(403);
    const noOrigin = await h.agent
      .post('/v1/auth/refresh')
      .set(CSRF_HEADER, '1')
      .set('Cookie', cookie)
      .send({});
    expect(noOrigin.status).toBe(403);
  });

  it('CORS allows only the exact origins, credentials only on /v1/auth', async () => {
    const h = await harness();
    const ok = await h.agent
      .options('/v1/auth/login')
      .set('Origin', ORIGIN)
      .set('Access-Control-Request-Method', 'POST');
    expect(ok.headers['access-control-allow-origin']).toBe(ORIGIN);
    expect(ok.headers['access-control-allow-credentials']).toBe('true');
    const me = await h.agent
      .options('/v1/me')
      .set('Origin', ORIGIN)
      .set('Access-Control-Request-Method', 'GET');
    expect(me.headers['access-control-allow-credentials']).toBeUndefined();
    const evil = await h.agent
      .options('/v1/auth/login')
      .set('Origin', 'https://play.mrak.game.evil.example');
    expect(evil.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('wrong password and unknown account look the same, in body and in time', async () => {
    const h = await harness();
    await h.account('real@example.com');
    const wrong = await h.post('/v1/auth/login', {
      email: 'real@example.com',
      password: 'not the password!',
    });
    const unknown = await h.post('/v1/auth/login', {
      email: 'ghost@example.com',
      password: 'not the password!',
    });
    expect([wrong.status, wrong.body]).toEqual([unknown.status, unknown.body]);
    expect(wrong.status).toBe(401);
    const time = async (email: string) => {
      const t = performance.now();
      await h.post('/v1/auth/login', { email, password: 'not the password!' });
      return performance.now() - t;
    };
    const known: number[] = [];
    const ghost: number[] = [];
    for (let i = 0; i < 9; i++) {
      // A fresh account key each time keeps the throttle out of the measurement.
      known.push(await time('real@example.com'));
      ghost.push(await time(`ghost${String(i)}@example.com`));
      h.advance(3600_000);
    }
    const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] ?? 0;
    const ratio = median(known) / median(ghost);
    expect(ratio).toBeGreaterThan(0.5);
    expect(ratio).toBeLessThan(2);
  });
});

describe('refresh tokens', () => {
  it('rotation changes the token; reusing the old one revokes the family and the session', async () => {
    const h = await harness();
    const { cookie, access } = await h.account('rot@example.com');
    const refresh = (c: string) =>
      h.agent
        .post('/v1/auth/refresh')
        .set(CSRF_HEADER, '1')
        .set('Origin', ORIGIN)
        .set('Cookie', c)
        .send({});
    const r1 = await refresh(cookie);
    expect(r1.status).toBe(200);
    const next = refreshCookie(r1);
    expect(next).not.toBe(cookie);
    expect(next.length).toBeGreaterThan(40);
    const reuse = await refresh(cookie);
    expect(reuse.status).toBe(401);
    expect(refreshCookie(reuse)).toBe(`${REFRESH_COOKIE}=`); // cookie cleared
    expect((await refresh(next)).status).toBe(401);
    expect((await h.agent.get('/v1/me').set(h.bearer(access))).status).toBe(401);
    expect(h.repo.auditRows.map((a) => a.action)).toContain('refresh-reuse');
    await h.lastLink('x');
    expect(h.mailer.sent.map((m) => m.kind)).toContain('session-revoked-reuse');
    // Only the hash is stored.
    const raw = cookie.split('=')[1] ?? '';
    expect([...h.repo.refresh.values()].some((r) => r.tokenHash === raw)).toBe(false);
  });

  it('refresh fails after logout, after logout-all, when expired and past the absolute limit', async () => {
    const h = await harness();
    const refresh = (c: string) =>
      h.agent
        .post('/v1/auth/refresh')
        .set(CSRF_HEADER, '1')
        .set('Origin', ORIGIN)
        .set('Cookie', c)
        .send({});
    const a = await h.account('life@example.com');
    const out = await h.agent
      .post('/v1/auth/logout')
      .set(CSRF_HEADER, '1')
      .set('Origin', ORIGIN)
      .set('Cookie', a.cookie)
      .send({});
    expect(out.status).toBe(204);
    expect(refreshCookie(out)).toBe(`${REFRESH_COOKIE}=`);
    expect((await refresh(a.cookie)).status).toBe(401);
    expect((await h.agent.get('/v1/me').set(h.bearer(a.access))).status).toBe(401);

    const b = await h.login('life@example.com');
    const c = await h.login('life@example.com');
    expect((await h.agent.post('/v1/auth/logout-all').set(h.bearer(b.access))).status).toBe(204);
    expect((await refresh(c.cookie)).status).toBe(401);

    const d = await h.login('life@example.com');
    h.advance(31 * DAY);
    expect((await refresh(d.cookie)).status).toBe(401);

    // Sliding: refreshing every 25 days keeps it alive until the 90-day absolute limit.
    let e = (await h.login('life@example.com')).cookie;
    for (let day = 25; day < 90; day += 25) {
      h.advance(25 * DAY);
      const r = await refresh(e);
      expect(r.status).toBe(200);
      e = refreshCookie(r);
    }
    h.advance(16 * DAY);
    expect((await refresh(e)).status).toBe(401);
    expect((await refresh(`${REFRESH_COOKIE}=unknown-token-unknown-token-unknown`)).status).toBe(
      401,
    );
    expect((await h.agent.post('/v1/auth/refresh').set(CSRF_HEADER, '1').send({})).status).toBe(
      401,
    );
  });
});

describe('access tokens', () => {
  it('rejects expired, tampered, alg none, other alg, unknown kid and wrong iss/aud', async () => {
    const h = await harness();
    const { access } = await h.account('jwt@example.com');
    const me = (t: string) => h.agent.get('/v1/me').set(h.bearer(t));
    expect((await me(access)).status).toBe(200);
    const [head = '', payload = '', sig = ''] = access.split('.');
    const claims = JSON.parse(Buffer.from(payload, 'base64url').toString()) as Record<
      string,
      unknown
    >;
    const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');

    const tampered = `${head}.${b64({ ...claims, sub: '00000000-0000-7000-8000-000000000000' })}.${sig}`;
    expect((await me(tampered)).status).toBe(401);
    expect((await me(`${b64({ alg: 'none', typ: 'at+jwt', kid: 'k1' })}.${payload}.`)).status).toBe(
      401,
    );
    expect(
      (await me(`${b64({ alg: 'none', typ: 'at+jwt', kid: 'k1' })}.${payload}.AA`)).status,
    ).toBe(401);

    const sign = async (
      alg: string,
      key: Parameters<SignJWT['sign']>[0],
      header: object = {},
      extra: object = {},
    ) =>
      new SignJWT({ ...claims, ...extra })
        .setProtectedHeader({ alg, typ: 'at+jwt', kid: 'k1', ...header })
        .sign(key);
    const pub = { ...h.jwk };
    delete pub.d;
    expect(
      (await me(await sign('HS256', new TextEncoder().encode(JSON.stringify(pub))))).status,
    ).toBe(401);
    const es = await generateKeyPair('ES256');
    expect((await me(await sign('ES256', es.privateKey))).status).toBe(401);
    const other = await generateKeyPair('EdDSA', { crv: 'Ed25519' });
    expect((await me(await sign('EdDSA', other.privateKey, { kid: 'k2' }))).status).toBe(401);
    expect((await me(await sign('EdDSA', other.privateKey))).status).toBe(401);
    const real = await importJWK({ ...h.jwk, alg: 'EdDSA' }, 'EdDSA');
    expect((await me(await sign('EdDSA', real))).status).toBe(200);
    expect((await me(await sign('EdDSA', real, {}, { iss: 'https://evil.example' }))).status).toBe(
      401,
    );
    expect((await me(await sign('EdDSA', real, {}, { aud: 'someone-else' }))).status).toBe(401);
    expect((await me(await sign('EdDSA', real, { typ: 'JWT' }))).status).toBe(401);

    h.advance((ACCESS_TTL_S + 10) * 1000);
    const expired = await me(access);
    expect(expired.status).toBe(401);
    expect(expired.headers['www-authenticate']).toBe('Bearer');
  });

  it('publishes the public JWKS without private parts', async () => {
    const h = await harness();
    const res = await h.agent.get('/.well-known/jwks.json');
    expect(res.status).toBe(200);
    const keys = (res.body as { keys: JWK[] }).keys;
    expect(keys).toHaveLength(1);
    expect(keys[0]).toMatchObject({ kid: 'k1', alg: 'EdDSA', crv: 'Ed25519' });
    expect(keys[0]?.d).toBeUndefined();
  });
});

describe('progressive lockout and captcha', () => {
  it('asks for Turnstile after 3 failures, blocks with Retry-After after 5, never permanently', async () => {
    const h = await harness();
    await h.account('lock@example.com');
    const ip = '198.51.100.7';
    const attempt = (password: string, captcha?: string) =>
      h.post(
        '/v1/auth/login',
        { email: 'lock@example.com', password, ...(captcha ? { captcha } : {}) },
        ip,
      );
    for (let i = 0; i < 3; i++) expect((await attempt('wrong password!!')).status).toBe(401);
    const needs = await attempt('wrong password!!');
    expect(asProblem(needs)).toMatchObject({ error: 'captcha_required', captcha: true });
    expect((await attempt('wrong password!!', 'robot')).status).toBe(400);
    for (let i = 0; i < 3; i++)
      expect((await attempt('wrong password!!', 'human-ok')).status).toBe(401);
    const blocked = await attempt(PASSWORD, 'human-ok');
    expect(blocked.status).toBe(429);
    expect(Number(blocked.headers['retry-after'])).toBeGreaterThan(0);
    // The block is per account: another IP is blocked too.
    expect(
      (
        await h.post('/v1/auth/login', {
          email: 'lock@example.com',
          password: PASSWORD,
          captcha: 'human-ok',
        })
      ).status,
    ).toBe(429);
    h.advance(16 * 60_000);
    expect((await attempt(PASSWORD, 'human-ok')).status).toBe(200);
    // Success clears the account counter: no captcha needed next time.
    expect(
      (await h.post('/v1/auth/login', { email: 'lock@example.com', password: PASSWORD })).status,
    ).toBe(200);
  });

  it('throttles one IP that tries many accounts (credential stuffing)', async () => {
    const h = await harness();
    const ip = '198.51.100.99';
    let last = 0;
    for (let i = 0; i < 21; i++) {
      const r = await h.post(
        '/v1/auth/login',
        { email: `u${String(i)}@example.com`, password: 'wrong password!!', captcha: 'human-ok' },
        ip,
      );
      last = r.status;
      h.advance(61_000); // stay under the per-route limiter window
    }
    expect(last).toBe(429);
  });
});

describe('the signed-in account', () => {
  it('lists sessions and cannot revoke another user’s session (IDOR)', async () => {
    const h = await harness();
    const a = await h.account('alice@example.com');
    const b = await h.account('bob@example.com');
    const list = await h.agent.get('/v1/me/sessions').set(h.bearer(a.access));
    const sessions = (list.body as { sessions: { id: string; current: boolean }[] }).sessions;
    expect(sessions).toHaveLength(1);
    expect(sessions[0]?.current).toBe(true);
    const aliceSession = sessions[0]?.id ?? '';
    const steal = await h.agent.delete(`/v1/me/sessions/${aliceSession}`).set(h.bearer(b.access));
    expect(steal.status).toBe(404);
    expect((await h.agent.get('/v1/me').set(h.bearer(a.access))).status).toBe(200);
    expect(
      (await h.agent.delete('/v1/me/sessions/not-a-uuid').set(h.bearer(a.access))).status,
    ).toBe(404);
    expect(
      (await h.agent.delete(`/v1/me/sessions/${aliceSession}`).set(h.bearer(a.access))).status,
    ).toBe(204);
    expect((await h.agent.get('/v1/me').set(h.bearer(a.access))).status).toBe(401);
    expect((await h.agent.get('/v1/me/sessions')).status).toBe(401);
  });

  it('updates the display name and refuses markup', async () => {
    const h = await harness();
    const { access } = await h.account('name@example.com');
    const ok = await h.agent
      .patch('/v1/me')
      .set(h.bearer(access))
      .send({ displayName: 'Rada Svetleva' });
    expect(ok.body).toMatchObject({ displayName: 'Rada Svetleva' });
    expect(
      (await h.agent.patch('/v1/me').set(h.bearer(access)).send({ displayName: '<b>x</b>' }))
        .status,
    ).toBe(400);
    expect(
      (await h.agent.patch('/v1/me').set(h.bearer(access)).send({ email: 'x@y.z' })).status,
    ).toBe(400);
    expect((await h.agent.patch('/v1/me').set(h.bearer(access)).send({})).status).toBe(200);
  });

  it('changing the password needs the current one and revokes every session', async () => {
    const h = await harness();
    const a = await h.account('chg@example.com');
    const other = await h.login('chg@example.com');
    const change = (body: object) =>
      h.agent.post('/v1/me/change-password').set(h.bearer(a.access)).send(body);
    expect(
      (await change({ currentPassword: 'wrong password!!', newPassword: 'a brand new passphrase' }))
        .status,
    ).toBe(401);
    expect((await change({ currentPassword: PASSWORD, newPassword: 'short' })).status).toBe(422);
    expect(
      (await change({ currentPassword: PASSWORD, newPassword: 'a brand new passphrase' })).status,
    ).toBe(204);
    expect((await h.agent.get('/v1/me').set(h.bearer(a.access))).status).toBe(401);
    expect((await h.agent.get('/v1/me').set(h.bearer(other.access))).status).toBe(401);
    expect(
      (await h.post('/v1/auth/login', { email: 'chg@example.com', password: PASSWORD })).status,
    ).toBe(401);
    await h.login('chg@example.com', 'a brand new passphrase');
  });

  it('password reset: single-use, expiring, revokes sessions, never signs in, same answer for unknown emails', async () => {
    const h = await harness();
    const a = await h.account('reset@example.com');
    const forgot = (email: string, captcha?: string) =>
      h.post('/v1/auth/forgot-password', { email, ...(captcha ? { captcha } : {}) });
    expect((await forgot('reset@example.com')).status).toBe(400);
    const known = await forgot('reset@example.com', 'human-ok');
    const unknown = await forgot('nobody@example.com', 'human-ok');
    expect([known.status, known.body]).toEqual([unknown.status, unknown.body]);
    const token = await h.lastLink('reset-password');
    const mail = h.mailer.sent.find((m) => m.kind === 'reset-password');
    expect(mail?.link?.startsWith('https://play.mrak.game/account/reset#token=')).toBe(true);
    expect((await h.post('/v1/auth/reset-password', { token, password: 'tiny' })).status).toBe(422);
    const done = await h.post('/v1/auth/reset-password', {
      token,
      password: 'brand new winter phrase',
    });
    expect(done.status).toBe(204);
    expect(done.headers['set-cookie']).toBeUndefined();
    expect(
      (await h.post('/v1/auth/reset-password', { token, password: 'another passphrase!!' })).status,
    ).toBe(400);
    expect((await h.agent.get('/v1/me').set(h.bearer(a.access))).status).toBe(401);
    await h.login('reset@example.com', 'brand new winter phrase');

    await forgot('reset@example.com', 'human-ok');
    const late = await h.lastLink('reset-password');
    h.advance(31 * 60_000);
    expect(
      (await h.post('/v1/auth/reset-password', { token: late, password: 'too late passphrase' }))
        .status,
    ).toBe(400);
  });

  it('caps emails per recipient (email bombing)', async () => {
    const h = await harness();
    await h.account('bomb@example.com');
    for (let i = 0; i < 5; i++)
      await h.post('/v1/auth/forgot-password', { email: 'bomb@example.com', captcha: 'human-ok' });
    await settle();
    // 1 verification + 2 resets this hour (cap 3/h).
    expect(h.mailer.sent.filter((m) => m.to === 'bomb@example.com')).toHaveLength(3);
  });

  it('exports the account and deletes every trace of it', async () => {
    const h = await harness();
    const a = await h.account('gone@example.com');
    const userId = (await h.agent.get('/v1/me').set(h.bearer(a.access))).body as { id: string };
    await h.agent
      .post('/v1/achievements/unlock')
      .set(h.bearer(a.access))
      .send({ achievements: [{ id: 'prologue', at: 1 }] });
    const exp = await h.agent.get('/v1/me/export').set(h.bearer(a.access));
    expect(exp.status).toBe(200);
    expect(exp.body).toMatchObject({
      account: { email: 'gone@example.com' },
      progress: [{ key: 'prologue' }],
    });
    expect(JSON.stringify(exp.body)).not.toMatch(/passwordHash|tokenHash|argon2/);
    const del = (body: object) => h.agent.delete('/v1/me').set(h.bearer(a.access)).send(body);
    expect((await del({ password: PASSWORD })).status).toBe(400);
    expect((await del({ password: 'wrong password!!', confirm: 'DELETE' })).status).toBe(401);
    expect((await del({ password: PASSWORD, confirm: 'DELETE' })).status).toBe(204);
    expect(h.repo.users.size).toBe(0);
    expect(h.repo.sessionRows.size).toBe(0);
    expect(h.repo.refresh.size).toBe(0);
    expect(h.repo.emailTokens.size).toBe(0);
    expect(await h.progress.list(userId.id)).toEqual([]);
    expect(h.repo.auditRows.every((r) => r.userId === null)).toBe(true);
    expect(
      (await h.post('/v1/auth/login', { email: 'gone@example.com', password: PASSWORD })).status,
    ).toBe(401);
  });

  it('account progress needs a verified email', async () => {
    const h = await harness();
    await h.post('/v1/auth/register', {
      email: 'unv@example.com',
      password: PASSWORD,
      captcha: 'human-ok',
    });
    const { access } = await h.login('unv@example.com');
    expect((await h.agent.get('/v1/achievements').set(h.bearer(access))).status).toBe(403);
  });
});

describe('transport hardening', () => {
  it('refuses compressed bodies and answers problems without stack traces', async () => {
    const h = await harness();
    const gz = await h.agent
      .post('/v1/auth/login')
      .set(CSRF_HEADER, '1')
      .set('Content-Encoding', 'gzip')
      .set('Content-Type', 'application/json')
      .send(Buffer.from([0x1f, 0x8b]));
    expect(gz.status).toBe(415);
    const bad = await h.agent
      .post('/v1/auth/login')
      .set(CSRF_HEADER, '1')
      .set('Content-Type', 'application/json')
      .send('{"email":');
    expect(bad.status).toBe(400);
    expect(JSON.stringify(bad.body)).not.toMatch(/at .*\.(ts|js)/);
  });
});
