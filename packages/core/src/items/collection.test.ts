import { describe, expect, it } from 'vitest';
import { Game } from '../game';
import { effectiveStat } from '../state/stats';
import { fixtureDb } from '../test/fixture';
import { itemCount } from './inventory';

function home(minute = 600): Game {
  return Game.newGame(
    { content: fixtureDb, seed: 6 },
    { start: { year: 1835, month: 1, day: 10 }, startMinute: minute, startZone: 'village' },
  );
}
const give = (g: Game, item: string) =>
  g.dispatch({ type: 'applyEffects', effects: [{ giveItem: item, qty: 1 }] });
/** Talks to a villager; returns the tale told (null = small talk, undefined = refused). */
function taleTold(g: Game, villager: string): string | null | undefined {
  for (const e of g.dispatch({ type: 'talkTo', villager }).events)
    if (e.type === 'villager/talked') return e.payload.tale;
  return undefined;
}
const stat = (g: Game, id: string) => effectiveStat(g.snapshot(), fixtureDb, id);

describe('talking', () => {
  it('tells the first eligible tale once, then small talk', () => {
    const g = home();
    expect(taleTold(g, 'velika')).toBe('song-velika');
    expect(g.snapshot().guardian.collectibles).toContain('song-velika');
    expect(taleTold(g, 'velika')).toBeNull();
    // The second song waits for its condition.
    g.dispatch({ type: 'applyEffects', effects: [{ setFlag: 'b' }] });
    expect(taleTold(g, 'velika')).toBe('song-velika-2');
  });

  it('affinity grows once a day and opens tales that need it', () => {
    const g = home();
    g.dispatch({ type: 'talkTo', villager: 'todor' });
    g.dispatch({ type: 'talkTo', villager: 'todor' });
    expect(g.snapshot().villagers['todor']?.affinity['guardian']).toBe(2);
    expect(g.snapshot().guardian.collectibles).not.toContain('tale-todor');
    g.dispatch({ type: 'advanceTime', minutes: 1440 });
    const r = g.dispatch({ type: 'talkTo', villager: 'todor' });
    expect(g.snapshot().villagers['todor']?.affinity['guardian']).toBe(4);
    expect(r.events).toContainEqual({
      type: 'journal/collectibleGranted',
      payload: { collectible: 'tale-todor' },
    });
    // The tale's grants apply.
    expect(g.snapshot().flags['bridge-burned']).toBe(true);
  });

  it('nobody talks in their sleep, nor outside the village', () => {
    const night = home(2 * 60);
    expect(night.dispatch({ type: 'talkTo', villager: 'velika' })).toMatchObject({
      ok: false,
      reason: 'not now',
    });
    const away = home();
    away.dispatch({ type: 'enterZone', zone: 'forest' });
    expect(away.dispatch({ type: 'talkTo', villager: 'velika' })).toMatchObject({
      ok: false,
      reason: 'not in the village',
    });
  });
});

