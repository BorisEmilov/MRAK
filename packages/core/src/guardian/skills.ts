/**
 * Attributes and skills (docs/systems/progression.md A1–A2, S1–S4): skills improve by use up to a
 * cap; Revelation raises attributes and caps.
 */
import type { ProgressionRules } from '@mrak/content-schema';
import type { ContentDatabase } from '../content/database';
import { event, type CoreEvent } from '../events';
import { setStat } from '../state/stats';
import type { WorldState } from '../state/world-state';
import {
  absoluteMinute,
  assertCanSpend,
  ProgressionError,
  revelationOf,
  talentRanks,
  type ReadState,
} from './rules';

/** Practice needed to go from `rank` to `rank + 1` (6, 24, 54, 96, 150 by default). */
export function threshold(rules: ProgressionRules, rank: number): number {
  return rules.skills.thresholdFactor * (rank + 1) ** 2;
}

export function isCallingSkill(state: ReadState, db: ContentDatabase, skill: string): boolean {
  const calling = state.guardian.callingId ? db.find('callings', state.guardian.callingId) : null;
  return calling?.callingSkills.includes(skill) ?? false;
}

/** Highest rating an attribute may reach (5, or 6 with a talent rule `attribute-max-6`). */
export function attributeMax(
  state: ReadState,
  db: ContentDatabase,
  rules: ProgressionRules,
  attribute: string,
): number {
  for (const talent of talentRanks(state, db).keys())
    for (const e of db.find('talents', talent)?.effects ?? [])
      if ('rule' in e && e.rule === 'attribute-max-6' && e.params?.['attribute'] === attribute)
        return rules.attributes.absoluteMax;
  return rules.attributes.cap;
}

export function attributeCost(rules: ProgressionRules, current: number): number {
  return rules.attributes.costPerRating * (current + 1);
}

export function skillCapCost(
  state: ReadState,
  db: ContentDatabase,
  rules: ProgressionRules,
  skill: string,
): number {
  const next = (state.guardian.skills[skill]?.cap ?? 0) + 1;
  return (
    rules.skills.capCost * next +
    (isCallingSkill(state, db, skill) ? 0 : rules.skills.foreignCapExtra)
  );
}

/** Takes Revelation from the guardian (already validated). */
export function spend(
  draft: WorldState,
  db: ContentDatabase,
  amount: number,
  target: string,
): CoreEvent[] {
  const available = revelationOf(draft);
  if (amount > available) throw new ProgressionError('not enough revelation');
  setStat(draft, db, 'revelation', available - amount);
  return [event('revelation/spent', { target, amount, left: available - amount })];
}

export function raiseAttribute(
  draft: WorldState,
  db: ContentDatabase,
  rules: ProgressionRules,
  attribute: string,
): CoreEvent[] {
  assertCanSpend(draft);
  db.get('attributes', attribute);
  const current = draft.guardian.attributes[attribute] ?? rules.attributes.base;
  if (current >= attributeMax(draft, db, rules, attribute))
    throw new ProgressionError('attribute at its maximum');
  const cost = attributeCost(rules, current);
  const events = spend(draft, db, cost, `attribute:${attribute}`);
  draft.guardian.attributes[attribute] = current + 1;
  events.push(event('attribute/raised', { attribute, to: current + 1, cost }));
  return events;
}

/** Ranks up while practice suffices and the cap allows; flags a skill waiting at its cap. */
function settle(
  draft: WorldState,
  rules: ProgressionRules,
  skill: string,
  wasReady: boolean,
): CoreEvent[] {
  const s = draft.guardian.skills[skill];
  if (!s) return [];
  const events: CoreEvent[] = [];
  while (s.rank < s.cap && s.practice >= threshold(rules, s.rank)) {
    s.practice = 0;
    s.rank += 1;
    events.push(event('skill/rankUp', { skill, rank: s.rank }));
  }
  if (s.rank >= s.cap && s.rank < rules.skills.maxCap) {
    const need = threshold(rules, s.rank);
    s.practice = Math.min(s.practice, need);
    if (s.practice >= need && !wasReady) events.push(event('skill/readyToGrow', { skill }));
  }
  return events;
}

export function isReadyToGrow(
  rules: ProgressionRules,
  s: { rank: number; cap: number; practice: number },
): boolean {
  return s.rank >= s.cap && s.rank < rules.skills.maxCap && s.practice >= threshold(rules, s.rank);
}

export function raiseSkillCap(
  draft: WorldState,
  db: ContentDatabase,
  rules: ProgressionRules,
  skill: string,
): CoreEvent[] {
  assertCanSpend(draft);
  db.get('skills', skill);
  const s = draft.guardian.skills[skill];
  if (!s) throw new ProgressionError('unknown skill');
  if (s.cap >= rules.skills.maxCap) throw new ProgressionError('cap at its maximum');
  const cost = skillCapCost(draft, db, rules, skill);
  const events = spend(draft, db, cost, `cap:${skill}`);
  s.cap += 1;
  events.push(event('skill/capRaised', { skill, cap: s.cap, cost }));
  events.push(...settle(draft, rules, skill, true));
  return events;
}

export interface PracticeOptions {
  /** Anti-grind key: the same skill on the same target within `repeatMinutes` gives nothing. */
  target?: string | undefined;
  /** A plain use (not a check): capped per day. */
  use?: boolean;
}

/** Adds practice to a skill (S1–S3). */
export function practice(
  draft: WorldState,
  rules: ProgressionRules,
  skill: string,
  points: number,
  options: PracticeOptions = {},
): CoreEvent[] {
  const s = draft.guardian.skills[skill];
  if (!s || points <= 0) return [];
  const g = draft.guardian;
  const now = absoluteMinute(draft.clock);
  if (options.target !== undefined) {
    const key = `${skill}:${options.target}`;
    const last = g.practiceLog[key];
    g.practiceLog[key] = now;
    if (last !== undefined && now - last < rules.skills.repeatMinutes) return [];
    // Keep the log small: forget entries older than a day.
    for (const [k, at] of Object.entries(g.practiceLog))
      // eslint-disable-next-line @typescript-eslint/no-dynamic-delete -- plain record
      if (now - at > 1440) delete g.practiceLog[k];
  }
  let gained = points;
  if (options.use) {
    if (g.practiceToday.day !== draft.clock.day)
      g.practiceToday = { day: draft.clock.day, points: {} };
    const used = g.practiceToday.points[skill] ?? 0;
    gained = Math.max(0, Math.min(points, rules.skills.dailyUseCap - used));
    if (gained === 0) return [];
    g.practiceToday.points[skill] = used + gained;
  }
  const wasReady = isReadyToGrow(rules, s);
  s.practice += gained;
  return [
    event('skill/practiced', { skill, points: gained }),
    ...settle(draft, rules, skill, wasReady),
  ];
}
