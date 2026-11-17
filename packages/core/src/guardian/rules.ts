/**
 * Progression rules and shared helpers (docs/systems/progression.md). Every number comes from
 * data/progression-rules/default.json.
 */
import type { ProgressionRules } from '@mrak/content-schema';
import type { ContentDatabase } from '../content/database';
import type { Snapshot, WorldState } from '../state/world-state';
import { dayPhaseAt, jdnToJulian } from '../time/calendar';

export type ReadState = Snapshot | WorldState;

/** A progression command was refused (reason in plain words, mapped to locale keys by the UI). */
export class ProgressionError extends Error {}

export function progressionRules(db: ContentDatabase): ProgressionRules | null {
  return db.find('progression-rules', 'default') ?? null;
}

export function requireProgressionRules(db: ContentDatabase): ProgressionRules {
  const rules = progressionRules(db);
  if (!rules) throw new ProgressionError('this content has no progression rules');
  return rules;
}

/** Absolute in-world minute (for cooldowns and anti-grind). */
export function absoluteMinute(clock: { day: number; minute: number }): number {
  return clock.day * 1440 + clock.minute;
}

export function isNight(state: ReadState): boolean {
  return dayPhaseAt(state.clock.minute, jdnToJulian(state.clock.day).month) === 'night';
}

/** Spending Revelation is refused at night (R5). */
export function assertCanSpend(state: ReadState): void {
  if (state.guardian.callingId === null) throw new ProgressionError('no guardian');
  if (isNight(state)) throw new ProgressionError('not at night');
}

export function revelationOf(state: ReadState): number {
  return state.stats['revelation'] ?? 0;
}

/** "tree/cell" → parts. */
export function splitCell(key: string): { tree: string; cell: string } {
  const [tree = '', cell = ''] = key.split('/');
  return { tree, cell };
}

/** Talent ids the guardian owns, with ranks (a ranked talent bought in two trees has rank 2). */
export function talentRanks(state: ReadState, db: ContentDatabase): Map<string, number> {
  const out = new Map<string, number>();
  for (const key of state.guardian.talents) {
    const { tree, cell } = splitCell(key);
    const node = db.find('trees', tree)?.nodes.find((n) => n.cell === cell);
    if (node) out.set(node.talent, (out.get(node.talent) ?? 0) + 1);
  }
  return out;
}

export function hasTalent(state: ReadState, db: ContentDatabase, talent: string): boolean {
  return talentRanks(state, db).has(talent);
}

export function debtTotal(state: ReadState): number {
  let total = 0;
  for (const e of state.debt.entries) total += e.amount;
  return Math.max(0, total);
}
