/**
 * What the player may know about villagers (docs/systems/villagers.md rule 12): a hidden
 * possession never shows, its host's fear is faked. React and Phaser use these views, never the
 * raw villager state, to show fear and status.
 */
import type { Villager, VillageRules } from '@mrak/content-schema';
import type { ContentDatabase } from '../content/database';
import { getStat } from '../state/stats';
import type { VillagerState, VillagerStatus } from '../state/world-state';
import { evaluatorAt, perceivedFear, type ReadState } from './common';
import { villagerActivity, type VillagerActivity } from './routines';
import { taskEfficiency } from './tasks';

export interface VillagerView {
  id: string;
  alive: boolean;
  /** Visible status (never reveals a hidden possession). */
  status: VillagerStatus;
  /** Possession uncovered by the guardian. */
  possessed: boolean;
  fear: number;
  hunger: number;
  cold: number;
  faith: number;
  health: number;
  tasks: VillagerState['tasks'];
  /** Efficiency (0–∞) at each task of the pack, as the player sees it. */
  efficiency: Readonly<Record<string, number>>;
  activity: VillagerActivity;
  secrets: readonly string[];
  death: VillagerState['death'];
  /** Affinities toward the other villagers and the guardian. */
  affinity: Readonly<Record<string, number>>;
}

export function villagerView(
  state: ReadState,
  db: ContentDatabase,
  rules: VillageRules,
  villager: Villager,
  evaluate = evaluatorAt(state, db, state.clock.day, state.clock.minute),
): VillagerView | null {
  const v = state.villagers[villager.id];
  if (!v) return null;
  const efficiency: Record<string, number> = {};
  for (const task of db.all('tasks'))
    efficiency[task.id] = v.alive ? taskEfficiency(state, db, rules, villager, task.id) : 0;
  return {
    id: villager.id,
    alive: v.alive,
    status: v.status,
    possessed: state.possessions.some((p) => p.host === villager.id && p.revealed),
    fear: perceivedFear(state, db, rules, villager.id),
    hunger: getStat(state, db, 'hunger', villager.id),
    cold: getStat(state, db, 'cold', villager.id),
    faith: getStat(state, db, 'villager-faith', villager.id),
    health: getStat(state, db, 'health', villager.id),
    tasks: v.tasks,
    efficiency,
    activity: villagerActivity(
      state,
      db,
      rules,
      villager,
      state.clock.day,
      state.clock.minute,
      evaluate,
    ),
    secrets: v.secrets,
    death: v.death,
    affinity: v.affinity,
  };
}
