import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from '../app.js';
import { MemoryBugStore } from './bugs.js';

const base = { version: '0.1.0', platform: 'web', description: 'The well swallowed my lantern.' };

function app() {
  const bugs = new MemoryBugStore();
  return { bugs, agent: request(createApp({ bugs })) };
}

describe('POST /v1/bug-reports', () => {
  it('stores a report; save and seed only together (consent)', async () => {
    const { bugs, agent } = app();
    expect((await agent.post('/v1/bug-reports').send(base)).status).toBe(201);
    expect(
      (await agent.post('/v1/bug-reports').send({ ...base, seed: 42, save: '{"v":3}' })).status,
    ).toBe(201);
    expect((await agent.post('/v1/bug-reports').send({ ...base, seed: 42 })).status).toBe(400);
    expect(bugs.reports.map((r) => r.seed ?? null)).toEqual([null, 42]);
  });

  it('refuses extra fields (no contact, no IP), empty text and oversize bodies', async () => {
    const { bugs, agent } = app();
    expect((await agent.post('/v1/bug-reports').send({ ...base, email: 'a@b.c' })).status).toBe(
      400,
    );
    expect((await agent.post('/v1/bug-reports').send({ ...base, description: ' ' })).status).toBe(
      400,
    );
    const big = { ...base, seed: 1, save: 'x'.repeat(1_100_000) };
    expect((await agent.post('/v1/bug-reports').send(big)).status).toBe(413);
    expect(bugs.reports).toHaveLength(0);
  });

  it('rate limit: 10 per hour per IP', async () => {
    const { agent } = app();
    for (let i = 0; i < 10; i++)
      expect((await agent.post('/v1/bug-reports').send(base)).status).toBe(201);
    expect((await agent.post('/v1/bug-reports').send(base)).status).toBe(429);
  });

  it('retention purges old reports', async () => {
    const bugs = new MemoryBugStore();
    await bugs.add({ version: '1', platform: 'web', description: 'x' });
    expect(await bugs.purge(new Date(Date.now() + 1000))).toBe(1);
  });
});
