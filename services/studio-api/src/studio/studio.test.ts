/** Studio acceptance (docs/systems/studio.md → Tests). Works on a temporary copy of the content. */
/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-argument -- supertest bodies are untyped JSON */
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { IssueList, validatePack } from '@mrak/content-schema';
import { loadRawPack } from '@mrak/content-schema/node';
import { exportJWK, generateKeyPair, SignJWT } from 'jose';
import request from 'supertest';
import { afterAll, describe, expect, it } from 'vitest';
import { accessVerifier } from '../access.js';
import { createApp } from '../app.js';
import { Studio } from './content.js';
import { MemoryContentStore } from './store.js';

const work = mkdtempSync(join(tmpdir(), 'mrak-studio-'));
const root = join(work, 'content');
cpSync(new URL('../../../../packages/content', import.meta.url).pathname, root, {
  recursive: true,
});
afterAll(() => {
  rmSync(work, { recursive: true, force: true });
});

const studio = new Studio({
  store: new MemoryContentStore(),
  contentRoot: root,
  exportDir: join(work, 'export'),
  now: () => new Date('2026-11-18T10:00:00Z'),
});
const app = createApp({ studio });
const events = JSON.parse(readFileSync(join(root, 'data/events/events.json'), 'utf8')) as Record<
  string,
  unknown
>[];
const template = events.find((e) => e['tier'] === 'demo') ?? {};
const EVENT: Record<string, unknown> = {
  ...template,
  id: 'studio-test-omen',
  nameKey: 'event.studio-test-omen.name',
  textKey: 'event.studio-test-omen.text',
  conditions: { flag: 'studio-never-set' },
};

async function put(
  collection: string,
  id: string,
  body: unknown,
  expectedVersion: number | null = null,
) {
  return request(app).put(`/v1/entries/${collection}/${id}`).send({ body, expectedVersion });
}
async function publish(collection: string, id: string) {
  await request(app)
    .post(`/v1/entries/${collection}/${id}/status`)
    .send({ status: 'reviewed' })
    .expect(200);
  await request(app)
    .post(`/v1/entries/${collection}/${id}/status`)
    .send({ status: 'published' })
    .expect(200);
}

