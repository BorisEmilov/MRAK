/**
 * Acceptance (docs/systems/villagers.md): with the real content, the 8 villagers follow their
 * routine through a whole day, and assigned work changes the stores at dusk.
 */
import {
  activeRoutine,
  blockAt,
  evaluatorAt,
  Game,
  itemCount,
  lightBoundaries,
  TWILIGHT_MINUTES,
  villageRules,
} from '@mrak/core';
import { describe, expect, it } from 'vitest';
import { loadContentDatabase } from './content';

const content = loadContentDatabase();
const rules = villageRules(content);
if (!rules) throw new Error('no village rules');
const zone = content.get('zones', rules.zone);
const pois = new Set(zone.pois.map((p) => p.id));

function newGame(start: { year: number; month: number; day: number }, minute: number): Game {
  return Game.newGame({ content, seed: 1834 }, { start, startMinute: minute });
}

describe('the eight villagers live a full day', () => {
  it.each([
    ['an ordinary winter day', { year: 1835, month: 1, day: 14 }],
    ['a day of the Unclean Days', { year: 1834, month: 12, day: 27 }],
  ])('%s: every hour each one is where their routine says', (_name, start) => {
    const game = newGame(start, 0);
    const villagers = content.all('villagers');
    expect(villagers).toHaveLength(8);
    const seen = new Map<string, Set<string>>();
    for (let hour = 0; hour < 24; hour++) {
      const s = game.snapshot();
      const { day, minute } = s.clock;
      const evaluate = evaluatorAt(s, content, day, minute);
      const now = game.villagerActivities();
      for (const v of villagers) {
        const a = now[v.id];
        expect(a, v.id).toBeDefined();
        if (!a) continue;
        const routine = activeRoutine(content, v, day, minute, evaluate);
        expect(a.routine).toBe(routine.id);
        const block = blockAt(routine, minute);
        const night =
          minute >= lightBoundaries(start.month).nightStart ||
          minute < lightBoundaries(start.month).dawnStart;
        // Status and tasks may turn a block into hiding or resting, never into nonsense.
        if (s.villagers[v.id]?.status === 'healthy' && !(night && s.villagers[v.id]?.tasks.night))
          expect(a.activity).toBe(
            block.activity === 'work' && s.villagers[v.id]?.tasks.day ? 'task' : block.activity,
          );
        expect(a.place === null || pois.has(a.place), `${v.id} at ${String(a.place)}`).toBe(true);
        (seen.get(v.id) ?? seen.set(v.id, new Set()).get(v.id))?.add(a.place ?? '-');
      }
      game.dispatch({ type: 'advanceTime', minutes: 60 });
    }
    // The village is alive: most of them went somewhere besides home (Velika weaves at home).
    const movers = villagers.filter((v) => (seen.get(v.id)?.size ?? 0) >= 2);
    expect(movers.length).toBeGreaterThanOrEqual(6);
    expect(Object.values(game.snapshot().villagers).every((v) => v.alive)).toBe(true);
  });
});

describe('work changes the stores at dusk', () => {
  it('firewood, bread and garlic arrive at dusk, not before', () => {
    const start = { year: 1835, month: 1, day: 14 };
    const game = newGame(start, 7 * 60);
    for (const [villager, task] of [
      ['krastyo', 'firewood'],
      ['radka', 'food'],
      ['baba-neda', 'garlic'],
    ] as const)
      expect(game.dispatch({ type: 'assignTask', villager, slot: 'day', task }).ok).toBe(true);
    const dusk = lightBoundaries(start.month).nightStart - TWILIGHT_MINUTES;
    const garlic = () => itemCount(game.snapshot(), 'garlic', 'storage');
    const before = garlic();
    game.dispatch({ type: 'advanceTime', minutes: dusk - 7 * 60 - 1 });
    expect(garlic()).toBe(before);
    const result = game.dispatch({ type: 'advanceTime', minutes: 1 });
    const delivered = result.events.find((e) => e.type === 'task/delivered');
    const items = delivered?.type === 'task/delivered' ? delivered.payload.items : {};
    expect(Object.keys(items).sort()).toEqual(['bread', 'firewood', 'garlic']);
    for (const qty of Object.values(items)) expect(qty).toBeGreaterThan(0);
    expect(garlic()).toBeGreaterThan(before);
  });
});
