/**
 * Checks with omens (docs/systems/progression.md O1–O7, omens.md): a pool of Fate and Shadow d6
 * built from attribute + skill + talents + gear + state, two axes of result (success/failure ×
 * omen), extreme omens, and an explanation of every die for the UI. Deterministic with the seed.
 */
import type { Effect, ProgressionRules } from '@mrak/content-schema';
import type { ContentDatabase } from '../content/database';
import { event, type CoreEvent } from '../events';
import { modifierSources } from '../items/modifiers';
import type { IRandom } from '../random';
import { effectiveStat, getStat, setStat } from '../state/stats';
import type { WorldState } from '../state/world-state';
import { practice } from './skills';
import { debtTotal, type ReadState } from './rules';

export type Difficulty = 'easy' | 'average' | 'hard' | 'daunting' | 'dire';
export type Omen = 'great' | 'good' | 'none' | 'bad' | 'dire';

export interface CheckRequest {
  skill: string;
  difficulty: Difficulty;
  /** Context of modifiers and of the omen table (default: the skill id). */
  context?: string | undefined;
  /** Anti-grind target of practice (a villager, a POI…). */
  target?: string | undefined;
}

/** One reason the pool has the dice it has. `source`: "attribute:wits", "talent:tree/C1"… */
export interface PoolPart {
  source: string;
  fate: number;
  shadow: number;
}

export interface CheckPool {
  attribute: string;
  fate: number;
  shadow: number;
  parts: PoolPart[];
  /** Omen conversions from talents, in order. */
  conversions: ('bad-to-none' | 'none-to-good' | 'good-to-bad')[];
  /** Blessings whose dice are in the pool (they lose a use). */
  blessings: string[];
}

export interface CheckResult {
  skill: string;
  attribute: string;
  difficulty: Difficulty;
  context: string;
  fateFaces: number[];
  shadowFaces: number[];
  successes: number;
  failures: number;
  good: number;
  bad: number;
  /** Conversions that changed the omen: "talent:bad-to-none", "faith", "corruption". */
  adjustments: string[];
  success: boolean;
  /** ✔ − ✘. */
  net: number;
  omen: Omen;
  parts: PoolPart[];
  /** Omen table cell, if a table exists for the context. */
  outcomeKey: string | null;
}

/** Face meanings (O3). */
export const fateFace = (f: number) => ({ success: f >= 4, good: f === 3 || f === 6 });
export const shadowFace = (f: number) => ({ failure: f >= 4, bad: f === 3 || f === 6 });

function matchesScope(
  m: { skill?: string | undefined; context?: string | undefined },
  req: CheckRequest,
): boolean {
  if (m.skill !== undefined && m.skill !== req.skill) return false;
  if (m.context !== undefined && m.context !== (req.context ?? req.skill)) return false;
  return true;
}

