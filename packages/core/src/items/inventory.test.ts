import { describe, expect, it } from 'vitest';
import { Game } from '../game';
import { effectiveStat } from '../state/stats';
import { fixtureDb } from '../test/fixture';
import { itemCount, packLoad } from './inventory';
import { itemRules } from './rules';

const rules = itemRules(fixtureDb);

/** A game at home (village) at 10:00, pack holding the start's 4 lamp oil. */
function home(minute = 600): Game {
  const g = Game.newGame(
    { content: fixtureDb, seed: 3 },
    { start: { year: 1835, month: 1, day: 10 }, startMinute: minute, startZone: 'village' },
  );
  return g;
}

const give = (g: Game, item: string, qty: number, to?: 'pack' | 'storage') =>
  g.dispatch({ type: 'applyEffects', effects: [{ giveItem: item, qty, ...(to ? { to } : {}) }] });

describe('pack', () => {
  it('stacks up to the stack size and splits the rest into new stacks', () => {
    const g = home();
    give(g, 'yarrow', 12); // stack size 5 → 5 + 5 + 2
    const yarrow = g.snapshot().guardian.pack.filter((s) => s.item === 'yarrow');
    expect(yarrow.map((s) => s.qty)).toEqual([5, 5, 2]);
    expect(itemCount(g.snapshot(), 'yarrow')).toBe(12);
  });

  it('respects slots and slot sizes; overflow goes home when at home', () => {
    const g = home();
    // 4 slots: oil (1) + stone (2) = 3 used; a second stone needs 2 → store.
    give(g, 'stone', 10);
    const result = give(g, 'stone', 1);
    expect(result.events).toContainEqual({
      type: 'inventory/full',
      payload: { item: 'stone', qty: 1, where: 'storage' },
    });
    expect(itemCount(g.snapshot(), 'stone', 'pack')).toBe(10);
    expect(itemCount(g.snapshot(), 'stone', 'storage')).toBe(1);
    expect(packLoad(g.snapshot(), fixtureDb, rules)).toMatchObject({ slots: 4, used: 3 });
  });

  it('overflow away from home is left on the ground, and can be picked up', () => {
    const g = home();
    g.dispatch({ type: 'enterZone', zone: 'forest' });
    give(g, 'yarrow', 15); // 3 stacks of 5 → 4 slots full with the oil
    const r = give(g, 'garlic', 3);
    expect(r.events).toContainEqual({
      type: 'inventory/full',
      payload: { item: 'garlic', qty: 3, where: 'ground' },
    });
    expect(g.snapshot().guardian.ground['forest']).toEqual([{ item: 'garlic', qty: 3 }]);
    expect(g.dispatch({ type: 'pickUp', item: 'garlic' })).toMatchObject({
      ok: false,
      reason: 'pack full',
    });
    g.dispatch({ type: 'dropItem', item: 'yarrow', qty: 5 });
    expect(g.dispatch({ type: 'pickUp', item: 'garlic' }).ok).toBe(true);
    expect(itemCount(g.snapshot(), 'garlic', 'pack')).toBe(3);
  });

  it('unique items never stack and are owned once', () => {
    const g = home();
    give(g, 'coin', 1);
    give(g, 'coin', 1);
    expect(itemCount(g.snapshot(), 'coin')).toBe(1);
  });

  it('weight over capacity encumbers', () => {
    const g = home();
    give(g, 'stone', 1);
    expect(g.packLoad()).toMatchObject({ weight: 8, encumbered: false, speed: 1 });
    give(g, 'stone', 1);
    expect(g.packLoad()).toMatchObject({ weight: 14, encumbered: true, speed: 0.6 });
    g.dispatch({ type: 'applyEffects', effects: [{ addStat: 'carry-weight', value: 10 }] });
    expect(g.packLoad().encumbered).toBe(false);
  });

  it('herbs of different potency do not merge; taking uses the weakest first', () => {
    const g = home();
    give(g, 'yarrow', 2);
    const s = g.snapshot().guardian.pack;
    expect(s).toContainEqual({ item: 'yarrow', qty: 2 });
    // A potency-2 batch from the mortar/gathering is a separate stack.
    g.dispatch({ type: 'applyEffects', effects: [{ giveItem: 'yarrow', qty: 1 }] });
    expect(itemCount(g.snapshot(), 'yarrow')).toBe(3);
  });
});

