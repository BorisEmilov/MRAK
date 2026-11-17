/** Shared helpers of the fear engine (sanity, hysteria, event director). */
import type { Effect, FearRules } from '@mrak/content-schema';
import type { ContentDatabase } from '../content/database';
import type { CoreEvent, GameTime } from '../events';
import type { IRandom } from '../random';
import type { Snapshot, WorldState } from '../state/world-state';
import { dayPhaseAt, jdnToJulian, lightBoundaries, MINUTES_PER_DAY } from '../time/calendar';
import { checkpoints } from '../village/village-sim';
import { WITCHING_MINUTE } from '../time/clock';

export type ReadState = Snapshot | WorldState;

export class FearRuleError extends Error {}

/** The fear rules (data/fear-rules/default), or null when the pack has none. */
export function fearRules(db: ContentDatabase): FearRules | null {
  return db.find('fear-rules', 'default') ?? null;
}

/** What the fear systems need from the game. */
export interface FearContext {
  db: ContentDatabase;
  rules: FearRules;
  /** Applies content effects with a source; returns their events. */
  apply: (effects: readonly Effect[], source: string) => CoreEvent[];
  random: (stream: 'director' | 'villagers') => IRandom;
}

export const absMinute = (t: GameTime): number => t.day * MINUTES_PER_DAY + t.minute;
export const toTime = (a: number): GameTime => ({
  day: Math.floor(a / MINUTES_PER_DAY),
  minute: ((a % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY,
});

export function isNightAt(a: number): boolean {
  const t = toTime(a);
  return dayPhaseAt(t.minute, jdnToJulian(t.day).month) === 'night';
}

/** "HH:MM" → minute of the day. */
export function clock(text: string): number {
  const [h = '0', m = '0'] = text.split(':');
  return Number(h) * 60 + Number(m);
}

/** True if `minute` lies in [from, to] (wrapping past midnight). */
export function inWindow(minute: number, from: string, to: string): boolean {
  const a = clock(from);
  const b = clock(to);
  return a <= b ? minute >= a && minute <= b : minute >= a || minute <= b;
}

export type FearMomentKind = 'hour' | 'dawn' | 'witching' | 'tick';
export interface FearMoment {
  at: number;
  kind: FearMomentKind;
}
const ORDER: Record<FearMomentKind, number> = { hour: 0, dawn: 1, witching: 2, tick: 3 };

/** Moments in (from, to] the fear systems react to, in order. */
export function fearMoments(from: GameTime, to: GameTime): FearMoment[] {
  const start = absMinute(from);
  const end = absMinute(to);
  if (end <= start) return [];
  const out: FearMoment[] = [];
  for (const c of checkpoints(from, to)) {
    if (c.kind === 'hour' || c.kind === 'dawn') out.push({ at: c.at, kind: c.kind });
  }
  for (let a = Math.ceil((start + 1) / 30) * 30; a <= end; a += 30)
    out.push({ at: a, kind: 'tick' });
  for (let day = from.day; day <= to.day; day++) {
    const a = day * MINUTES_PER_DAY + WITCHING_MINUTE;
    if (a > start && a <= end) out.push({ at: a, kind: 'witching' });
  }
  return out.sort((x, y) => x.at - y.at || ORDER[x.kind] - ORDER[y.kind]);
}

/** True if a director tick or the witching minute lies in (from, to]. */
export function crossesFearMoment(from: GameTime, to: GameTime): boolean {
  const start = absMinute(from);
  const end = absMinute(to);
  if (end <= start) return false;
  if (Math.floor(end / 30) > Math.floor(start / 30)) return true;
  return fearMoments(from, to).some((m) => m.kind === 'witching');
}

/** The night an absolute minute belongs to: its start (absolute) and length in minutes. */
export function nightOf(a: number): { start: number; length: number; day: number } {
  const t = toTime(a);
  const today = lightBoundaries(jdnToJulian(t.day).month);
  const day = t.minute >= today.nightStart ? t.day : t.day - 1;
  const { nightStart } = lightBoundaries(jdnToJulian(day).month);
  const { dawnStart } = lightBoundaries(jdnToJulian(day + 1).month);
  return {
    day,
    start: day * MINUTES_PER_DAY + nightStart,
    length: MINUTES_PER_DAY - nightStart + dawnStart,
  };
}

/** Weighted pick; returns the index or -1 when every weight is 0. */
export function weightedIndex(weights: readonly number[], rng: IRandom): number {
  const total = weights.reduce((s, w) => s + Math.max(0, w), 0);
  if (total <= 0) return -1;
  let r = rng.next() * total;
  for (let i = 0; i < weights.length; i++) {
    r -= Math.max(0, weights[i] ?? 0);
    if (r < 0) return i;
  }
  return weights.length - 1;
}