/** The dice pool of a check now (O1, O2). Pure: also used by the UI to preview a check. */
export function buildPool(
  state: ReadState,
  db: ContentDatabase,
  rules: ProgressionRules,
  req: CheckRequest,
): CheckPool {
  const skill = db.get('skills', req.skill);
  const c = rules.checks;
  const parts: PoolPart[] = [];
  const add = (source: string, fate: number, shadow: number): void => {
    if (fate !== 0 || shadow !== 0) parts.push({ source, fate, shadow });
  };
  add(
    `attribute:${skill.attribute}`,
    state.guardian.attributes[skill.attribute] ?? rules.attributes.base,
    0,
  );
  add(`skill:${skill.id}`, state.guardian.skills[skill.id]?.rank ?? 0, 0);
  add(`difficulty:${req.difficulty}`, 0, c.difficulty[req.difficulty]);
  const conversions: CheckPool['conversions'] = [];
  const blessings: string[] = [];
  const debt = debtTotal(state);
  for (const { source, modifier: m } of modifierSources(state, db)) {
    if ('fateDice' in m && matchesScope(m, req)) {
      const dice =
        m.perDebt !== undefined
          ? m.fateDice * Math.min(rules.debt.darkScalingMax, Math.floor(debt / m.perDebt))
          : m.fateDice;
      add(m.perDebt !== undefined ? `debt:${source}` : source, dice, 0);
      if (dice !== 0 && source.startsWith('blessing:')) blessings.push(source);
    } else if ('shadowDice' in m && matchesScope(m, req)) {
      add(source, 0, m.shadowDice);
      if (source.startsWith('blessing:')) blessings.push(source);
    } else if (
      'convertOmen' in m &&
      (m.context === undefined || m.context === (req.context ?? req.skill))
    )
      conversions.push(m.convertOmen);
  }
  if (state.guardian.boonReady) add('virtue:boon', rules.virtue.boonFate, 0);
  const sanity = effectiveStat(state, db, 'sanity');
  if (sanity < c.veryLowSanity.below) add('state:very-low-sanity', 0, c.veryLowSanity.shadow);
  else if (sanity < c.lowSanity.below) add('state:low-sanity', 0, c.lowSanity.shadow);
  if (state.light.inDarkness && !state.light.lit) add('state:darkness', 0, c.darkness);
  if (state.currentZone !== null && c.sacredZones.includes(state.currentZone))
    add('state:sacred', 0, c.sacred);
  const fateSum = parts.reduce((s, p) => s + p.fate, 0);
  const shadowSum = parts.reduce((s, p) => s + p.shadow, 0);
  return {
    attribute: skill.attribute,
    fate: Math.min(c.maxFate, Math.max(1, fateSum)),
    shadow: Math.max(0, shadowSum),
    parts,
    conversions,
    blessings: [...new Set(blessings)],
  };
}

/** Counts symbols and applies conversions (O4, O5). Pure, for rolls and enumeration. */
export function readFaces(
  pool: Pick<CheckPool, 'conversions'>,
  fateFaces: readonly number[],
  shadowFaces: readonly number[],
  faith: number,
  corruption: number,
  rules: ProgressionRules,
): Pick<
  CheckResult,
  'successes' | 'failures' | 'good' | 'bad' | 'adjustments' | 'success' | 'net' | 'omen'
> {
  let successes = 0;
  let good = 0;
  for (const f of fateFaces) {
    const r = fateFace(f);
    if (r.success) successes += 1;
    if (r.good) good += 1;
  }
  let failures = 0;
  let bad = 0;
  for (const f of shadowFaces) {
    const r = shadowFace(f);
    if (r.failure) failures += 1;
    if (r.bad) bad += 1;
  }
  const adjustments: string[] = [];
  for (const conv of pool.conversions) {
    if (conv === 'bad-to-none' && bad > 0) bad -= 1;
    else if (conv === 'none-to-good' && good === bad) good += 1;
    else if (conv === 'good-to-bad' && good > 0) [good, bad] = [good - 1, bad + 1];
    else continue;
    adjustments.push(`talent:${conv}`);
  }
  if (faith >= rules.checks.faithCancels && bad > 0) {
    bad -= 1;
    adjustments.push('faith');
  }
  if (corruption >= rules.checks.corruptionTurns && good > 0) {
    good -= 1;
    bad += 1;
    adjustments.push('corruption');
  }
  const net = successes - failures;
  const omenValue = good - bad;
  const x = rules.checks.extremeOmen;
  const omen: Omen =
    omenValue >= x
      ? 'great'
      : omenValue > 0
        ? 'good'
        : omenValue <= -x
          ? 'dire'
          : omenValue < 0
            ? 'bad'
            : 'none';
  return { successes, failures, good, bad, adjustments, success: net >= 1, net, omen };
}

/** Exact success probability of a pool without conversions (tests, UI odds). */
export function successChance(fate: number, shadow: number): number {
  // Per die: Fate gives +1 success with p 1/2; Shadow +1 failure with p 1/2.
  const binom = (n: number): number[] => {
    const out = [1];
    for (let i = 0; i < n; i++) {
      const next = new Array<number>(out.length + 1).fill(0);
      out.forEach((p, k) => {
        next[k] = (next[k] ?? 0) + p / 2;
        next[k + 1] = (next[k + 1] ?? 0) + p / 2;
      });
      out.splice(0, out.length, ...next);
    }
    return out;
  };
  const f = binom(fate);
  const s = binom(shadow);
  let p = 0;
  f.forEach((pf, a) => {
    s.forEach((ps, b) => {
      if (a - b >= 1) p += pf * ps;
    });
  });
  return p;
}

