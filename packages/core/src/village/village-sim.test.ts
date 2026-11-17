import { describe, expect, it } from 'vitest';
import { itemCount } from '../items/inventory';
import type { CoreEvent } from '../events';
import type { Snapshot } from '../state/world-state';
import { Game } from '../game';
import { fixtureDb } from '../test/fixture';
import { julianToJdn, lightBoundaries, TWILIGHT_MINUTES } from '../time/calendar';
import { checkpoints } from './village-sim';

const hm = (h: number, m = 0): number => h * 60 + m;
/** January: dusk 19:00, night 20:00, dawn 06:30 (time-calendar.md). */
const { dawnStart, nightStart } = lightBoundaries(1);
const DUSK = nightStart - TWILIGHT_MINUTES;

function game(seed = 5, minute = hm(8)): Game {
  const g = Game.newGame(
    { content: fixtureDb, seed },
    { start: { year: 1835, month: 1, day: 10 }, startMinute: minute },
  );
  g.dispatch({
    type: 'applyEffects',
    effects: [
      { giveItem: 'bread', qty: 6, to: 'storage' },
      { giveItem: 'red-thread', qty: 2, to: 'storage' },
      { giveItem: 'lamp-oil', qty: 4, to: 'storage' },
    ],
  });
  return g;
}

/** Advances to a minute of today (or of tomorrow if it has passed). */
function until(g: Game, minute: number): CoreEvent[] {
  const now = g.snapshot().clock.minute;
  const delta = (minute - now + 1440) % 1440 || 1440;
  const result = g.dispatch({ type: 'advanceTime', minutes: delta });
  return [...result.events];
}

const stored = (s: Snapshot, item: string) => itemCount(s, item, 'storage');
const types = (events: readonly CoreEvent[]) => events.map((e) => e.type);
const villageOf = (g: Game) => {
  const s = g.snapshot();
  return {
    villagers: s.villagers,
    villagerStats: s.villagerStats,
    village: s.village,
    storage: s.guardian.storage,
    pack: s.guardian.pack,
    stats: s.stats,
  };
};

describe('checkpoints', () => {
  it('lists hours and phase starts in time order, hour first on the same minute', () => {
    const day = julianToJdn({ year: 1835, month: 1, day: 10 });
    const list = checkpoints({ day, minute: hm(18, 30) }, { day, minute: hm(20) });
    expect(list.map((c) => [c.at - day * 1440, c.kind])).toEqual([
      [hm(19), 'hour'],
      [hm(19), 'dusk'],
      [hm(20), 'hour'],
      [hm(20), 'night'],
    ]);
  });
});

