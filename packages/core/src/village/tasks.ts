/**
 * Day and night tasks: efficiency and assignment (docs/systems/tasks.md → Implementation).
 */
import type { Condition, Task, Villager, VillageRules } from '@mrak/content-schema';
import type { ContentDatabase } from '../content/database';
import { event, type CoreEvent } from '../events';
import { getStat } from '../state/stats';
import type { WorldState } from '../state/world-state';
import { perceivedFear, VillageRuleError, type ReadState } from './common';

export type TaskSlot = 'day' | 'night';

/** Π trait multipliers for the task (trade traits are the "trade match"). */
export function traitEfficiency(db: ContentDatabase, villager: Villager, task: string): number {
  let f = 1;
  for (const id of villager.traits) f *= db.find('traits', id)?.taskEfficiency[task] ?? 1;
  return f;
}

/** efficiency = traits × health/100 × (1 − fear/200), from given health and fear. */
export function efficiencyOf(traits: number, health: number, fear: number): number {
  return traits * (Math.max(0, health) / 100) * (1 - Math.min(100, Math.max(0, fear)) / 200);
}

/** A villager's efficiency at a task now (perceived fear: a hidden possession works calmly). */
export function taskEfficiency(
  state: ReadState,
  db: ContentDatabase,
  rules: VillageRules,
  villager: Villager,
  task: string,
): number {
  return efficiencyOf(
    traitEfficiency(db, villager, task),
    getStat(state, db, 'health', villager.id),
    perceivedFear(state, db, rules, villager.id),
  );
}

/** Why a task cannot be given to a villager now, or null. */
export function assignProblem(
  state: ReadState,
  db: ContentDatabase,
  rules: VillageRules,
  villager: string,
  slot: TaskSlot,
  task: Task | null,
  evaluate: (c: Condition) => boolean,
): string | null {
  const v = state.villagers[villager];
  if (!v) return `unknown villager "${villager}"`;
  if (!v.alive || v.status === 'dead' || v.status === 'returned') return 'dead';
  if (task === null) return null;
  if (v.status === 'sick') return 'too sick to work';
  if (task.slot !== slot) return `not a ${slot} task`;
  if (task.requires && !evaluate(task.requires)) return 'requirements not met';
  if (slot === 'night' && perceivedFear(state, db, rules, villager) >= rules.fear.nightTaskMaxFear)
    return 'too afraid for the night';
  return null;
}

export function assignTask(
  draft: WorldState,
  db: ContentDatabase,
  rules: VillageRules,
  villager: string,
  slot: TaskSlot,
  taskId: string | null,
  evaluate: (c: Condition) => boolean,
): CoreEvent[] {
  const task = taskId === null ? null : db.get('tasks', taskId);
  const problem = assignProblem(draft, db, rules, villager, slot, task, evaluate);
  if (problem) throw new VillageRuleError(problem);
  const v = draft.villagers[villager];
  if (!v || v.tasks[slot] === taskId) return [];
  v.tasks[slot] = taskId;
  // A new task starts from scratch; batches already finished are still delivered at dusk.
  v.progress[slot] = 0;
  if (slot === 'day') v.stalled = false;
  return [event('task/assigned', { villager, slot, task: taskId })];
}
