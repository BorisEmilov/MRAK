/**
 * Routines: where each villager is and what they do at a given moment (docs/systems/villagers.md
 * rules 1–3). Pure functions of the state and the time — the village "moves" off-screen simply
 * because this answer changes with the clock; Phaser only walks the sprites there.
 */
import type { Activity, Condition, Routine, Villager, VillageRules } from '@mrak/content-schema';
import type { ContentDatabase } from '../content/database';
import { dayPhaseAt, jdnToJulian } from '../time/calendar';
import { clockMinute, perceivedFear, possessedHidden, weekday, type ReadState } from './common';

/** What a villager is doing: routine activities plus what status and tasks turn them into. */
export type VillagerActivityKind =
  | Activity
  | 'task'
  | 'hide'
  | 'haunt'
  | 'sleepwalk'
  /** Not in the world (dead and buried, or a returned lying in its grave by day). */
  | 'absent';

export interface VillagerActivity {
  activity: VillagerActivityKind;
  /** Village POI id, or null when absent. */
  place: string | null;
  /** Task being worked on (activity "task"). */
  task: string | null;
  /** Routine in force (for the UI and tests). */
  routine: string;
}

function inWindow(minute: number, window: Routine['window']): boolean {
  if (!window) return true;
  const from = clockMinute(window.from);
  const to = clockMinute(window.to);
  return from <= to ? minute >= from && minute < to : minute >= from || minute < to;
}

/** The block in force: the last whose time has passed, wrapping past midnight. */
export function blockAt(routine: Routine, minute: number): Routine['blocks'][number] {
  let found: Routine['blocks'][number] | undefined;
  for (const b of routine.blocks) if (clockMinute(b.at) <= minute) found = b;
  return found ?? (routine.blocks[routine.blocks.length - 1] as Routine['blocks'][number]);
}

/** The routine in force for a villager: the highest applicable override, else their base one. */
export function activeRoutine(
  db: ContentDatabase,
  villager: Villager,
  day: number,
  minute: number,
  evaluate: (c: Condition) => boolean,
): Routine {
  let best: Routine | null = null;
  const wd = weekday(day);
  for (const r of db.all('routines')) {
    if (r.priority === 0) continue;
    if (r.villagers && !r.villagers.includes(villager.id)) continue;
    if (r.days && !r.days.includes(wd)) continue;
    if (!inWindow(minute, r.window)) continue;
    if (r.when && !evaluate(r.when)) continue;
    if (!best || r.priority > best.priority || (r.priority === best.priority && r.id < best.id))
      best = r;
  }
  return best ?? db.get('routines', villager.routine);
}

function resolvePlace(villager: Villager, place: string): string {
  return place === 'home' ? villager.home : place === 'work' ? villager.work : place;
}

/** Where a villager is and what they do at `day`/`minute` (docs rule 3 for the overrides). */
export function villagerActivity(
  state: ReadState,
  db: ContentDatabase,
  rules: VillageRules,
  villager: Villager,
  day: number,
  minute: number,
  evaluate: (c: Condition) => boolean,
): VillagerActivity {
  const v = state.villagers[villager.id];
  const routine = activeRoutine(db, villager, day, minute, evaluate);
  const at = (
    activity: VillagerActivityKind,
    place: string | null,
    task: string | null = null,
  ) => ({
    activity,
    place,
    task,
    routine: routine.id,
  });
  const night = dayPhaseAt(minute, jdnToJulian(day).month) === 'night';
  if (!v || v.status === 'dead') return at('absent', null);
  if (v.status === 'returned') return night ? at('haunt', rules.death.grave) : at('absent', null);
  if (v.status === 'sick') return at('rest', villager.home);

  if (night && v.tasks.night) {
    const task = db.get('tasks', v.tasks.night);
    return at('task', resolvePlace(villager, task.place), task.id);
  }
  const block = blockAt(routine, minute);
  let activity: VillagerActivityKind = block.activity;
  let place = resolvePlace(villager, block.place);
  let task: string | null = null;
  if (activity === 'work' && v.tasks.day) {
    const def = db.get('tasks', v.tasks.day);
    activity = 'task';
    place = resolvePlace(villager, def.place);
    task = def.id;
  }
  if (
    v.status === 'terrified' ||
    perceivedFear(state, db, rules, villager.id) >= rules.fear.terrifiedAt
  ) {
    if (activity === 'socialize' || activity === 'chores' || activity === 'wander') {
      activity = 'hide';
      place = villager.home;
    } else if (activity === 'sleep') activity = 'hide';
  }
  if (possessedHidden(state, villager.id)) {
    // The demon keeps its host away from holy places and walks it at night.
    if (activity === 'pray') {
      activity = 'wander';
      place = rules.death.grave;
    }
    const { sleepwalkFrom, sleepwalkTo, sleepwalkPlace } = rules.possession;
    if (inWindow(minute, { from: sleepwalkFrom, to: sleepwalkTo })) {
      activity = 'sleepwalk';
      place = sleepwalkPlace;
    }
  }
  return at(activity, place, task);
}
