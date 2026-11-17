import { describe, expect, it } from 'vitest';
import { Game } from '../game';
import { fixtureDb } from '../test/fixture';
import { julianToJdn, moonPhase } from '../time/calendar';
import { itemCount } from './inventory';

function at(year: number, month: number, day: number, minute = 600, zone = 'forest'): Game {
  return Game.newGame(
    { content: fixtureDb, seed: 9 },
    { start: { year, month, day }, startMinute: minute, startZone: zone },
  );
}

const potencyOf = (r: ReturnType<Game['dispatch']>): number | undefined =>
  r.events.flatMap((e) => (e.type === 'gather/gathered' ? [e.payload.potency] : []))[0];
const gather = (g: Game, poi: string, zone = 'forest') =>
  g.dispatch({ type: 'interactPoi', zone, poi });

describe('gathering points', () => {
  it('a herb is there only in its season', () => {
    const winter = at(1835, 1, 10);
    expect(winter.gathering('forest')['meadow']).toBe('season');
    expect(gather(winter, 'meadow')).toMatchObject({ ok: false, reason: 'out of season' });
    expect(itemCount(winter.snapshot(), 'yarrow')).toBe(0);

    const summer = at(1835, 6, 10);
    expect(summer.gathering('forest')['meadow']).toBe('ready');
    const r = gather(summer, 'meadow');
    expect(r.ok).toBe(true);
    expect(r.events).toContainEqual({
      type: 'gather/gathered',
      payload: { zone: 'forest', poi: 'meadow', item: 'yarrow', qty: 2, potency: 1 },
    });
    expect(itemCount(summer.snapshot(), 'yarrow')).toBe(2);
  });

  it('the season edges are inclusive', () => {
    expect(at(1835, 5, 31).gathering('forest')['meadow']).toBe('season');
    expect(at(1835, 6, 1).gathering('forest')['meadow']).toBe('ready');
    expect(at(1835, 7, 31).gathering('forest')['meadow']).toBe('ready');
    expect(at(1835, 8, 1).gathering('forest')['meadow']).toBe('season');
  });

  it('regrows after its days', () => {
    const g = at(1835, 6, 10);
    gather(g, 'meadow');
    expect(gather(g, 'meadow')).toMatchObject({ ok: false, reason: 'not regrown' });
    g.dispatch({ type: 'advanceTime', minutes: 2 * 1440 });
    expect(g.gathering('forest')['meadow']).toBe('regrowing');
    g.dispatch({ type: 'advanceTime', minutes: 1440 });
    expect(g.gathering('forest')['meadow']).toBe('ready');
  });

  it('regrowDays 0 means once per day', () => {
    const g = at(1835, 1, 10, 600, 'village');
    expect(gather(g, 'garden', 'village').ok).toBe(true);
    expect(gather(g, 'garden', 'village').ok).toBe(false);
    g.dispatch({ type: 'advanceTime', minutes: 1440 });
    expect(gather(g, 'garden', 'village').ok).toBe(true);
  });

  it('a moon-bound plant appears only under its moon', () => {
    // Find a full-moon day and a new-moon day in January 1835.
    const days = Array.from({ length: 30 }, (_, i) => i + 1);
    const full = days.find(
      (d) => moonPhase(julianToJdn({ year: 1835, month: 1, day: d })).phase === 'full',
    );
    const dark = days.find(
      (d) => moonPhase(julianToJdn({ year: 1835, month: 1, day: d })).phase === 'new',
    );
    expect(full).toBeDefined();
    expect(dark).toBeDefined();
    expect(at(1835, 1, full ?? 1).gathering('forest')['moonwort']).toBe('ready');
    expect(at(1835, 1, dark ?? 1).gathering('forest')['moonwort']).toBe('season');
  });

  it('Enyovden doubles potency; dawn adds one first; capped at 3', () => {
    const day = at(1835, 6, 24);
    expect(potencyOf(gather(day, 'meadow'))).toBe(2);
    expect(day.snapshot().guardian.pack).toContainEqual({ item: 'yarrow', qty: 2, potency: 2 });
    // At dawn on Enyovden: (1 + 1) × 2 = 4 → 3.
    const dawn = at(1835, 6, 24, 4 * 60 + 40);
    expect(potencyOf(gather(dawn, 'meadow'))).toBe(3);
  });

  it('herbs of different potency keep separate stacks', () => {
    const g = at(1835, 6, 24);
    gather(g, 'meadow'); // potency 2 on Enyovden
    g.dispatch({ type: 'applyEffects', effects: [{ giveItem: 'yarrow', qty: 1 }] });
    const yarrow = g.snapshot().guardian.pack.filter((s) => s.item === 'yarrow');
    expect(yarrow).toEqual([
      { item: 'yarrow', qty: 2, potency: 2 },
      { item: 'yarrow', qty: 1 },
    ]);
  });
});
