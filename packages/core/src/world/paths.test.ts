import type { Condition, PathGraph } from '@mrak/content-schema';
import { describe, expect, it } from 'vitest';
import { Game } from '../game';
import { fixtureDb } from '../test/fixture';
import { nightClock, openPaths, reachableFromExits, shiftChoices, type PathContext } from './paths';

const graph = fixtureDb.get('zones', 'forest').paths;
const NIGHT = 23 * 60;
const DAY = 12 * 60;

/** A context whose conditions read a tiny fake state. */
function ctx(over: Partial<PathContext> & { corruption?: number } = {}): PathContext {
  const phase = over.phase ?? 'night';
  const corruption = over.corruption ?? 0;
  const evaluate = (c: Condition): boolean => {
    if ('phase' in c) return c.phase === phase;
    if ('stat' in c && c.stat === 'corruption') return corruption >= (c['>='] ?? 0);
    throw new Error('unexpected condition');
  };
  return { seed: 1, zone: 'forest', day: 1000, minute: NIGHT, phase, evaluate, ...over };
}

describe('nightClock', () => {
  it('a night runs from noon to noon', () => {
    expect(nightClock(10, 23 * 60)).toEqual({ night: 10, hour: 11 });
    expect(nightClock(11, 3 * 60)).toEqual({ night: 10, hour: 15 });
    expect(nightClock(11, 12 * 60)).toEqual({ night: 11, hour: 0 });
  });
});

describe('openPaths', () => {
  it('by day: the first edge of each shift group, no night or corruption paths', () => {
    const open = openPaths(graph, ctx({ phase: 'day', minute: DAY }));
    expect([...open].sort()).toEqual(['e-left', 'e-loop', 'e-main']);
  });

  it('night-only paths open at night; corruption paths at ≥ 50', () => {
    expect(openPaths(graph, ctx()).has('e-night')).toBe(true);
    expect(openPaths(graph, ctx({ corruption: 49 })).has('e-corrupt')).toBe(false);
    expect(openPaths(graph, ctx({ corruption: 50 })).has('e-corrupt')).toBe(true);
  });

  it('is deterministic for the same seed, night and hour', () => {
    const a = openPaths(graph, ctx({ seed: 42 }));
    const b = openPaths(graph, ctx({ seed: 42 }));
    expect([...a]).toEqual([...b]);
  });

  it('shifting groups move at night, some hours and some seeds', () => {
    const seen = new Set<string>();
    for (let seed = 0; seed < 40; seed++)
      for (let minute = 20 * 60; minute < 24 * 60; minute += 60)
        seen.add(shiftChoices(graph, ctx({ seed, minute })).get('g1') ?? '');
    expect(seen).toEqual(new Set(['e-left', 'e-right']));
  });

  it('about 30 % of the hours shift (statistical)', () => {
    let moves = 0;
    let hours = 0;
    for (let seed = 0; seed < 300; seed++) {
      let prev = shiftChoices(graph, ctx({ seed, minute: 12 * 60 })).get('g1');
      for (let h = 1; h < 12; h++) {
        const now = shiftChoices(graph, ctx({ seed, minute: 12 * 60 + h * 60 })).get('g1');
        if (now !== prev) moves++;
        hours++;
        prev = now;
      }
    }
    expect(moves / hours).toBeGreaterThan(0.25);
    expect(moves / hours).toBeLessThan(0.35);
  });

  it('every node can always reach an exit (property over seeds, hours, phases, corruption)', () => {
    for (let seed = 0; seed < 200; seed++)
      for (let hour = 0; hour < 24; hour++)
        for (const phase of ['day', 'night'] as const)
          for (const corruption of [0, 80]) {
            const open = openPaths(
              graph,
              ctx({ seed, minute: (12 * 60 + hour * 60) % 1440, phase, corruption }),
            );
            expect(reachableFromExits(graph, open).size).toBe(graph.nodes.length);
          }
  });

  it('repairs a graph where the chosen alternative would strand a node', () => {
    const stranded: PathGraph = {
      nodes: [
        { id: 'exit', exit: true },
        { id: 'a', exit: false },
        { id: 'b', exit: false },
      ],
      edges: [
        { id: 'exit-a', from: 'exit', to: 'a' },
        { id: 'a-b', from: 'a', to: 'b', shift: 'g' },
        { id: 'a-exit', from: 'a', to: 'exit', shift: 'g' },
      ],
    };
    for (let seed = 0; seed < 50; seed++) {
      const open = openPaths(stranded, ctx({ seed }));
      expect(open.has('a-b')).toBe(true);
    }
  });
});

describe('Game.openPaths', () => {
  it('uses the chronicle seed and never advances the RNG streams', () => {
    const game = Game.newGame({ content: fixtureDb, seed: 9 }, { startMinute: NIGHT });
    const rng = JSON.stringify(game.random.serialize());
    const first = [...game.openPaths('forest')];
    expect([...game.openPaths('forest')]).toEqual(first);
    expect(first).toContain('e-night');
    expect(JSON.stringify(game.random.serialize())).toBe(rng);
  });

  it('opens the corruption path when the stat reaches the threshold', () => {
    const game = Game.newGame({ content: fixtureDb, seed: 9 }, { startMinute: DAY });
    expect(game.openPaths('forest').has('e-corrupt')).toBe(false);
    game.dispatch({ type: 'applyEffects', effects: [{ setStat: 'corruption', value: 60 }] });
    expect(game.openPaths('forest').has('e-corrupt')).toBe(true);
  });
});