describe('tasks and deliveries', () => {
  it('assigned work changes the stores at dusk, not before', () => {
    const g = game();
    g.dispatch({ type: 'assignTask', villager: 'todor', slot: 'day', task: 'firewood' });
    g.dispatch({ type: 'assignTask', villager: 'velika', slot: 'day', task: 'amulets' });
    until(g, DUSK - 1);
    const before = g.snapshot();
    expect(stored(before, 'firewood')).toBe(0);
    expect(stored(before, 'amulet')).toBe(0);
    // Velika (weaver, ×1.5) finished two amulets during the day — using both threads — and
    // stalled on a third; they come home at dusk.
    expect(stored(before, 'red-thread')).toBe(0);
    expect(g.snapshot().villagers['velika']?.pending).toEqual({ amulets: 2 });

    const events = until(g, DUSK);
    expect(events).toContainEqual({
      type: 'task/completed',
      payload: { villager: 'todor', task: 'firewood', batches: 1 },
    });
    expect(events).toContainEqual({
      type: 'task/completed',
      payload: { villager: 'velika', task: 'amulets', batches: 2 },
    });
    expect(events).toContainEqual({
      type: 'task/delivered',
      payload: { items: { amulet: 2, firewood: 4 } },
    });
    const after = g.snapshot();
    // 4 firewood came home, then the two homes lit their fires.
    expect(stored(after, 'firewood')).toBe(2);
    expect(stored(after, 'amulet')).toBe(2);
    expect(after.village.heated).toEqual(['house-todor', 'house-velika']);
    expect(after.villagers['todor']?.pending).toEqual({});
  });

  it('efficiency follows traits, health and fear (trade match + full health + no fear = 1.25 × …)', () => {
    const g = game();
    const view = (id: string) => g.villagers().find((v) => v.id === id);
    g.dispatch({
      type: 'applyEffects',
      effects: [{ setStat: 'fear', villager: 'velika', value: 0 }],
    });
    expect(view('velika')?.efficiency['amulets']).toBeCloseTo(1.5);
    g.dispatch({
      type: 'applyEffects',
      effects: [{ setStat: 'fear', villager: 'velika', value: 100 }],
    });
    expect(view('velika')?.efficiency['amulets']).toBeCloseTo(0.75);
    expect(view('todor')?.efficiency['firewood']).toBeCloseTo(0.75 * (1 - 10 / 200));
  });

  it('a batch without materials stalls (reported once) and waits', () => {
    const g = game();
    g.dispatch({ type: 'applyEffects', effects: [{ takeItem: 'red-thread', qty: 2 }] });
    g.dispatch({ type: 'assignTask', villager: 'velika', slot: 'day', task: 'amulets' });
    const events = until(g, DUSK);
    expect(types(events).filter((t) => t === 'task/stalled')).toHaveLength(1);
    expect(stored(g.snapshot(), 'amulet')).toBe(0);
  });

  it('nobody too afraid takes the night watch; the watch burns oil and defends', () => {
    const g = game();
    g.dispatch({
      type: 'applyEffects',
      effects: [{ setStat: 'fear', villager: 'todor', value: 85 }],
    });
    expect(
      g.dispatch({ type: 'assignTask', villager: 'todor', slot: 'night', task: 'watch' }),
    ).toMatchObject({
      ok: false,
      reason: 'too afraid for the night',
    });
    expect(
      g.dispatch({ type: 'assignTask', villager: 'todor', slot: 'day', task: 'watch' }),
    ).toMatchObject({
      ok: false,
      reason: 'not a day task',
    });
    g.dispatch({
      type: 'applyEffects',
      effects: [{ setStat: 'fear', villager: 'todor', value: 10 }],
    });
    expect(
      g.dispatch({ type: 'assignTask', villager: 'todor', slot: 'night', task: 'watch' }).ok,
    ).toBe(true);
    const oil = stored(g.snapshot(), 'lamp-oil');
    until(g, hm(23));
    expect(stored(g.snapshot(), 'lamp-oil')).toBe(oil - 1);
    expect(g.snapshot().stats['night-watch']).toBeGreaterThan(10);
    until(g, dawnStart);
    expect(g.snapshot().stats['night-watch']).toBe(0);
  });

  it('a watcher whose fear reaches 80 flees the post', () => {
    const g = game();
    g.dispatch({ type: 'assignTask', villager: 'todor', slot: 'night', task: 'watch' });
    until(g, hm(22));
    g.dispatch({
      type: 'applyEffects',
      effects: [{ setStat: 'fear', villager: 'todor', value: 95 }],
    });
    const events = until(g, hm(23));
    expect(events).toContainEqual({
      type: 'task/interrupted',
      payload: { villager: 'todor', task: 'watch', cause: 'fear' },
    });
    expect(g.snapshot().villagers['todor']?.tasks.night).toBeNull();
  });
});

describe('needs', () => {
  it('meals use the bread; without it hunger grows and is reported', () => {
    const g = game();
    until(g, hm(20));
    // Lunch and supper for two: one loaf cut into 4 portions, all eaten.
    expect(stored(g.snapshot(), 'bread')).toBe(5);
    expect(g.snapshot().village.portions).toBe(0);
    g.dispatch({ type: 'applyEffects', effects: [{ takeItem: 'bread', qty: 5 }] });
    const before = g.snapshot().villagerStats['velika']?.['hunger'] ?? 0;
    const events = until(g, hm(13));
    expect(types(events)).toContain('village/mealShort');
    expect(g.snapshot().villagerStats['velika']?.['hunger'] ?? 0).toBeGreaterThan(before);
  });

  it('a cold, fireless night chills them; a fire warms them', () => {
    const cold = game();
    until(cold, dawnStart);
    expect(cold.snapshot().villagerStats['velika']?.['cold'] ?? 0).toBeGreaterThan(10);
    const warm = game();
    warm.dispatch({
      type: 'applyEffects',
      effects: [{ giveItem: 'firewood', qty: 2, to: 'storage' }],
    });
    until(warm, dawnStart);
    expect(warm.snapshot().villagerStats['velika']?.['cold']).toBe(0);
  });
});