describe('cursed objects and the cabinet', () => {
  it('first finding applies the object’s effects once', () => {
    const g = home();
    const r = give(g, 'coin');
    expect(r.events).toContainEqual({ type: 'collection/found', payload: { item: 'coin' } });
    expect(g.snapshot().flags['b']).toBe(true);
  });

  it('carried modifiers apply in the pack, displayed ones in the cabinet', () => {
    const g = home();
    const notice = stat(g, 'notice');
    const max = stat(g, 'sanity-max');
    give(g, 'coin');
    expect(stat(g, 'notice')).toBe(notice + 5);
    expect(g.dispatch({ type: 'displayObject', item: 'coin' }).ok).toBe(true);
    expect(stat(g, 'notice')).toBe(notice);
    expect(stat(g, 'sanity-max')).toBe(max + 2);
    expect(itemCount(g.snapshot(), 'coin')).toBe(0);
    g.dispatch({ type: 'removeObject', item: 'coin' });
    expect(itemCount(g.snapshot(), 'coin', 'storage')).toBe(1);
    // In the store it does nothing.
    expect(stat(g, 'notice')).toBe(notice);
    expect(stat(g, 'sanity-max')).toBe(max);
  });

  it('a set completes and breaks', () => {
    const g = home();
    const max = stat(g, 'sanity-max');
    give(g, 'coin');
    give(g, 'mirror');
    g.dispatch({ type: 'displayObject', item: 'coin' });
    const r = g.dispatch({ type: 'displayObject', item: 'mirror' });
    expect(r.events).toContainEqual({ type: 'cabinet/setCompleted', payload: { set: 'pair' } });
    expect(stat(g, 'sanity-max')).toBe(max + 2 + 3 + 10);
    expect(g.dispatch({ type: 'removeObject', item: 'mirror' }).events).toContainEqual({
      type: 'cabinet/setBroken',
      payload: { set: 'pair' },
    });
  });

  it('the cabinet has slots, takes only cursed objects and only at home', () => {
    const g = home();
    for (const id of ['coin', 'mirror', 'doll']) give(g, id);
    g.dispatch({ type: 'displayObject', item: 'coin' });
    g.dispatch({ type: 'displayObject', item: 'mirror' });
    expect(g.dispatch({ type: 'displayObject', item: 'doll' })).toMatchObject({
      ok: false,
      reason: 'cabinet full',
    });
    expect(g.dispatch({ type: 'displayObject', item: 'lamp-oil' })).toMatchObject({
      ok: false,
      reason: 'not a cursed object',
    });
    g.dispatch({ type: 'enterZone', zone: 'forest' });
    expect(g.dispatch({ type: 'removeObject', item: 'coin' })).toMatchObject({
      ok: false,
      reason: 'not at home',
    });
  });

  it('memories: the first recall applies its effects and names the scene', () => {
    const g = home();
    expect(g.dispatch({ type: 'recallMemory', object: 'coin' })).toMatchObject({ ok: false });
    give(g, 'coin');
    const notice = stat(g, 'notice');
    const first = g.dispatch({ type: 'recallMemory', object: 'coin' });
    expect(first.events).toContainEqual({
      type: 'collection/memoryRecalled',
      payload: { object: 'coin', scene: 'memory-coin', first: true },
    });
    expect(stat(g, 'notice')).toBe(notice + 1);
    g.dispatch({ type: 'recallMemory', object: 'coin' });
    expect(stat(g, 'notice')).toBe(notice + 1);
  });
});

describe('collection progress', () => {
  it('counts by category and emits progress and completion', () => {
    const g = home();
    const songs = () => g.collectionProgress().find((c) => c.category === 'songs');
    expect(songs()).toMatchObject({ have: 0, total: 2 });
    const r = g.dispatch({ type: 'talkTo', villager: 'velika' });
    expect(r.events).toContainEqual({
      type: 'collection/progressed',
      payload: { category: 'songs', have: 1, total: 2 },
    });
    g.dispatch({ type: 'applyEffects', effects: [{ setFlag: 'b' }] });
    const done = g.dispatch({ type: 'talkTo', villager: 'velika' });
    expect(done.events).toContainEqual({
      type: 'collection/completed',
      payload: { category: 'songs' },
    });
    expect(g.check({ collection: 'songs', '>=': 'all' })).toBe(true);
    expect(g.check({ collection: 'songs', '>=': 3 })).toBe(false);
    expect(g.check({ collection: 'cursed', '>=': 1 })).toBe(false);
    give(g, 'doll');
    expect(g.check({ collection: 'cursed', '>=': 1 })).toBe(true);
  });

  it('herbs count items ever found, even once used up', () => {
    const g = home();
    g.dispatch({ type: 'interactPoi', zone: 'village', poi: 'garden' });
    g.dispatch({ type: 'applyEffects', effects: [{ takeItem: 'garlic', qty: 1 }] });
    expect(g.collectionProgress().find((c) => c.category === 'herbs')).toMatchObject({
      have: 1,
      total: 2,
    });
  });
});
