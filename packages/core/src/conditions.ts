/**
 * Evaluates content conditions (docs/systems/conditions-effects.md).
 * The `Condition` type is inferred from the Zod schema in @mrak/content-schema — never redefined here.
 */
import type { Comparator, Condition } from '@mrak/content-schema';
import type { ContentDatabase } from './content/database';
import type { IRandom } from './random';
import { effectiveStat } from './state/stats';
import type { Snapshot, WorldState } from './state/world-state';
import { hasTalent } from './guardian/rules';
import { itemCount } from './items/inventory';
import { categoryProgress, type Category } from './items/progress';
import {
  dayPhaseAt,
  festivalsOn,
  jdnToJulian,
  moonPhase,
  type DayPhase,
  type MoonPhase,
} from './time/calendar';

export type { DayPhase };
export type QuestStatus = 'active' | 'done' | 'failed';

/** Read-only view of the world that conditions are evaluated against. */
export interface ConditionContext {
  flag(id: string): boolean;
  /** `villager` is set for villager-scoped stats. */
  stat(id: string, villager?: string): number;
  itemCount(id: string, where?: 'pack' | 'storage'): number;
  /** Today's Julian month and day. */
  monthDay(): { month: number; day: number };
  moon(): MoonPhase;
  /** Today is the first day of this festival. */
  festivalDay(id: string): boolean;
  collection(category: Category): { have: number; total: number };
  hasClue(id: string): boolean;
  hasTalent(id: string): boolean;
  callingId(): string;
  pactSigned(id: string): boolean;
  chapterId(): string;
  phase(): DayPhase;
  villagerAlive(id: string): boolean;
  possessionRevealed(villagerId: string): boolean;
  quest(id: string): { readonly status: QuestStatus; readonly stage: string } | undefined;
  mysteryConclusion(
    id: string,
  ): { readonly correct: boolean; readonly culprit: string } | undefined;
  /** Seeded stream used by `chance` conditions. */
  random: IRandom;
}

const COMPARE: Record<Comparator, (a: number, b: number) => boolean> = {
  '>=': (a, b) => a >= b,
  '>': (a, b) => a > b,
  '<=': (a, b) => a <= b,
  '<': (a, b) => a < b,
  '==': (a, b) => a === b,
  '!=': (a, b) => a !== b,
};

function compare(value: number, cond: Partial<Record<Comparator, number | undefined>>): boolean {
  for (const op of Object.keys(COMPARE) as Comparator[]) {
    const target = cond[op];
    if (target !== undefined) return COMPARE[op](value, target);
  }
  return false;
}

/** "MM-DD" → month * 100 + day. */
function mmdd(text: string): number {
  const [m = '1', d = '1'] = text.split('-');
  return Number(m) * 100 + Number(d);
}

/** Inclusive Julian month/day range; wraps the new year when `from` is after `to`. */
export function inDateRange(
  today: { month: number; day: number },
  from: string,
  to: string,
): boolean {
  const t = today.month * 100 + today.day;
  const a = mmdd(from);
  const b = mmdd(to);
  return a <= b ? t >= a && t <= b : t >= a || t <= b;
}

export function evaluateCondition(cond: Condition, ctx: ConditionContext): boolean {
  if ('all' in cond) return cond.all.every((c) => evaluateCondition(c, ctx));
  if ('any' in cond) return cond.any.some((c) => evaluateCondition(c, ctx));
  if ('not' in cond) return !evaluateCondition(cond.not, ctx);
  if ('flag' in cond) return ctx.flag(cond.flag);
  if ('stat' in cond) return compare(ctx.stat(cond.stat, cond.villager), cond);
  if ('hasItem' in cond) return ctx.itemCount(cond.hasItem, cond.in) >= (cond.qty ?? 1);
  if ('date' in cond) return inDateRange(ctx.monthDay(), cond.date.from, cond.date.to);
  if ('moon' in cond) return cond.moon.includes(ctx.moon());
  if ('festivalDay' in cond) return ctx.festivalDay(cond.festivalDay);
  if ('collection' in cond) {
    const { have, total } = ctx.collection(cond.collection);
    if (cond['>='] === 'all') return have >= total;
    return compare(have, { ...cond, '>=': cond['>='] });
  }
  if ('clue' in cond) return ctx.hasClue(cond.clue);
  if ('talent' in cond) return ctx.hasTalent(cond.talent);
  if ('calling' in cond) return ctx.callingId() === cond.calling;
  if ('pactSigned' in cond) return ctx.pactSigned(cond.pactSigned);
  if ('chapter' in cond) return ctx.chapterId() === cond.chapter;
  if ('phase' in cond) return ctx.phase() === cond.phase;
  if ('villagerAlive' in cond) return ctx.villagerAlive(cond.villagerAlive);
  if ('possessionRevealed' in cond) return ctx.possessionRevealed(cond.possessionRevealed);
  if ('quest' in cond) {
    const q = ctx.quest(cond.quest);
    if (!q) return false;
    return (
      (cond.status === undefined || q.status === cond.status) &&
      (cond.stage === undefined || q.stage === cond.stage)
    );
  }
  if ('mysteryConcluded' in cond) {
    const c = ctx.mysteryConclusion(cond.mysteryConcluded);
    if (!c) return false;
    return (
      (cond.correct === undefined || c.correct === cond.correct) &&
      (cond.culprit === undefined || c.culprit === cond.culprit)
    );
  }
  return ctx.random.next() < cond.chance;
}

/** Builds the read-only condition context of a world state. */
export class ConditionEvaluator {
  constructor(
    private readonly db: ContentDatabase,
    private readonly random: IRandom,
  ) {}

  context(state: Snapshot | WorldState): ConditionContext {
    const { db } = this;
    return {
      flag: (id) => state.flags[id] === true,
      stat: (id, villager) => effectiveStat(state, db, id, villager),
      itemCount: (id, where) => itemCount(state, id, where ?? 'any'),
      monthDay: () => jdnToJulian(state.clock.day),
      moon: () => moonPhase(state.clock.day).phase,
      festivalDay: (id) => {
        const festival = db.find('festivals', id);
        return (
          festival !== undefined &&
          festivalsOn([festival], state.clock.day).some((f) => f.night === 1)
        );
      },
      collection: (category) => categoryProgress(state, db, category),
      hasClue: (id) => {
        const mystery = state.mysteries[db.mysteryOfClue(id)];
        return mystery?.clues.includes(id) ?? false;
      },
      hasTalent: (id) => hasTalent(state, db, id),
      callingId: () => state.guardian.callingId ?? '',
      pactSigned: (id) => id in state.pacts,
      chapterId: () => state.calendar.chapterId ?? '',
      phase: () => dayPhaseAt(state.clock.minute, jdnToJulian(state.clock.day).month),
      villagerAlive: (id) => state.villagers[id]?.alive ?? false,
      possessionRevealed: (id) => state.possessions.some((p) => p.host === id && p.revealed),
      quest: (id) => state.quests[id],
      mysteryConclusion: (id) => state.mysteries[id]?.conclusion ?? undefined,
      random: this.random,
    };
  }

  evaluate(cond: Condition, state: Snapshot | WorldState): boolean {
    return evaluateCondition(cond, this.context(state));
  }
}