describe('death and the returned', () => {
  it('death clears tasks and edges, and grief frightens the close', () => {
    const g = game();
    g.dispatch({ type: 'assignTask', villager: 'velika', slot: 'day', task: 'amulets' });
    const fear = g.snapshot().villagerStats['todor']?.['fear'] ?? 0;
    const r = g.dispatch({
      type: 'applyEffects',
      effects: [{ killVillager: 'velika', cause: 'cold' }],
    });
    expect(types(r.events)).toEqual([
      'task/interrupted',
      'villager/statusChanged',
      'villager/died',
    ]);
    const s = g.snapshot();
    expect(s.villagers['velika']).toMatchObject({
      alive: false,
      status: 'dead',
      tasks: { day: null, night: null },
    });
    expect(s.villagers['todor']?.affinity['velika']).toBeUndefined();
    // affinity 80 ≥ 50: +25 × faith damping (1 − 0.5 × 0.5).
    expect(s.villagerStats['todor']?.['fear']).toBeCloseTo(fear + 25 * 0.75);
    expect(
      g.dispatch({ type: 'assignTask', villager: 'velika', slot: 'day', task: 'food' }),
    ).toMatchObject({
      ok: false,
      reason: 'dead',
    });
  });

  it('a proper burial (sexton and priest alive) keeps the dead in the ground', () => {
    const g = game();
    g.dispatch({ type: 'applyEffects', effects: [{ killVillager: 'velika', cause: 'cold' }] });
    const events = until(g, dawnStart);
    expect(events).toContainEqual({
      type: 'villager/buried',
      payload: { villager: 'velika', proper: true },
    });
    until(g, nightStart);
    until(g, nightStart);
    expect(g.snapshot().villagers['velika']?.status).toBe('dead');
  });

  it('an unquiet death is buried badly; the dead returns at night and is laid to rest by day', () => {
    const g = game();
    g.dispatch({ type: 'applyEffects', effects: [{ killVillager: 'velika', cause: 'violence' }] });
    const dawn = until(g, dawnStart);
    expect(dawn).toContainEqual({
      type: 'villager/buried',
      payload: { villager: 'velika', proper: false },
    });
    const fear = g.snapshot().villagerStats['todor']?.['fear'] ?? 0;
    const night = until(g, nightStart);
    expect(night).toContainEqual({ type: 'villager/returned', payload: { villager: 'velika' } });
    expect(g.snapshot().villagers['velika']?.status).toBe('returned');
    expect(g.snapshot().villagerStats['todor']?.['fear'] ?? 0).toBeGreaterThan(fear);
    const at = g.villagerActivities()['velika'];
    expect(at).toMatchObject({ activity: 'haunt', place: 'cemetery' });

    const sanity = g.snapshot().stats['sanity'] ?? 76;
    expect(g.dispatch({ type: 'encounterReturned', villager: 'velika' }).ok).toBe(true);
    expect(g.snapshot().stats['sanity']).toBe(sanity - 8);
    expect(g.dispatch({ type: 'buryVillager', villager: 'velika' })).toMatchObject({
      ok: false,
      reason: 'not at night',
    });
    until(g, hm(10));
    expect(g.villagerActivities()['velika']?.activity).toBe('absent');
    expect(g.dispatch({ type: 'buryVillager', villager: 'velika' })).toMatchObject({
      ok: false,
      reason: 'missing garlic',
    });
    g.dispatch({ type: 'applyEffects', effects: [{ giveItem: 'garlic', qty: 2 }] });
    const rest = g.dispatch({ type: 'buryVillager', villager: 'velika' });
    expect(types(rest.events)).toContain('villager/laidToRest');
    until(g, nightStart);
    expect(g.snapshot().villagers['velika']).toMatchObject({
      status: 'dead',
      death: { burial: 'proper' },
    });
  });

  it('starvation and cold kill: health reaches 0', () => {
    const g = game();
    g.dispatch({
      type: 'applyEffects',
      effects: [
        { takeItem: 'bread', qty: 6 },
        { setStat: 'hunger', villager: 'velika', value: 100 },
        { setStat: 'health', villager: 'velika', value: 4 },
      ],
    });
    const events = g.dispatch({ type: 'advanceTime', minutes: 120 }).events;
    expect(events).toContainEqual({
      type: 'villager/died',
      payload: { villager: 'velika', cause: 'hunger' },
    });
  });
});

