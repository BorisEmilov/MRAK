import { describe, expect, it } from 'vitest';
import { itemCount } from '../items/inventory';
import { Game } from '../game';
import { fixtureDb } from '../test/fixture';
import { julianToJdn, lightBoundaries } from '../time/calendar';
import {
  ambientLight,
  burnOil,
  darknessDrain,
  inDarkness,
  isLit,
  lanternRadius,
  OIL_MINUTES_PER_UNIT,
} from './light';

const newGame = (): Game => Game.newGame({ content: fixtureDb, seed: 7 });
const tickMinutes = (game: Game, minutes: number): void => {
  // 1 in-world minute per real second; ticks of one second like the fixed step would.
  for (let i = 0; i < minutes; i++) game.tick(1000);
};

describe('burnOil (pure)', () => {
  it('60 in-world minutes burn 4 units at rate 1', () => {
    const r = burnOil({ lit: true, fuel: 1 }, 60, 10);
    // The first unit was already in the lantern: 3 poured, reservoir empty → 4 consumed in total.
    expect(r.unitsUsed).toBe(3);
    expect(r.fuel).toBeCloseTo(0);
    expect(r.lit).toBe(true);
  });

  it('burns minute by minute exactly like one long step', () => {
    let lantern = { lit: true, fuel: 1 };
    let used = 0;
    for (let i = 0; i < 45; i++) {
      const r = burnOil(lantern, 1, 10 - used);
      used += r.unitsUsed;
      lantern = { lit: r.lit, fuel: r.fuel };
    }
    expect(used).toBe(2);
    expect(lantern.lit).toBe(true);
  });

  it('goes out when the reservoir empties and no oil is left', () => {
    const r = burnOil({ lit: true, fuel: 1 }, OIL_MINUTES_PER_UNIT, 0);
    expect(r).toMatchObject({ lit: false, fuel: 0, wentOut: true, unitsUsed: 0 });
  });

  it('a higher consumption rate burns faster; an unlit lantern burns nothing', () => {
    expect(burnOil({ lit: true, fuel: 1 }, 15, 10, 2).unitsUsed).toBe(1);
    expect(burnOil({ lit: false, fuel: 0.5 }, 600, 10)).toMatchObject({ fuel: 0.5, unitsUsed: 0 });
  });
});

describe('lantern in the game', () => {
  it('starts equipped (data/starts) and unlit, with the start oil', () => {
    const s = newGame().snapshot();
    expect(s.light).toMatchObject({ lantern: 'lantern', lit: false, fuel: 0 });
    expect(itemCount(s, 'lamp-oil', 'pack')).toBe(4);
  });

  it('lighting pours a unit; 60 minutes later 4 units are gone and it goes out', () => {
    const game = newGame();
    const lit = game.dispatch({ type: 'setLanternLit', lit: true });
    expect(lit.ok).toBe(true);
    expect(itemCount(game.snapshot(), 'lamp-oil', 'pack')).toBe(3);
    tickMinutes(game, 59);
    expect(game.snapshot().light.lit).toBe(true);
    expect(itemCount(game.snapshot(), 'lamp-oil', 'pack')).toBe(0);
    const events: string[] = [];
    game.events.onAny((e) => events.push(e.type));
    tickMinutes(game, 1);
    expect(game.snapshot().light).toMatchObject({ lit: false, fuel: 0 });
    expect(events).toContain('light/lanternOut');
  });

  it('skipping time burns oil like ticking does', () => {
    const game = newGame();
    game.dispatch({ type: 'setLanternLit', lit: true });
    const result = game.dispatch({ type: 'advanceTime', minutes: 60 });
    expect(result.events.map((e) => e.type)).toContain('light/lanternOut');
    expect(game.snapshot().light.lit).toBe(false);
  });

  it('rejects lighting without oil or without a lantern', () => {
    const game = newGame();
    game.dispatch({ type: 'applyEffects', effects: [{ takeItem: 'lamp-oil', qty: 4 }] });
    expect(game.dispatch({ type: 'setLanternLit', lit: true })).toMatchObject({
      ok: false,
      reason: 'no oil',
    });
    game.dispatch({ type: 'equipLantern', gear: null });
    expect(game.dispatch({ type: 'setLanternLit', lit: true })).toMatchObject({
      ok: false,
      reason: 'no lantern equipped',
    });
  });

  it('only lanterns can be equipped; stowing puts it out', () => {
    const game = newGame();
    expect(game.dispatch({ type: 'equipLantern', gear: 'staff' }).ok).toBe(false);
    game.dispatch({ type: 'setLanternLit', lit: true });
    game.dispatch({ type: 'equipLantern', gear: null });
    expect(game.snapshot().light).toMatchObject({ lantern: null, lit: false });
  });

  it('putting it out keeps the oil already in the lantern', () => {
    const game = newGame();
    game.dispatch({ type: 'setLanternLit', lit: true });
    tickMinutes(game, 5);
    game.dispatch({ type: 'setLanternLit', lit: false });
    tickMinutes(game, 30);
    game.dispatch({ type: 'setLanternLit', lit: true });
    expect(itemCount(game.snapshot(), 'lamp-oil', 'pack')).toBe(3);
    expect(game.snapshot().light.fuel).toBeCloseTo(10 / 15);
  });
});

