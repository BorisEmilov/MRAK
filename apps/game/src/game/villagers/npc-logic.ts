/**
 * Presentation choices for villager NPCs that do not need Phaser (unit-tested): which activities
 * happen indoors, where villagers stand around a place, and which bubble icon to show.
 */
import type { VillagerActivity, VillagerActivityKind, VillagerView } from '@mrak/core';
import type { IconName } from '@mrak/ui-kit';

/** At home, these happen behind closed doors (the sprite goes inside); work is done outside. */
export const INDOORS: ReadonlySet<VillagerActivityKind> = new Set(['sleep', 'hide', 'rest', 'eat']);

/** Where villagers stand around a shared place, first free wins (tile offsets). */
export const slotOffsets: readonly (readonly [number, number])[] = [
  [0, 1],
  [1, 1],
  [-1, 1],
  [1, 0],
  [-1, 0],
  [0, 2],
  [2, 1],
  [-2, 1],
  [2, 0],
  [-2, 0],
];

/** A need or state is shown at this level (and above). */
export const BUBBLE_THRESHOLD = 70;
/** Task icons are shown only when the guardian is this close (tiles). */
export const TASK_BUBBLE_TILES = 6;

/** The most pressing thing to show above a villager, or null. */
export function bubbleIcon(
  view: VillagerView,
  activity: VillagerActivity,
  distanceTiles: number,
  taskIcon: (task: string) => IconName | null,
): IconName | null {
  if (!view.alive) return null;
  if (view.status === 'sick') return 'villager-state.sick';
  if (view.status === 'terrified' || view.fear >= BUBBLE_THRESHOLD) return 'villager-state.afraid';
  if (view.hunger >= BUBBLE_THRESHOLD) return 'need.hunger';
  if (view.cold >= BUBBLE_THRESHOLD) return 'need.cold';
  if (distanceTiles > TASK_BUBBLE_TILES) return null;
  if (activity.activity === 'task' && activity.task) return taskIcon(activity.task);
  if (activity.activity === 'pray') return 'action.pray';
  return null;
}