describe('masking (hidden possession)', () => {
  it('shows faked calm while core keeps the true fear', () => {
    const g = game();
    g.dispatch({
      type: 'applyEffects',
      effects: [
        { startPossession: 'lesser-bes', host: 'velika' },
        { setStat: 'fear', villager: 'velika', value: 90 },
      ],
    });
    g.dispatch({ type: 'advanceTime', minutes: 60 });
    const view = g.villagers().find((v) => v.id === 'velika');
    expect(view).toMatchObject({ possessed: false, status: 'healthy' });
    expect(view?.fear).toBeLessThan(30);
    expect(g.snapshot().villagerStats['velika']?.['fear'] ?? 0).toBeGreaterThan(80);
    // The demon even volunteers for the night.
    expect(
      g.dispatch({ type: 'assignTask', villager: 'velika', slot: 'night', task: 'watch' }).ok,
    ).toBe(true);
  });
});

describe('off-screen simulation is deterministic', () => {
  const plan = (g: Game): void => {
    g.dispatch({ type: 'assignTask', villager: 'todor', slot: 'day', task: 'firewood' });
    g.dispatch({ type: 'assignTask', villager: 'velika', slot: 'day', task: 'amulets' });
    g.dispatch({ type: 'assignTask', villager: 'velika', slot: 'night', task: 'watch' });
    g.dispatch({
      type: 'applyEffects',
      effects: [{ setStat: 'fear', villager: 'velika', value: 70 }],
    });
  };
  const HOURS = 40;

  it('second-by-second ticks, one long skip, and odd-sized ticks give the same village', () => {
    const ticked = game(9);
    plan(ticked);
    for (let i = 0; i < HOURS * 60; i++) ticked.tick(1000);

    const skipped = game(9);
    plan(skipped);
    skipped.dispatch({ type: 'advanceTime', minutes: HOURS * 60 });

    const jagged = game(9);
    plan(jagged);
    let left = HOURS * 60 * 1000;
    for (let i = 0; left > 0; i++) {
      // Sizes exact in binary floating point, so the clock lands on the same final minute.
      const dt = Math.min(left, [7_000, 250, 59_000, 750, 1_000][i % 5] ?? 1000);
      jagged.tick(dt);
      left -= dt;
    }

    expect(skipped.snapshot().clock.day).toBe(ticked.snapshot().clock.day);
    expect(villageOf(skipped)).toEqual(villageOf(ticked));
    expect(villageOf(jagged)).toEqual(villageOf(ticked));
  });

  it('the guardian being in the forest or in the village changes nothing', () => {
    const away = game(11);
    away.dispatch({ type: 'enterZone', zone: 'forest' });
    plan(away);
    const home = game(11);
    home.dispatch({ type: 'enterZone', zone: 'village' });
    plan(home);
    for (const g of [away, home]) g.dispatch({ type: 'advanceTime', minutes: HOURS * 60 });
    expect(villageOf(away)).toEqual(villageOf(home));
  });

  it('survives a save and load mid-day', () => {
    const a = game(13);
    plan(a);
    a.dispatch({ type: 'advanceTime', minutes: 300 });
    const b = Game.load(a.save(), { content: fixtureDb });
    for (const g of [a, b]) g.dispatch({ type: 'advanceTime', minutes: 1000 });
    expect(villageOf(b)).toEqual(villageOf(a));
  });
});
