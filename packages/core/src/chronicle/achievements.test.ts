import { describe, expect, it } from 'vitest';
import type { Achievement } from '@mrak/content-schema';
import { event } from '../events';
import { Game } from '../game';
import { chronicleDb as db } from '../test/chronicle-fixture';
import {
  AchievementSystem,
  conditionProgress,
  cycleUnlocks,
  recordProfileStats,
} from './achievements';
import { emptyProfile, mergeProfiles, ProfileSchema } from './profile';

const ach = (id: string, condition: Achievement['condition']): Achievement => ({
  id,
  tier: 'demo',
  nameKey: `a.${id}`,
  descKey: `a.${id}`,
  hidden: false,
  condition,
});

describe('AchievementSystem (docs/systems/achievements.md)', () => {
  it('unlocks once when the condition holds, and the event fires once', () => {
    const g = Game.newGame({ content: db, seed: 1 }, { startZone: 'village' });
    const system = new AchievementSystem([ach('lit', { flag: 'hall-blessed' })], (c) => g.check(c));
    let { profile, events } = system.observe(emptyProfile(), 1);
    expect(events).toEqual([]);
    g.dispatch({ type: 'applyEffects', effects: [{ setFlag: 'hall-blessed' }] });
    ({ profile, events } = system.observe(profile, 5));
    expect(events).toEqual([event('achievement/unlocked', { id: 'lit' })]);
    ({ profile, events } = system.observe(profile, 9));
    expect(events).toEqual([]);
    expect(profile.achievements).toEqual([{ id: 'lit', at: 5 }]);
  });

  it('reports numeric progress (3/10)', () => {
    const g = Game.newGame({ content: db, seed: 1 }, { startZone: 'village' });
    expect(g.conditionProgress({ stat: 'nights-survived', '>=': 10 })).toEqual({
      have: 0,
      total: 10,
    });
    expect(g.conditionProgress({ flag: 'x' })).toBeNull();
  });

  it('keeps global stats and opens The Cycle after a route', () => {
    const route = db.all('quests').find((q) => q.kind === 'route')?.id ?? '';
    let p = recordProfileStats(
      emptyProfile(),
      [
        event('exorcism/succeeded', { host: 'x' }),
        event('quest/completed', { quest: route }),
        event('quest/completed', { quest: route }),
      ],
      db,
    );
    expect(p.stats).toMatchObject({ exorcisms: 1, routes: [route] });
    expect(cycleUnlocks(p).open).toBe(route !== '');
    p = recordProfileStats(p, [], db);
    expect(p.stats.exorcisms).toBe(1);
  });

  it('merge keeps the earliest unlock; old profiles load with empty achievements', () => {
    const a = { ...emptyProfile(), achievements: [{ id: 'x', at: 9 }] };
    const b = {
      ...emptyProfile(),
      achievements: [
        { id: 'x', at: 3 },
        { id: 'y', at: 4 },
      ],
    };
    expect(mergeProfiles(a, b).achievements).toEqual([
      { id: 'x', at: 3 },
      { id: 'y', at: 4 },
    ]);
    const old = { legacy: { available: 1, lifetime: 1 }, nodes: [], awarded: [] };
    expect(ProfileSchema.parse(old).achievements).toEqual([]);
  });

  it('progress of collection conditions, endings, dawns and a closed Cycle', () => {
    const ctx = {
      stat: () => 7,
      collection: () => ({ have: 4, total: 9 }),
    };
    expect(conditionProgress({ collection: 'herbs', '>=': 'all' }, ctx)).toEqual({
      have: 4,
      total: 9,
    });
    expect(conditionProgress({ collection: 'herbs', '>=': 2 }, ctx)).toEqual({ have: 2, total: 2 });
    expect(conditionProgress({ stat: 'sanity', '<': 3 }, ctx)).toBeNull();
    const p = recordProfileStats(
      emptyProfile(),
      [
        event('time/dawn', { day: 1, minute: 360 }),
        event('time/chapterEnded', { chapter: 'c1', day: 3 }),
        event('time/chapterEnded', { chapter: 'c1', day: 4 }),
        event('quest/completed', { quest: 'not-a-route-quest' }),
      ],
      db,
    );
    expect(p.stats).toMatchObject({ nights: 1, endings: ['c1'], routes: [] });
    expect(cycleUnlocks(p)).toEqual({ open: false, echoes: [] });
  });
});