function tableCell(
  success: boolean,
  omen: Omen,
):
  | 'successGreat'
  | 'successGood'
  | 'successNone'
  | 'successBad'
  | 'failureGood'
  | 'failureNone'
  | 'failureBad'
  | 'failureDire' {
  const o =
    omen === 'great'
      ? 'Great'
      : omen === 'dire'
        ? 'Dire'
        : omen === 'good'
          ? 'Good'
          : omen === 'bad'
            ? 'Bad'
            : 'None';
  if (success) return o === 'Dire' ? 'successBad' : (`success${o}` as 'successGood');
  return o === 'Great' ? 'failureGood' : (`failure${o}` as 'failureGood');
}

/** The omen table outcome of a result (O6). */
export function outcomeOf(
  db: ContentDatabase,
  context: string,
  success: boolean,
  omen: Omen,
): { descKey: string; effects: readonly Effect[] } | null {
  const table = db.all('omen-tables').find((t) => t.context === context);
  if (!table) return null;
  const cell = tableCell(success, omen);
  if (cell === 'successGreat') return table.successGreat ?? table.successGood;
  if (cell === 'failureDire') return table.failureDire ?? table.failureBad;
  return table[cell];
}

export interface ResolvedCheck {
  result: CheckResult;
  events: CoreEvent[];
  /** Effects of the omen table to apply (by the caller's effect applier). */
  effects: readonly Effect[];
}

/**
 * Rolls a check on the draft: consumes the virtue boon and blessing uses, awards practice
 * (S1) and Notice for occult checks (§10), and emits `check/resolved`.
 */
export function resolveCheck(
  draft: WorldState,
  db: ContentDatabase,
  rules: ProgressionRules,
  req: CheckRequest,
  rng: IRandom,
): ResolvedCheck {
  const pool = buildPool(draft, db, rules, req);
  const fateFaces = Array.from({ length: pool.fate }, () => rng.int(1, 6));
  const shadowFaces = Array.from({ length: pool.shadow }, () => rng.int(1, 6));
  const read = readFaces(
    pool,
    fateFaces,
    shadowFaces,
    effectiveStat(draft, db, 'faith'),
    effectiveStat(draft, db, 'corruption'),
    rules,
  );
  const context = req.context ?? req.skill;
  const outcome = outcomeOf(db, context, read.success, read.omen);
  const result: CheckResult = {
    skill: req.skill,
    attribute: pool.attribute,
    difficulty: req.difficulty,
    context,
    fateFaces,
    shadowFaces,
    ...read,
    parts: pool.parts,
    outcomeKey: outcome?.descKey ?? null,
  };
  const events: CoreEvent[] = [event('check/resolved', result)];
  if (draft.guardian.boonReady) draft.guardian.boonReady = false;
  for (const source of pool.blessings) {
    const [gear = '', blessing = ''] = source.slice('blessing:'.length).split('/');
    const b = draft.guardian.blessings[gear]?.find((x) => x.blessing === blessing);
    if (b?.usesLeft !== null && b !== undefined && b.usesLeft > 0) {
      b.usesLeft -= 1;
      if (b.usesLeft === 0) events.push(event('gear/blessingExpired', { gear, blessing }));
    }
  }
  const p = rules.skills.practice;
  const points =
    (read.success
      ? read.omen === 'good' || read.omen === 'great'
        ? p.goodOmen
        : p.success
      : p.failure) +
    (rules.checks.difficulty[req.difficulty] >= rules.checks.difficulty.hard ? p.hardBonus : 0);
  events.push(...practice(draft, rules, req.skill, points, { target: req.target }));
  if (rules.notice.occultSkills.includes(req.skill)) {
    const notice = getStat(draft, db, 'notice');
    setStat(draft, db, 'notice', notice + rules.notice.occultismCheck);
  }
  return { result, events, effects: outcome?.effects ?? [] };
}
