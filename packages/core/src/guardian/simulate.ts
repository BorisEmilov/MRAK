/**
 * Progression simulator (docs/systems/progression.md §12, progression-economy.md §10): player
 * profiles play abstract nights on the real content and the real progression rules (milestones,
 * costs, practice, checks, debt collections) with a seed, and report one sample per played hour.
 *
 * Abstractions (tooling, not game rules): a night-and-day cycle lasts `minutesPerNight` of play;
 * milestone frequencies per night come from the plan (§3) spread over a 12-night chapter; the
 * guardian rests 10 Sanity each day; other systems (combat, village) are not simulated.
 */
import type { ContentDatabase } from '../content/database';
import { EffectApplier, type EffectContext } from '../effects';
import type { CoreEvent } from '../events';
import { createRandom, RandomStreams, type IRandom } from '../random';
import { effectiveStat, getStat, setStat } from '../state/stats';
import { createInitialState, type WorldState } from '../state/world-state';
import { resolveCheck } from './checks';
import { createGuardian, type GuardianChoices } from './creation';
import { payDebt, rollCollection } from './debt';
import { awardMilestone } from './revelation';
import { debtTotal, revelationOf, requireProgressionRules } from './rules';
import {
  attributeCost,
  isReadyToGrow,
  raiseAttribute,
  raiseSkillCap,
  skillCapCost,
  practice,
} from './skills';
import { affordableTalents, buyTalent, buyTree, treeAccessCost } from './talents';
import { ConditionEvaluator } from '../conditions';

export interface SimProfile {
  id: 'cautious' | 'dark' | 'investigator';
  choices: GuardianChoices;
  /** Probability per night of each effect-granted milestone. */
  perNight: Record<string, number>;
  /** Skills rolled each night (average difficulty). */
  checks: readonly string[];
  /** Attribute raised first when talents are scarce. */
  focusAttribute: string;
  /** Prefer raising this attribute over talents above T1. */
  attributeFirst: boolean;
  /** Night on which the profile signs a pact (dark), or null. */
  pact: { id: string; night: number } | null;
  /** Debt sources taken each chapter (favours, loans). */
  favoursPerChapter: readonly string[];
  /** Pays remedies when the debt passes this total. */
  payAbove: number;
}

const BASE_RATES: Record<string, number> = {
  'night-objective': 0.7,
  'zone-discovered': 1 / 12,
  'clue-found': 0.4,
  'truth-discovered': 0.17,
  'villager-arc': 0.12,
  'exorcism-lesser': 0.17,
  'first-sighting': 0.2,
  'recipe-discovered': 0.2,
  'tale-heard': 0.2,
};

export const PROFILES: Readonly<Record<SimProfile['id'], SimProfile>> = {
  cautious: {
    id: 'cautious',
    choices: {
      calling: 'priests-acolyte',
      tree: 'exorcist',
      bonus: 'resolve',
      virtue: 'mercy',
      sin: 'pride',
    },
    perNight: BASE_RATES,
    checks: ['faith', 'exorcism', 'lore'],
    focusAttribute: 'resolve',
    attributeFirst: false,
    pact: null,
    favoursPerChapter: [],
    payAbove: 0,
  },
  dark: {
    id: 'dark',
    choices: {
      calling: 'znaharka',
      tree: 'charm-speaker',
      bonus: 'cunning',
      virtue: 'compassion',
      sin: 'wrath',
    },
    perNight: { ...BASE_RATES, 'truth-discovered': 0.14, 'villager-arc': 0.1 },
    checks: ['occultism', 'herbalism', 'persuasion'],
    focusAttribute: 'cunning',
    attributeFirst: false,
    pact: { id: 'crossroads-bargain', night: 3 },
    favoursPerChapter: ['forest-favour'],
    payAbove: 60,
  },
  investigator: {
    id: 'investigator',
    choices: {
      calling: 'priests-acolyte',
      tree: 'confessor',
      bonus: 'wits',
      virtue: 'patience',
      sin: 'pride',
    },
    perNight: {
      ...BASE_RATES,
      'clue-found': 0.6,
      'truth-discovered': 0.22,
      'exorcism-lesser': 0.1,
    },
    checks: ['investigation', 'lore', 'persuasion'],
    focusAttribute: 'wits',
    attributeFirst: true,
    pact: null,
    favoursPerChapter: [],
    payAbove: 0,
  },
};

export interface HourSample {
  hour: number;
  /** Lifetime Revelation of the guardian. */
  revelation: number;
  /** Unspent Revelation. */
  available: number;
  power: number;
  debt: number;
  corruption: number;
  talents: number;
  ranks: number;
}

