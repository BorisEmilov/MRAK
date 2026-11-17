/**
 * What the guardian can interact with or photograph (docs/systems/inventory.md → Gathering points,
 * collection.md rule 1, photography.md rule 1). Pure: the World scene passes positions.
 */
import type { Poi } from '@mrak/content-schema';
import type { GatherStatus } from '@mrak/core';

export interface Point {
  x: number;
  y: number;
}

export interface PoiAt extends Point {
  def: Poi;
}

export interface VillagerAt extends Point {
  id: string;
  nameKey: string;
}

export type Target = { kind: 'poi'; poi: PoiAt } | { kind: 'villager'; villager: VillagerAt };

/** A gathering point is there (and offered) only while its plant is ready. */
export function interactable(poi: Poi, gathering: Readonly<Record<string, GatherStatus>>): boolean {
  return !poi.gather || gathering[poi.id] === 'ready';
}

/** The nearest POI or villager within `reach` (villagers win ties: people before things). */
export function nearestTarget(
  at: Point,
  pois: readonly PoiAt[],
  villagers: readonly VillagerAt[],
  gathering: Readonly<Record<string, GatherStatus>>,
  reach: number,
): Target | null {
  let best: Target | null = null;
  let bestDistance = reach;
  for (const v of villagers) {
    const d = Math.hypot(v.x - at.x, v.y - at.y);
    if (d <= bestDistance) {
      best = { kind: 'villager', villager: v };
      bestDistance = d;
    }
  }
  for (const poi of pois) {
    if (!interactable(poi.def, gathering)) continue;
    const d = Math.hypot(poi.x - at.x, poi.y - at.y);
    if (d < bestDistance) {
      best = { kind: 'poi', poi };
      bestDistance = d;
    }
  }
  return best;
}

export type PhotoSubject = { villager: string } | { zone: string; poi: string } | { zone: string };

/** What the camera points at: the nearest villager, else the nearest place, else the zone. */
export function photoSubject(
  at: Point,
  zone: string,
  pois: readonly PoiAt[],
  villagers: readonly VillagerAt[],
  range: number,
): PhotoSubject {
  const near = <T extends Point>(list: readonly T[]): T | null => {
    let best: T | null = null;
    let bestDistance = range;
    for (const p of list) {
      const d = Math.hypot(p.x - at.x, p.y - at.y);
      if (d <= bestDistance) {
        best = p;
        bestDistance = d;
      }
    }
    return best;
  };
  const villager = near(villagers);
  if (villager) return { villager: villager.id };
  const poi = near(pois);
  return poi ? { zone, poi: poi.def.id } : { zone };
}
