/**
 * AchievementSystem (docs/systems/achievements.md): account-level, outside any save. The host
 * feeds it every batch of core events; it evaluates content conditions against the world and
 * unlocks each achievement once, keeps global stats and decides The Cycle (NG+) unlocks.
 */
import type { Achievement, Condition } from '@mrak/content-schema';
import type { ConditionContext } from '../conditions';
import type { ContentDatabase } from '../content/database';
import { event, type CoreEvent } from '../events';
import type { Profile } from './profile';

export interface AchievementProgress {
  have: number;
  total: number;
}

/** Progress of a numeric condition (`stat` or `collection` with `>=`), else null. */
export function conditionProgress(
  cond: Condition,
  ctx: Pick<ConditionContext, 'stat' | 'collection'>,
): AchievementProgress | null {
  if ('stat' in cond && typeof cond['>='] === 'number') {
    const total = cond['>='];
    return { have: Math.min(ctx.stat(cond.stat, cond.villager), total), total };
  }
  if ('collection' in cond && cond['>='] !== undefined) {
    const { have, total: all } = ctx.collection(cond.collection);
    const total = cond['>='] === 'all' ? all : cond['>='];
    return { have: Math.min(have, total), total };
  }
  return null;
}

export class AchievementSystem {
  /**
   * @param achievements the achievements this build may unlock (demo builds ship only demo ones).
   * @param holds evaluates a condition against the current world (Game.check).
   */
  constructor(
    private readonly achievements: readonly Achievement[],
    private readonly holds: (cond: Condition) => boolean,
  ) {}

  /** Unlocks every achievement whose condition now holds, once. */
  observe(profile: Profile, now: number): { profile: Profile; events: CoreEvent[] } {
    const owned = new Set(profile.achievements.map((a) => a.id));
    const fresh = this.achievements.filter((a) => !owned.has(a.id) && this.holds(a.condition));
    if (fresh.length === 0) return { profile, events: [] };
    return {
      profile: {
        ...profile,
        achievements: [...profile.achievements, ...fresh.map((a) => ({ id: a.id, at: now }))],
      },
      events: fresh.map((a) => event('achievement/unlocked', { id: a.id })),
    };
  }
}

/** Global stats: nights survived, exorcisms, routes completed and chapter endings seen. */
export function recordProfileStats(
  profile: Profile,
  events: readonly CoreEvent[],
  db: ContentDatabase,
): Profile {
  let { nights, exorcisms, routes, endings } = profile.stats;
  for (const e of events) {
    if (e.type === 'time/dawn') nights += 1;
    else if (e.type === 'exorcism/succeeded') exorcisms += 1;
    else if (
      e.type === 'quest/completed' &&
      db.find('quests', e.payload.quest)?.kind === 'route' &&
      !routes.includes(e.payload.quest)
    )
      routes = [...routes, e.payload.quest].sort();
    else if (e.type === 'time/chapterEnded' && !endings.includes(e.payload.chapter))
      endings = [...endings, e.payload.chapter].sort();
  }
  const s = profile.stats;
  if (
    nights === s.nights &&
    exorcisms === s.exorcisms &&
    routes === s.routes &&
    endings === s.endings
  )
    return profile;
  return { ...profile, stats: { nights, exorcisms, routes, endings } };
}

/** The Cycle (NG+) opens after a route was completed in any chronicle; each route is an echo. */
export function cycleUnlocks(profile: Profile): { open: boolean; echoes: readonly string[] } {
  return { open: profile.stats.routes.length > 0, echoes: profile.stats.routes };
}