/** P = Σ attributes + Σ skill ranks + 0.5 × talents (progression-economy.md §5). */
export function powerIndex(state: WorldState): number {
  const g = state.guardian;
  const attributes = Object.values(g.attributes).reduce((s, v) => s + v, 0);
  const ranks = Object.values(g.skills).reduce((s, v) => s + v.rank, 0);
  return attributes + ranks + 0.5 * g.talents.length;
}

export interface SimOptions {
  profile: SimProfile;
  seed: number;
  /** Played years (6 chapters of 12 nights each). */
  years?: number;
  /** Hours to simulate (overrides `years`). */
  hours?: number;
  minutesPerNight?: number;
  nightsPerChapter?: number;
}

/** Runs one profile; returns one sample per played hour (hour 0 = creation). */
export function simulate(db: ContentDatabase, options: SimOptions): HourSample[] {
  const rules = requireProgressionRules(db);
  const { profile } = options;
  const minutesPerNight = options.minutesPerNight ?? 35;
  const nightsPerChapter = options.nightsPerChapter ?? 12;
  const hours =
    options.hours ??
    Math.ceil(((options.years ?? 1) * 6 * nightsPerChapter * minutesPerNight) / 60);
  const nights = Math.ceil((hours * 60) / minutesPerNight);
  const random = new RandomStreams(options.seed);
  const rng: IRandom = random.get('director');
  const effects = new EffectApplier();
  const state = createInitialState(db, { startMinute: 10 * 60 });
  const ctx = (source: string): EffectContext => ({
    db,
    random,
    rules: new Map(),
    now: { day: state.clock.day, minute: state.clock.minute },
    source,
  });
  const apply = (list: Parameters<EffectApplier['apply']>[1], source: string): CoreEvent[] =>
    effects.apply(state, list, ctx(source));
  createGuardian(state, db, rules, profile.choices, apply);

  const samples: HourSample[] = [sample(state, 0)];
  let targets = 0;
  for (let night = 1; night <= nights; night++) {
    state.clock.day += 1;
    // Night: checks and milestones.
    state.clock.minute = 23 * 60;
    for (const skill of profile.checks) {
      const check = resolveCheck(
        state,
        db,
        rules,
        { skill, difficulty: 'average' },
        random.get('checks'),
      );
      apply(check.effects, 'sim:check');
    }
    const award = (id: string, target?: string): void => {
      if (db.has('milestones', id)) awardMilestone(state, db, id, target);
    };
    award('night-survived');
    for (const [milestone, p] of Object.entries(profile.perNight))
      if (db.has('milestones', milestone) && rng.next() < p) {
        targets += 1;
        award(milestone, `sim-${String(targets)}`);
      }
    if (night % nightsPerChapter === 0) {
      award('chapter-survived');
      award('mystery-chapter', `chapter-${String(night)}`);
    }
    if (night % nightsPerChapter === 1)
      for (const source of profile.favoursPerChapter) apply([{ addDebt: source }], 'sim:favour');
    if (profile.pact && night === profile.pact.night && !(profile.pact.id in state.pacts)) {
      const pact = db.get('pacts', profile.pact.id);
      state.pacts[pact.id] = {
        signedAt: { day: state.clock.day, minute: state.clock.minute },
        clauses: {},
      };
      apply(
        [
          ...pact.offerEffects,
          { addDebt: pact.debt },
          ...(pact.unlocksTree ? [{ unlockTree: pact.unlocksTree }] : []),
        ],
        `pact:${pact.id}`,
      );
    }
    // Dusk of the next day is when the debt is called in.
    const evaluator = new ConditionEvaluator(db, createRandom(night));
    const collected = rollCollection(state, db, rules, random.get('night'), (c) =>
      evaluator.evaluate(c, state),
    );
    apply(collected.effects, collected.source || 'sim:debt');
    // Day: plain uses, rest, then spending.
    state.clock.minute = 10 * 60;
    for (const use of ['gather', 'talk'] as const) {
      const skill = rules.skills.uses[use];
      if (skill) practice(state, rules, skill, rules.skills.practice.use * 2, { use: true });
    }
    setStat(
      state,
      db,
      'sanity',
      Math.min(effectiveStat(state, db, 'sanity-max'), getStat(state, db, 'sanity') + 10),
    );
    if (profile.payAbove > 0 && debtTotal(state) > profile.payAbove)
      for (const r of db.all('debt-remedies')) {
        try {
          apply(
            payDebt(state, db, r.id, (c) => evaluator.evaluate(c, state)).cost,
            `remedy:${r.id}`,
          );
        } catch {
          // Not payable now: nothing owed to that creditor or its condition fails.
        }
      }
    spendAll(state, db, profile, apply);
    const hourNow = Math.floor((night * minutesPerNight) / 60);
    const hourBefore = Math.floor(((night - 1) * minutesPerNight) / 60);
    for (let h = hourBefore + 1; h <= hourNow && h <= hours; h++) samples.push(sample(state, h));
  }
  return samples;

  function sample(s: WorldState, hour: number): HourSample {
    return {
      hour,
      revelation: s.guardian.revelation.lifetime,
      available: revelationOf(s),
      power: powerIndex(s),
      debt: debtTotal(s),
      corruption: getStat(s, db, 'corruption'),
      talents: s.guardian.talents.length,
      ranks: Object.values(s.guardian.skills).reduce((sum, v) => sum + v.rank, 0),
    };
  }
}

