import type { Redis } from 'ioredis';
import { describe, expect, it } from 'vitest';
import { ipHasher, keyedHash, MemoryCounters, RedisCounters, turnstile } from './guards.js';
import { generateSigningJwk, loadKeyStore } from './keys.js';
import { isDisposableEmail } from './lists.js';
import {
  ARGON2_OPTIONS,
  hashPassword,
  HashBusyError,
  hibpCheck,
  verifyPassword,
  weakPassword,
} from './passwords.js';
import { sha256, TokenIssuer, uuidv7 } from './tokens.js';

const json = (body: unknown, ok = true) =>
  Promise.resolve(
    new Response(typeof body === 'string' ? body : JSON.stringify(body), {
      status: ok ? 200 : 500,
    }),
  );

describe('Turnstile verification (server side)', () => {
  const verify = (reply: () => Promise<Response>) =>
    turnstile('secret', ['play.mrak.game'], () => reply());
  it('accepts only success with the expected action and hostname', async () => {
    const good = { success: true, action: 'login', hostname: 'play.mrak.game' };
    expect(await verify(() => json(good))('t', '1.2.3.4', 'login')).toBe(true);
    expect(await verify(() => json(good))('t', '1.2.3.4', 'register')).toBe(false);
    expect(
      await verify(() => json({ ...good, hostname: 'evil.example' }))('t', 'ip', 'login'),
    ).toBe(false);
    expect(await verify(() => json({ ...good, success: false }))('t', 'ip', 'login')).toBe(false);
    expect(await verify(() => json({ nonsense: 1 }))('t', 'ip', 'login')).toBe(false);
    expect(await verify(() => Promise.reject(new Error('down')))('t', 'ip', 'login')).toBe(false);
    expect(await verify(() => json(good))(undefined, 'ip', 'login')).toBe(false);
    expect(await verify(() => json(good))('x'.repeat(3000), 'ip', 'login')).toBe(false);
  });
});

describe('Have I Been Pwned (k-anonymity)', () => {
  // SHA-1("password123456") = 4E... ; we only need the suffix logic: build the reply from it.
  it('finds a breached suffix, ignores padding rows and fails open', async () => {
    const { createHash } = await import('node:crypto');
    const sha = createHash('sha1').update('hunter2hunter2').digest('hex').toUpperCase();
    let asked = '';
    const fake = ((url: string) => {
      asked = url;
      return json(`AAAA:1\n${sha.slice(5)}:42\n`);
    }) as unknown as typeof fetch;
    expect(await hibpCheck(fake)('hunter2hunter2')).toBe(true);
    expect(asked.endsWith(`/range/${sha.slice(0, 5)}`)).toBe(true);
    const padded = (() => json(`${sha.slice(5)}:0\n`)) as unknown as typeof fetch;
    expect(await hibpCheck(padded)('hunter2hunter2')).toBe(false);
    expect(await hibpCheck(() => json('', false))('x')).toBeNull();
    expect(await hibpCheck(() => Promise.reject(new Error('x')))('x')).toBeNull();
  });
});

describe('passwords', () => {
  it('uses the documented Argon2id parameters and verifies', async () => {
    expect(ARGON2_OPTIONS).toMatchObject({ memoryCost: 19_456, timeCost: 2, parallelism: 1 });
    const hash = await hashPassword('a long enough passphrase');
    expect(hash.startsWith('$argon2id$v=19$m=19456,t=2,p=1$')).toBe(true);
    expect(await verifyPassword(hash, 'a long enough passphrase')).toBe(true);
    expect(await verifyPassword(hash, 'wrong')).toBe(false);
    expect(await verifyPassword('not-a-hash', 'x')).toBe(false);
  });

  it('counts Unicode code points and refuses trivial ones', () => {
    expect(weakPassword('живот и смърт', 'a@b.c')).toBe(null);
    expect(weakPassword('ж'.repeat(11) + 'q', 'a@b.c')).toBe('common');
    expect(weakPassword('12345678901', 'a@b.c')).toBe('length');
    expect(weakPassword('zyxwvutsrqpo', 'a@b.c')).toBe('common');
  });

  it('sheds load when hashing is saturated instead of exhausting the CPU', async () => {
    const results = await Promise.allSettled(
      Array.from({ length: 80 }, () => verifyPassword('$argon2id$v=19$m=19456,t=2,p=1$x$y', 'p')),
    );
    expect(results.some((r) => r.status === 'rejected' && r.reason instanceof HashBusyError)).toBe(
      true,
    );
  });
});