describe('studio: import → edit → analyse → export', () => {
  it('imports packages/content as published entries', async () => {
    const res = await request(app).post('/v1/import').expect(200);
    expect(res.body.created).toBeGreaterThan(500);
    const schemas = await request(app).get('/v1/schemas').expect(200);
    expect(Object.keys(schemas.body.schemas)).toContain('events');
    const again = await request(app).post('/v1/import').expect(200);
    expect(again.body).toMatchObject({ created: 0, updated: 0 });
  });

  it('validates bodies with the Zod schema and refuses stale versions', async () => {
    const bad = await put('events', 'broken', { id: 'broken', tier: 'demo' });
    expect(bad.status).toBe(422);
    expect(bad.body.error).toBe('invalid_body');
    const stale = await put('events', 'bell-at-333', events[0], null);
    expect(stale.status).toBe(409);
  });

  it('creates an event (and its texts and flag) with history and diff', async () => {
    const reg = (await request(app).get('/v1/entries/registry/flags')).body as {
      body: { flags: unknown[] };
      version: number;
    };
    const flags = {
      ...reg.body,
      flags: [...reg.body.flags, { id: 'studio-never-set', description: 'Studio test flag.' }],
    };
    expect((await put('registry', 'flags', flags, reg.version)).status).toBe(200);
    expect((await put('locales', 'event.studio-test-omen.name', 'A test omen')).status).toBe(200);
    expect((await put('locales', 'event.studio-test-omen.text', 'Something stirs.')).status).toBe(
      200,
    );
    const created = await put('events', 'studio-test-omen', EVENT);
    expect(created.status).toBe(200);
    expect(created.body).toMatchObject({ status: 'draft', version: 1 });
    const edited = await put('events', 'studio-test-omen', { ...EVENT, weight: 7 }, 1);
    expect(edited.body.version).toBe(2);
    const diff = await request(app).get('/v1/entries/events/studio-test-omen/diff?from=1&to=2');
    expect(diff.body.changes).toEqual([{ path: 'weight', before: EVENT['weight'], after: 7 }]);
    for (const [c, id] of [
      ['registry', 'flags'],
      ['locales', 'event.studio-test-omen.name'],
      ['locales', 'event.studio-test-omen.text'],
      ['events', 'studio-test-omen'],
    ] as const)
      await publish(c, id);
    const history = await request(app).get('/v1/entries/events/studio-test-omen/history');
    expect(history.body.revisions.map((r: { status: string }) => r.status)).toEqual([
      'published',
      'reviewed',
      'draft',
      'draft',
    ]);
  });

  it('analysis reports a flag nobody sets and the event it makes unreachable', async () => {
    const res = await request(app).get('/v1/analysis').expect(200);
    const findings = res.body.findings as { code: string; flag: string; entity?: { id: string } }[];
    expect(findings).toContainEqual(
      expect.objectContaining({ code: 'flag-never-set', flag: 'studio-never-set' }),
    );
    expect(
      findings.some((f) => f.code === 'maybe-unreachable' && f.entity?.id === 'studio-test-omen'),
    ).toBe(true);
    expect(res.body.graph.nodes.length).toBeGreaterThan(10);
    expect(res.body.villagers.length).toBeGreaterThan(0);
    expect(res.body.mysteries.length).toBeGreaterThan(0);
  });

  it('exports the pack: the game content has the event, manifest bumped, demo and full packs', async () => {
    const before = JSON.parse(readFileSync(join(root, 'manifest.json'), 'utf8')) as {
      version: string;
    };
    const res = await request(app).post('/v1/export').expect(200);
    expect(res.body.written).toContain('data/events/events.json');
    expect(res.body.version).not.toBe(before.version);
    expect(res.body.demo.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(existsSync(res.body.full.file)).toBe(true);
    const raw = loadRawPack(root, new IssueList());
    expect(validatePack(raw).ok).toBe(true);
    const exported = (raw.collections.events ?? []).flatMap((e) => e.data as { id: string }[]);
    expect(exported.map((e) => e.id)).toContain('studio-test-omen');
    const manifest = JSON.parse(readFileSync(join(root, 'manifest.json'), 'utf8')) as {
      version: string;
      hash: string;
    };
    expect(manifest).toMatchObject({ version: res.body.version, hash: res.body.hash });
  });

  it('only published bodies are exported; review needs another person', async () => {
    const v = (await studio.get('events', 'studio-test-omen')).version;
    expect((await put('events', 'studio-test-omen', { ...EVENT, weight: 9 }, v)).status).toBe(200);
    const { raw } = await studio.rawPack();
    const ev = (raw.collections.events ?? []).flatMap(
      (e) => e.data as { id: string; weight: number }[],
    );
    expect(ev.find((e) => e.id === 'studio-test-omen')?.weight).toBe(7);
    await studio.put(
      'events',
      'studio-test-omen',
      { ...EVENT, weight: 3 },
      'ana@mrak.game',
      v + 1,
      null,
    );
    await expect(
      studio.setStatus('events', 'studio-test-omen', 'reviewed', 'ana@mrak.game'),
    ).rejects.toThrow('review_by_another_person');
    await expect(
      studio.setStatus('events', 'studio-test-omen', 'published', 'bo@mrak.game'),
    ).rejects.toThrow('needs_review');
  });
});

describe('studio access (never public)', () => {
  it('without Access only local peers are served', async () => {
    const closed = createApp({ studio, allowPeer: () => false });
    expect((await request(closed).get('/v1/entries')).status).toBe(403);
    expect((await request(closed).get('/health')).status).toBe(200);
  });

  it('with Access every request needs a valid Cloudflare Access JWT', async () => {
    const { publicKey, privateKey } = await generateKeyPair('RS256');
    const jwk = { ...(await exportJWK(publicKey)), kid: 'k1', alg: 'RS256' };
    const verify = accessVerifier('mrak.cloudflareaccess.com', 'aud-1', { keys: [jwk] });
    const guarded = createApp({ studio, access: verify });
    const sign = (aud: string) =>
      new SignJWT({ email: 'ana@mrak.game' })
        .setProtectedHeader({ alg: 'RS256', kid: 'k1' })
        .setIssuer('https://mrak.cloudflareaccess.com')
        .setAudience(aud)
        .setExpirationTime('5m')
        .sign(privateKey);
    expect((await request(guarded).get('/v1/entries')).status).toBe(401);
    expect(
      (
        await request(guarded)
          .get('/v1/entries')
          .set('Cf-Access-Jwt-Assertion', await sign('other'))
      ).status,
    ).toBe(401);
    expect(
      (
        await request(guarded)
          .get('/v1/entries')
          .set('Cf-Access-Jwt-Assertion', await sign('aud-1'))
      ).status,
    ).toBe(200);
  });
});