/** Greedy spending policy of a profile. */
function spendAll(
  state: WorldState,
  db: ContentDatabase,
  profile: SimProfile,
  apply: (list: Parameters<EffectApplier['apply']>[1], source: string) => CoreEvent[],
): void {
  const rules = requireProgressionRules(db);
  for (let guard = 0; guard < 40; guard++) {
    const rev = revelationOf(state);
    const ready = Object.entries(state.guardian.skills).find(
      ([id, s]) => isReadyToGrow(rules, s) && skillCapCost(state, db, rules, id) <= rev,
    );
    if (ready) {
      raiseSkillCap(state, db, rules, ready[0]);
      continue;
    }
    const focus = state.guardian.attributes[profile.focusAttribute] ?? rules.attributes.base;
    const attrCost = focus < rules.attributes.cap ? attributeCost(rules, focus) : Infinity;
    if (profile.attributeFirst && attrCost <= rev) {
      raiseAttribute(state, db, rules, profile.focusAttribute);
      continue;
    }
    const options = affordableTalents(state, db, rules).sort((a, b) => {
      const darkA = db.get('trees', a.tree).kind === 'dark' ? 0 : 1;
      const darkB = db.get('trees', b.tree).kind === 'dark' ? 0 : 1;
      return (profile.id === 'dark' ? darkA - darkB : 0) || a.cost - b.cost;
    });
    const pick = options[0];
    if (pick) {
      buyTalent(state, db, rules, pick.tree, pick.cell, apply);
      continue;
    }
    if (attrCost <= rev) {
      raiseAttribute(state, db, rules, profile.focusAttribute);
      continue;
    }
    const second = db
      .get('callings', profile.choices.calling)
      .trees.find((t) => treeAccessCost(state, db, rules, t) !== null);
    if (second && (treeAccessCost(state, db, rules, second) ?? Infinity) <= rev) {
      buyTree(state, db, rules, second);
      continue;
    }
    return;
  }
}

/** Plan bands (progression-economy.md §10). */
export const PLAN_BANDS: readonly {
  hour: number;
  revelation: [number, number];
  power: [number, number];
  debtDark: [number, number];
  debtOther: [number, number];
}[] = [
  { hour: 1, revelation: [15, 40], power: [17, 22], debtDark: [0, 20], debtOther: [0, 0] },
  { hour: 5, revelation: [100, 170], power: [22, 30], debtDark: [10, 60], debtOther: [0, 10] },
  { hour: 8, revelation: [190, 300], power: [27, 37], debtDark: [15, 80], debtOther: [0, 10] },
];

export interface PlanCheck {
  hour: number;
  metric: 'revelation' | 'power' | 'debt';
  value: number;
  band: [number, number];
  ok: boolean;
}

const median = (xs: readonly number[]): number => {
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? (s[mid] ?? 0) : ((s[mid - 1] ?? 0) + (s[mid] ?? 0)) / 2;
};

/** Compares the median of several runs of one profile with the plan bands. */
export function compareToPlan(
  profile: SimProfile['id'],
  runs: readonly (readonly HourSample[])[],
): PlanCheck[] {
  const out: PlanCheck[] = [];
  for (const band of PLAN_BANDS) {
    const at = runs
      .map((r) => r.find((s) => s.hour === band.hour))
      .filter((s): s is HourSample => !!s);
    if (at.length === 0) continue;
    const check = (metric: PlanCheck['metric'], value: number, b: [number, number]) =>
      out.push({ hour: band.hour, metric, value, band: b, ok: value >= b[0] && value <= b[1] });
    check('revelation', median(at.map((s) => s.revelation)), band.revelation);
    check('power', median(at.map((s) => s.power)), band.power);
    check(
      'debt',
      median(at.map((s) => s.debt)),
      profile === 'dark' ? band.debtDark : band.debtOther,
    );
  }
  return out;
}