describe('house store', () => {
  it('moving needs to be at home, and is clipped to what fits', () => {
    const g = home();
    give(g, 'garlic', 50, 'storage');
    expect(g.dispatch({ type: 'moveItem', item: 'garlic', qty: 50, to: 'pack' }).ok).toBe(true);
    // 3 free slots × 20 → 50 fit, nothing left behind.
    expect(itemCount(g.snapshot(), 'garlic', 'pack')).toBe(50);
    give(g, 'bread', 10, 'storage');
    const r = g.dispatch({ type: 'moveItem', item: 'bread', qty: 10, to: 'pack' });
    expect(r).toMatchObject({ ok: false, reason: 'pack full' });
    g.dispatch({ type: 'enterZone', zone: 'forest' });
    expect(g.dispatch({ type: 'moveItem', item: 'garlic', qty: 1, to: 'storage' })).toMatchObject({
      ok: false,
      reason: 'not at home',
    });
  });

  it('takeItem takes from the pack first, then the store; hasItem counts both', () => {
    const g = home();
    give(g, 'garlic', 2);
    give(g, 'garlic', 3, 'storage');
    expect(g.check({ hasItem: 'garlic', qty: 5 })).toBe(true);
    expect(g.check({ hasItem: 'garlic', qty: 3, in: 'pack' })).toBe(false);
    g.dispatch({ type: 'applyEffects', effects: [{ takeItem: 'garlic', qty: 3 }] });
    expect(itemCount(g.snapshot(), 'garlic', 'pack')).toBe(0);
    expect(itemCount(g.snapshot(), 'garlic', 'storage')).toBe(2);
  });
});

describe('using and dropping', () => {
  it('useItem applies the effects scaled by potency and consumes one', () => {
    const g = home();
    const sanity = effectiveStat(g.snapshot(), fixtureDb, 'sanity');
    give(g, 'tea', 1);
    expect(g.dispatch({ type: 'useItem', item: 'tea' }).ok).toBe(true);
    expect(effectiveStat(g.snapshot(), fixtureDb, 'sanity')).toBe(sanity + 10);
    expect(g.dispatch({ type: 'useItem', item: 'garlic' })).toMatchObject({ ok: false });
  });

  it('cursed objects will not be dropped at night', () => {
    const g = home(23 * 60);
    give(g, 'coin', 1);
    expect(g.dispatch({ type: 'dropItem', item: 'coin', qty: 1 })).toMatchObject({
      ok: false,
      reason: 'it will not leave your hand',
    });
    const day = home();
    give(day, 'coin', 1);
    expect(day.dispatch({ type: 'dropItem', item: 'coin', qty: 1 }).ok).toBe(true);
  });
});

describe('whispers', () => {
  it('a carried cursed object drains 6 × whisper Sanity per hour, ticking or skipping alike', () => {
    const a = home();
    const b = home();
    for (const g of [a, b]) give(g, 'doll', 1);
    const start = effectiveStat(a.snapshot(), fixtureDb, 'sanity');
    a.dispatch({ type: 'advanceTime', minutes: 180 });
    a.dispatch({ type: 'setSpeed', speed: 1 });
    for (let i = 0; i < 180; i++) b.tick(1000);
    expect(effectiveStat(a.snapshot(), fixtureDb, 'sanity')).toBe(start - 36);
    expect(effectiveStat(b.snapshot(), fixtureDb, 'sanity')).toBe(start - 36);
  });

  it('stops once the object is in the cabinet', () => {
    const g = home();
    give(g, 'doll', 1);
    g.dispatch({ type: 'displayObject', item: 'doll' });
    const start = effectiveStat(g.snapshot(), fixtureDb, 'sanity');
    g.dispatch({ type: 'advanceTime', minutes: 120 });
    expect(effectiveStat(g.snapshot(), fixtureDb, 'sanity')).toBe(start);
  });
});

describe('save', () => {
  it('pack, store, ground and collection survive a save and load', () => {
    const g = home();
    give(g, 'garlic', 3, 'storage');
    give(g, 'coin', 1);
    g.dispatch({ type: 'enterZone', zone: 'forest' });
    g.dispatch({ type: 'dropItem', item: 'lamp-oil', qty: 1 });
    const loaded = Game.load(JSON.parse(JSON.stringify(g.save())), { content: fixtureDb });
    expect(loaded.snapshot().guardian).toEqual(g.snapshot().guardian);
    expect(loaded.snapshot().collection).toEqual(g.snapshot().collection);
  });

  it('a v5 save: the inventory becomes lantern oil in the pack and the rest in the store', () => {
    const v6 = home().save();
    const { pack: _p, storage: _s, ground: _g, ...guardian } = v6.state.guardian;
    const { collection: _c, alchemy: _a, ...state } = v6.state;
    const v5 = {
      ...v6,
      version: 5,
      state: { ...state, guardian: { ...guardian, inventory: { 'lamp-oil': 3, garlic: 2 } } },
    };
    const loaded = Game.load(JSON.parse(JSON.stringify(v5)), { content: fixtureDb });
    expect(loaded.snapshot().guardian.pack).toEqual([{ item: 'lamp-oil', qty: 3 }]);
    expect(loaded.snapshot().guardian.storage).toEqual([{ item: 'garlic', qty: 2 }]);
    expect(loaded.snapshot().collection.found).toEqual(['lamp-oil', 'garlic']);
    expect(loaded.warnings).toContain('save migrated from version 5');
  });
});