describe('darkness', () => {
  it('drains 1 Sanity per 10 minutes in darkness, nothing in light', () => {
    const game = newGame();
    const sanity = (): number => game.snapshot().stats['sanity'] ?? 76;
    tickMinutes(game, 30);
    expect(sanity()).toBe(76);
    game.dispatch({ type: 'setInDarkness', dark: true });
    tickMinutes(game, 60);
    expect(sanity()).toBe(70);
    game.dispatch({ type: 'setInDarkness', dark: false });
    tickMinutes(game, 60);
    expect(sanity()).toBe(70);
  });

  it('darknessDrain keeps the remainder', () => {
    expect(darknessDrain(25)).toEqual({ loss: 2, remainder: 5 });
  });

  it('isLit / inDarkness', () => {
    const lights = [{ x: 0, y: 0, radius: 4 }];
    expect(isLit({ x: 3, y: 0 }, lights)).toBe(true);
    expect(isLit({ x: 3, y: 3 }, lights)).toBe(false);
    expect(inDarkness({ x: 10, y: 0 }, lights, 0.1)).toBe(true);
    expect(inDarkness({ x: 10, y: 0 }, lights, 1)).toBe(false);
  });
});

describe('radius and ambient', () => {
  it('moon adds up to 2 tiles at night; a pulled-down moon halves after bonuses', () => {
    const base = { base: 4, bonus: 1, moonIllumination: 1 };
    expect(lanternRadius({ ...base, phase: 'day', pulledDown: false })).toBe(5);
    expect(lanternRadius({ ...base, phase: 'night', pulledDown: false })).toBe(7);
    expect(lanternRadius({ ...base, phase: 'night', pulledDown: true })).toBe(2.5);
  });

  it('noon is full light, a new-moon midnight 0.08, a pulled-down moon 0', () => {
    expect(ambientLight(720, 12, 0, false).level).toBe(1);
    expect(ambientLight(0, 12, 0, false).level).toBeCloseTo(0.08);
    expect(ambientLight(0, 12, 1, false).level).toBeCloseTo(0.18);
    expect(ambientLight(0, 12, 1, true).level).toBe(0);
  });

  it('dusk darkens monotonically and dawn brightens monotonically', () => {
    const { dawnStart, nightStart } = lightBoundaries(12);
    let prev = Infinity;
    for (let m = nightStart - 60; m <= nightStart; m += 5) {
      const level = ambientLight(m, 12, 0.5, false).level;
      expect(level).toBeLessThanOrEqual(prev + 1e-9);
      prev = level;
    }
    prev = -Infinity;
    for (let m = dawnStart; m <= dawnStart + 60; m += 5) {
      const level = ambientLight(m, 12, 0.5, false).level;
      expect(level).toBeGreaterThanOrEqual(prev - 1e-9);
      prev = level;
    }
  });

  it('game queries follow the clock and the moon flag', () => {
    const game = Game.newGame(
      { content: fixtureDb, seed: 7 },
      { start: { year: 1834, month: 12, day: 25 }, startMinute: 23 * 60 },
    );
    expect(game.ambient().phase).toBe('night');
    const night = game.lanternRadius();
    expect(night).toBeGreaterThanOrEqual(4);
    game.dispatch({ type: 'applyEffects', effects: [{ setFlag: 'moon-pulled-down' }] });
    expect(game.ambient().level).toBe(0);
    expect(game.lanternRadius()).toBe(2);
    expect(julianToJdn({ year: 1834, month: 12, day: 25 })).toBe(game.snapshot().clock.day);
  });
});