describe('identifiers', () => {
  it('hashes IPs with a salt that rotates daily', () => {
    const h = ipHasher('s'.repeat(32));
    const d1 = new Date('2026-11-17T01:00:00Z');
    const d1b = new Date('2026-11-17T23:00:00Z');
    const d2 = new Date('2026-11-18T01:00:00Z');
    expect(h('1.2.3.4', d1)).toBe(h('1.2.3.4', d1b));
    expect(h('1.2.3.4', d1)).not.toBe(h('1.2.3.4', d2));
    expect(h('1.2.3.4', d1)).not.toContain('1.2.3.4');
    expect(keyedHash('k', 'x')).toHaveLength(64);
  });

  it('makes UUIDv7 ids and SHA-256 hashes', () => {
    expect(uuidv7(Date.parse('2026-01-01'))).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    expect(sha256('a')).toHaveLength(64);
    expect(isDisposableEmail('a@mail.yopmail.com')).toBe(true);
    expect(isDisposableEmail('a@gmail.com')).toBe(false);
  });
});

describe('keys and tokens', () => {
  it('signs with the first key and verifies with any published key (rotation)', async () => {
    const oldKey = await generateSigningJwk('old');
    const newKey = await generateSigningJwk('new');
    const before = new TokenIssuer(await loadKeyStore(JSON.stringify([oldKey])), 'i', 'a');
    const during = new TokenIssuer(await loadKeyStore(JSON.stringify([newKey, oldKey])), 'i', 'a');
    const now = new Date();
    const old = await before.sign({ sub: 'u', sid: 's' }, now);
    expect(await during.verify(old, now)).toEqual({ sub: 'u', sid: 's' });
    expect(await during.verify('a.b.', now)).toBeNull();
    await expect(loadKeyStore('[]')).rejects.toThrow();
    await expect(loadKeyStore('[{"kty":"RSA"}]')).rejects.toThrow();
  });
});

describe('counters', () => {
  it('memory counters expire with their window and blocks end', async () => {
    let t = 0;
    const c = new MemoryCounters(() => t);
    expect(await c.hit('k', 100)).toBe(1);
    expect(await c.hit('k', 100)).toBe(2);
    t = 150;
    expect(await c.get('k')).toBe(0);
    await c.block('k', 200);
    expect(await c.blockedUntil('k')).toBe(200);
    t = 201;
    expect(await c.blockedUntil('k')).toBe(0);
  });

  it('redis counters use INCR + PEXPIRE and SET PXAT', async () => {
    const store = new Map<string, string>();
    const calls: string[] = [];
    const fake = {
      incr: (k: string) => {
        const n = Number(store.get(k) ?? 0) + 1;
        store.set(k, String(n));
        return Promise.resolve(n);
      },
      pexpire: (k: string, ms: number) => {
        calls.push(`pexpire ${k} ${String(ms)}`);
        return Promise.resolve(1);
      },
      get: (k: string) => Promise.resolve(store.get(k) ?? null),
      del: (k: string) => Promise.resolve(store.delete(k) ? 1 : 0),
      set: (k: string, v: string, mode: string, at: number) => {
        calls.push(`set ${k} ${mode} ${String(at)}`);
        store.set(k, v);
        return Promise.resolve('OK');
      },
    } as unknown as Redis;
    const c = new RedisCounters(fake, 'p:');
    expect(await c.hit('a', 1000)).toBe(1);
    expect(await c.hit('a', 1000)).toBe(2);
    expect(calls).toEqual(['pexpire p:a 1000']);
    expect(await c.get('a')).toBe(2);
    await c.reset('a');
    expect(await c.get('a')).toBe(0);
    await c.block('a', 5000);
    expect(await c.blockedUntil('a')).toBe(5000);
    expect(calls).toContain('set p:block:a PXAT 5000');
  });
});
