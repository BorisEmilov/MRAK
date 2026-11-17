/**
 * Pure helpers of the village panel (docs/systems/villagers.md → Presentation): words instead of
 * numbers for needs and bonds, filters, what comes home at dusk, and the relationship graph.
 */
import type { LocaleKey } from '@mrak/content';
import type { ContentDatabase, Snapshot, VillagerView } from '@mrak/core';
import type { IconName } from '@mrak/ui-kit';

export type NeedId = 'hunger' | 'cold' | 'fear' | 'faith' | 'health';

export interface NeedDef {
  id: NeedId;
  icon: IconName;
  labelKey: LocaleKey;
  /** true when a high value is bad (hunger, cold, fear). */
  highIsBad: boolean;
  /** Word bands, from low values to high (upper bounds, exclusive; the last catches the rest). */
  bands: readonly { below: number; key: LocaleKey }[];
}

export const NEEDS: readonly NeedDef[] = [
  {
    id: 'hunger',
    icon: 'need.hunger',
    labelKey: 'village.need.hunger',
    highIsBad: true,
    bands: [
      { below: 40, key: 'village.band.fed' },
      { below: 70, key: 'village.band.peckish' },
      { below: 90, key: 'village.band.hungry' },
      { below: Infinity, key: 'village.band.starving' },
    ],
  },
  {
    id: 'cold',
    icon: 'need.cold',
    labelKey: 'village.need.cold',
    highIsBad: true,
    bands: [
      { below: 40, key: 'village.band.warm' },
      { below: 70, key: 'village.band.chilled' },
      { below: 90, key: 'village.band.cold' },
      { below: Infinity, key: 'village.band.freezing' },
    ],
  },
  {
    id: 'fear',
    icon: 'villager-state.afraid',
    labelKey: 'village.need.fear',
    highIsBad: true,
    bands: [
      { below: 30, key: 'village.band.calm' },
      { below: 60, key: 'village.band.uneasy' },
      { below: 80, key: 'village.band.afraid' },
      { below: Infinity, key: 'village.band.terrified' },
    ],
  },
  {
    id: 'faith',
    icon: 'resource.faith',
    labelKey: 'village.need.faith',
    highIsBad: false,
    bands: [
      { below: 25, key: 'village.band.faithless' },
      { below: 50, key: 'village.band.doubting' },
      { below: 75, key: 'village.band.faithful' },
      { below: Infinity, key: 'village.band.devout' },
    ],
  },
  {
    id: 'health',
    icon: 'villager-state.sick',
    labelKey: 'village.need.health',
    highIsBad: false,
    bands: [
      { below: 25, key: 'village.band.dying' },
      { below: 50, key: 'village.band.ailing' },
      { below: 75, key: 'village.band.weary' },
      { below: Infinity, key: 'village.band.hale' },
    ],
  },
];

export function bandOf(need: NeedDef, value: number): LocaleKey {
  return (
    (need.bands.find((b) => value < b.below) ?? need.bands[need.bands.length - 1])?.key ??
    need.labelKey
  );
}

/** 0–1 "how bad" of a need, for the bar colour. */
export function severity(need: NeedDef, value: number): number {
  const v = Math.min(100, Math.max(0, value)) / 100;
  return need.highIsBad ? v : 1 - v;
}

export function efficiencyKey(e: number): LocaleKey {
  if (e <= 0) return 'village.eff.none';
  if (e < 0.6) return 'village.eff.poor';
  if (e < 0.9) return 'village.eff.fair';
  if (e < 1.15) return 'village.eff.good';
  return 'village.eff.excellent';
}

export function affinityKey(a: number): LocaleKey {
  if (a >= 60) return 'village.bond.devoted';
  if (a >= 30) return 'village.bond.fond';
  if (a >= 5) return 'village.bond.friendly';
  if (a > -5) return 'village.bond.indifferent';
  if (a > -30) return 'village.bond.cool';
  if (a > -60) return 'village.bond.resentful';
  return 'village.bond.hateful';
}

export const FILTERS = ['all', 'working', 'idle', 'afraid', 'needy', 'dead'] as const;
export type Filter = (typeof FILTERS)[number];

export function matches(v: VillagerView, filter: Filter): boolean {
  switch (filter) {
    case 'all':
      return true;
    case 'working':
      return v.alive && (v.tasks.day !== null || v.tasks.night !== null);
    case 'idle':
      return v.alive && v.tasks.day === null && v.tasks.night === null && v.status !== 'sick';
    case 'afraid':
      return v.alive && (v.status === 'terrified' || v.fear >= 60);
    case 'needy':
      return v.alive && (v.status === 'sick' || v.hunger >= 70 || v.cold >= 70 || v.health < 50);
    case 'dead':
      return !v.alive;
  }
}

/** Items the finished work will bring home at dusk (pending batches × outputs). */
export function comingAtDusk(snapshot: Snapshot, content: ContentDatabase): Record<string, number> {
  const out: Record<string, number> = {};
  for (const v of Object.values(snapshot.villagers))
    for (const [taskId, batches] of Object.entries(v.pending)) {
      const task = content.find('tasks', taskId);
      if (!task || task.slot !== 'day') continue;
      for (const effect of task.output)
        if ('giveItem' in effect)
          out[effect.giveItem] = (out[effect.giveItem] ?? 0) + effect.qty * batches;
    }
  return out;
}

export interface GraphNode {
  id: string;
  x: number;
  y: number;
  alive: boolean;
}

export interface GraphEdge {
  a: string;
  b: string;
  /** Mean affinity of the two directions (one direction if only one is known). */
  value: number;
  /** Affinity a → b and b → a (undefined = none). */
  ab: number | undefined;
  ba: number | undefined;
}

/** Villagers on a circle (content order), in a 0–100 square. */
export function layoutCircle(views: readonly VillagerView[], radius = 38): GraphNode[] {
  const n = views.length;
  return views.map((v, i) => {
    const angle = -Math.PI / 2 + (i / Math.max(1, n)) * Math.PI * 2;
    return {
      id: v.id,
      x: 50 + Math.cos(angle) * radius,
      y: 50 + Math.sin(angle) * radius,
      alive: v.alive,
    };
  });
}

export type EdgeFilter = 'all' | 'bonds' | 'grudges';

/** Undirected edges between villagers, filtered by kind and minimum strength. */
export function edgesOf(views: readonly VillagerView[], filter: EdgeFilter, min = 0): GraphEdge[] {
  const ids = views.map((v) => v.id);
  const byId = new Map(views.map((v) => [v.id, v]));
  const out: GraphEdge[] = [];
  for (let i = 0; i < ids.length; i++)
    for (let j = i + 1; j < ids.length; j++) {
      const a = ids[i] ?? '';
      const b = ids[j] ?? '';
      const ab = byId.get(a)?.affinity[b];
      const ba = byId.get(b)?.affinity[a];
      if (ab === undefined && ba === undefined) continue;
      const value = ab !== undefined && ba !== undefined ? (ab + ba) / 2 : (ab ?? ba ?? 0);
      if (Math.abs(value) < min) continue;
      if (filter === 'bonds' && value <= 0) continue;
      if (filter === 'grudges' && value >= 0) continue;
      out.push({ a, b, value, ab, ba });
    }
  return out;
}
