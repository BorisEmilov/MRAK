/** Shared by the long-term systems: village growth, festival chapters and the lineage. */
import type { Effect } from '@mrak/content-schema';
import type { ContentDatabase } from '../content/database';
import type { CoreEvent } from '../events';
import type { FearContext } from '../fear/common';
import type { IRandom } from '../random';
import type { GameTime, Snapshot, WorldState } from '../state/world-state';
import { jdnToJulian } from '../time/calendar';

export class ChronicleError extends Error {}

export interface ChronicleContext {
  db: ContentDatabase;
  /** Applies content effects with a source; returns their events. */
  apply: (effects: readonly Effect[], source: string) => CoreEvent[];
  /** Births, deaths and newcomers. */
  rng: IRandom;
  /** Rite checks. */
  checks: IRandom;
  /** The fear engine (blood prices); null without fear rules. */
  fear: FearContext | null;
}

export type ReadState = Snapshot | WorldState;

export const yearOf = (day: number): number => jdnToJulian(day).year;
export const nowOf = (s: ReadState): GameTime => ({ day: s.clock.day, minute: s.clock.minute });

/** The year content ages are given for (the `year` stat's default, 1834). */
export function contentYear(db: ContentDatabase): number {
  return db.hasStat('year') ? db.statDecl('year').default : 1834;
}

/** Someone who lives in Mrak: a content villager or a person the years brought. */
export interface Resident {
  id: string;
  sex: 'female' | 'male';
  born: number;
  person: boolean;
  parents: readonly string[];
}

export function residents(s: ReadState, db: ContentDatabase): Resident[] {
  const out: Resident[] = [];
  const base = contentYear(db);
  for (const v of db.all('villagers')) {
    if (s.villagers[v.id]?.alive !== true) continue;
    const born = s.endless.born[v.id] ?? base - v.age;
    out.push({ id: v.id, sex: v.sex, born, person: false, parents: [] });
  }
  for (const p of s.village.people) {
    if (!p.alive || p.left) continue;
    out.push({ id: p.id, sex: p.sex, born: p.born, person: true, parents: p.parents });
  }
  return out;
}

export function personOf(
  s: WorldState,
  id: string,
): WorldState['village']['people'][number] | undefined;
export function personOf(
  s: ReadState,
  id: string,
): Snapshot['village']['people'][number] | undefined;
export function personOf(
  s: ReadState,
  id: string,
): Snapshot['village']['people'][number] | undefined {
  return s.village.people.find((p) => p.id === id);
}
