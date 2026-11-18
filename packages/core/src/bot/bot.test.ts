import { describe, expect, it } from 'vitest';
import { Game } from '../game';
import { chronicleDb as db } from '../test/chronicle-fixture';
import { diffPaths, impossibleStates, playBot } from './bot';

// The bot plays real nights: generous timeouts for loaded CI machines.
describe('headless bot', { timeout: 30_000 }, () => {
  it('plays seeded nights without exceptions, soft-locks or impossible states', () => {
    for (const seed of [1, 2, 3]) {
      const r = playBot(db, { seed, nights: 3 });
      expect(r.problems).toEqual([]);
      expect(r.nights).toBe(3);
      expect(r.commands).toBeGreaterThan(10);
    }
  });

  it('is reproducible for a seed', () => {
    expect(playBot(db, { seed: 7, nights: 2 })).toEqual(playBot(db, { seed: 7, nights: 2 }));
  });

  it('flags impossible states and save differences', () => {
    const s = structuredClone(Game.newGame({ content: db, seed: 1 }).snapshot()) as {
      stats: Record<string, number>;
      clock: { minute: number };
      currentZone: string | null;
    };
    s.stats['sanity'] = Number.NaN;
    s.clock.minute = 1500;
    s.currentZone = 'atlantis';
    const found = impossibleStates(s as never).join(' | ');
    expect(found).toMatch(/stat sanity=NaN/);
    expect(found).toMatch(/clock minute 1500/);
    expect(found).toMatch(/unknown zone atlantis/);
    expect(diffPaths({ a: { b: 1 }, c: 2 }, { c: 2, a: { b: 2 } })).toEqual(['.a.b: 1 → 2']);
  });

  it('reports a soft-lock when the command budget runs out', () => {
    const r = playBot(db, { seed: 1, nights: 50, maxCommands: 5 });
    expect(r.problems.join()).toMatch(/only \d+ nights in 5 commands/);
  });
});
