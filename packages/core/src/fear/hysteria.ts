/**
 * Hysteria and witch hunts (docs/systems/hysteria.md → Implementation): rumours, accusations,
 * mobs, improvised trials and lynchings. The guardian can calm, steer or exploit a mob — and can
 * be its target.
 */
import type { FearRules } from '@mrak/content-schema';
import type { Difficulty } from '../guardian/checks';
import type { ContentDatabase } from '../content/database';
import { event, type CoreEvent, type GameTime } from '../events';
import { resolveCheck } from '../guardian/checks';
import { progressionRules } from '../guardian/rules';
import { getStat, setStat } from '../state/stats';
import type { WorldState } from '../state/world-state';
import { livingVillagers } from '../village/common';
import { killVillager } from '../village/death';
import { FearRuleError, weightedIndex, type FearContext, type ReadState } from './common';
import { atHome } from './sanity';

export const GUARDIAN = 'guardian';
export type HysteriaStage = 'calm' | 'rumours' | 'accusations' | 'mob';
export type MobApproach = 'calm' | 'steer' | 'exploit';

const DIFFICULTIES: readonly Difficulty[] = ['easy', 'average', 'hard', 'daunting', 'dire'];

export function hysteriaStage(value: number, rules: FearRules): HysteriaStage {
  const s = rules.hysteria.stages;
  return value >= s.mob
    ? 'mob'
    : value >= s.accusations
      ? 'accusations'
      : value >= s.rumours
        ? 'rumours'
        : 'calm';
}

export function hysteriaOf(state: ReadState, db: ContentDatabase): number {
  return db.hasStat('hysteria') ? getStat(state, db, 'hysteria') : 0;
}

/** 100 − weighted mean of villager fear (children weigh 1.5). */
export function villageSanity(state: ReadState, db: ContentDatabase): number {
  let sum = 0;
  let weight = 0;
  for (const v of livingVillagers(state, db)) {
    const w = v.age < 14 ? 1.5 : 1;
    sum += getStat(state, db, 'fear', v.id) * w;
    weight += w;
  }
  return weight === 0 ? 100 : 100 - sum / weight;
}

function setHysteria(draft: WorldState, db: ContentDatabase, value: number): CoreEvent[] {
  if (!db.hasStat('hysteria')) return [];
  const [from, to] = setStat(draft, db, 'hysteria', value);
  return from === to ? [] : [event('state/statChanged', { stat: 'hysteria', from, to })];
}

/** Adds hysteria; gains are scaled by `hysteria-gain-rate` and a frightened village. */
export function addHysteria(
  draft: WorldState,
  db: ContentDatabase,
  rules: FearRules,
  amount: number,
): CoreEvent[] {
  let value = amount;
  if (amount > 0) {
    if (db.hasStat('hysteria-gain-rate')) value *= getStat(draft, db, 'hysteria-gain-rate');
    const low = rules.hysteria.lowVillageSanity;
    if (villageSanity(draft, db) < low.below) value *= low.factor;
    draft.hysteria.incident = true;
  }
  return setHysteria(draft, db, hysteriaOf(draft, db) + value);
}

function suspicionOf(
  state: ReadState,
  db: ContentDatabase,
  rules: FearRules,
  target: string,
): number {
  const h = rules.hysteria;
  if (target === GUARDIAN)
    return db.hasStat(h.guardianStat) ? getStat(state, db, h.guardianStat) : 0;
  return getStat(state, db, h.suspicionStat, target);
}

function addSuspicion(
  draft: WorldState,
  db: ContentDatabase,
  rules: FearRules,
  target: string,
  amount: number,
): CoreEvent[] {
  const h = rules.hysteria;
  if (target === GUARDIAN) {
    if (!db.hasStat(h.guardianStat)) return [];
    const [from, to] = setStat(
      draft,
      db,
      h.guardianStat,
      getStat(draft, db, h.guardianStat) + amount,
    );
    return from === to ? [] : [event('state/statChanged', { stat: h.guardianStat, from, to })];
  }
  const [from, to] = setStat(
    draft,
    db,
    h.suspicionStat,
    getStat(draft, db, h.suspicionStat, target) + amount,
    target,
  );
  return from === to
    ? []
    : [event('state/statChanged', { stat: h.suspicionStat, villager: target, from, to })];
}

/** Rumour weight: the product of trait multipliers (the "odd" draw rumours). */
function rumourWeight(db: ContentDatabase, rules: FearRules, target: string): number {
  const h = rules.hysteria;
  if (target === GUARDIAN) return h.guardianRumourWeight;
  const v = db.get('villagers', target);
  return v.traits.reduce((w, t) => w * (h.traitMultipliers[t] ?? 1), 1);
}

function suspects(draft: ReadState, db: ContentDatabase): string[] {
  return [...livingVillagers(draft, db).map((v) => v.id), GUARDIAN];
}

/** The most suspected (the guardian only from `guardianAccusableAt`); ties keep content order. */
function mostSuspected(draft: WorldState, ctx: FearContext): string | null {
  const { db, rules } = ctx;
  let best: string | null = null;
  let top = 0;
  for (const id of suspects(draft, db)) {
    const s = suspicionOf(draft, db, rules, id);
    if (id === GUARDIAN && s < rules.hysteria.guardianAccusableAt) continue;
    if (s > top) {
      top = s;
      best = id;
    }
  }
  if (best !== null) return best;
  // Nobody is suspected yet: the crowd picks the odd one out.
  const ids = suspects(draft, db).filter((id) => id !== GUARDIAN);
  const i = weightedIndex(
    ids.map((id) => rumourWeight(db, rules, id)),
    ctx.random('villagers'),
  );
  return ids[i] ?? null;
}

/** Event-driven gains: deaths, a broken guardian; a mob whose target died disperses. */
export function hysteriaAfter(
  draft: WorldState,
  ctx: FearContext,
  events: readonly CoreEvent[],
): CoreEvent[] {
  const { db, rules } = ctx;
  const h = rules.hysteria;
  const out: CoreEvent[] = [];
  for (const e of events) {
    if (e.type === 'villager/died') {
      if (e.payload.cause !== h.lynching.cause)
        out.push(...addHysteria(draft, db, rules, h.incidents.death));
      const mob = draft.hysteria.mob;
      if (mob?.target === e.payload.villager) {
        draft.hysteria.mob = null;
        out.push(...setHysteria(draft, db, hysteriaOf(draft, db) - h.mob.targetDiedRelief));
        out.push(event('hysteria/mobDispersed', { target: mob.target, reason: 'target-died' }));
      }
    } else if (e.type === 'sanity/broken') {
      out.push(...addSuspicion(draft, db, rules, GUARDIAN, h.guardianSuspicion.broken));
    } else if (
      e.type === 'state/statChanged' &&
      e.payload.stat === 'hysteria' &&
      e.payload.to > e.payload.from
    ) {
      draft.hysteria.incident = true;
    }
  }
  return out;
}

/** Dawn: the guardian's absence is noticed, a standing mob holds its trial, then the stage acts. */
export function hysteriaAtDawn(draft: WorldState, ctx: FearContext, now: GameTime): CoreEvent[] {
  const { db, rules } = ctx;
  const h = rules.hysteria;
  const out: CoreEvent[] = [];
  if (!atHome(draft, rules)) {
    out.push(...addSuspicion(draft, db, rules, GUARDIAN, h.guardianSuspicion.absentAtDawn));
    out.push(...addHysteria(draft, db, rules, h.incidents.absentAtDawn));
  }
  const mob = draft.hysteria.mob;
  if (mob && mob.formedDay < now.day) out.push(...holdTrial(draft, ctx, now));
  if (!draft.hysteria.incident)
    out.push(...setHysteria(draft, db, hysteriaOf(draft, db) - h.decayPerDawn));
  draft.hysteria.incident = false;

  const stage = hysteriaStage(hysteriaOf(draft, db), rules);
  const rng = ctx.random('villagers');
  if (stage === 'rumours') {
    const ids = suspects(draft, db);
    const target =
      ids[
        weightedIndex(
          ids.map((id) => rumourWeight(db, rules, id)),
          rng,
        )
      ];
    if (target !== undefined) {
      out.push(
        ...addSuspicion(
          draft,
          db,
          rules,
          target,
          h.rumourStrength * rumourWeight(db, rules, target),
        ),
      );
      out.push(event('hysteria/rumourSpread', { target }));
    }
  } else if (stage === 'accusations') {
    const target = mostSuspected(draft, ctx);
    if (target !== null) {
      out.push(...addSuspicion(draft, db, rules, target, h.accusationSuspicion));
      draft.hysteria.accusations.push({ day: now.day, target });
      if (draft.hysteria.accusations.length > 200) draft.hysteria.accusations.shift();
      out.push(event('hysteria/accusationMade', { target }));
    }
  } else if (stage === 'mob' && !draft.hysteria.mob) {
    const target = mostSuspected(draft, ctx);
    if (target !== null) {
      const size = livingVillagers(draft, db).filter(
        (v) => v.id !== target && getStat(draft, db, 'fear', v.id) >= h.mob.joinFear,
      ).length;
      draft.hysteria.mob = {
        target,
        size: Math.max(2, size),
        formedDay: now.day,
        confronted: false,
        complicit: false,
      };
      out.push(event('hysteria/mobFormed', { target, size: Math.max(2, size) }));
    }
  }
  return out;
}

/** The improvised trial: the crowd's verdict follows the hysteria. */
function holdTrial(draft: WorldState, ctx: FearContext, now: GameTime): CoreEvent[] {
  const { db, rules } = ctx;
  const h = rules.hysteria;
  const mob = draft.hysteria.mob;
  if (!mob) return [];
  draft.hysteria.mob = null;
  const level = hysteriaOf(draft, db);
  const verdict = level >= h.mob.lynchAt ? 'lynched' : level >= h.mob.beatAt ? 'beaten' : 'spared';
  const out: CoreEvent[] = [];
  let innocent = true;

  if (mob.target === GUARDIAN) {
    // The guardian is never killed by the crowd: the worst is a beating.
    if (verdict !== 'spared') out.push(...ctx.apply(h.mob.guardianBeatenEffects, 'mob'));
  } else if (verdict === 'lynched') {
    const possession = draft.possessions.find((p) => p.host === mob.target);
    innocent = possession === undefined;
    out.push(...killVillager(draft, db, mob.target, h.lynching.cause, now));
    out.push(event('hysteria/lynching', { victim: mob.target, innocent }));
    if (innocent) {
      out.push(...ctx.apply(h.lynching.innocentEffects, 'lynching'));
      if (mob.complicit) out.push(...ctx.apply(h.lynching.complicitEffects, 'lynching'));
    } else if (possession) {
      // Killing the host frees the demon into someone else (not a win).
      draft.possessions = draft.possessions.filter((p) => p !== possession);
      const hosts = livingVillagers(draft, db).filter(
        (v) => !draft.possessions.some((p) => p.host === v.id),
      );
      const host = hosts[ctx.random('villagers').int(0, Math.max(0, hosts.length - 1))];
      if (host) {
        draft.possessions.push({
          demon: possession.demon,
          host: host.id,
          stage: 1,
          revealed: false,
        });
        out.push(event('possession/began', { demon: possession.demon, host: host.id }));
      }
    }
    out.push(...setHysteria(draft, db, hysteriaOf(draft, db) - h.lynching.aftermathRelief));
    out.push(...addSuspicion(draft, db, rules, mob.target, -100));
  } else {
    if (verdict === 'beaten') {
      setStat(
        draft,
        db,
        'fear',
        getStat(draft, db, 'fear', mob.target) + h.mob.beaten.fear,
        mob.target,
      );
      if (db.hasStat('health'))
        setStat(
          draft,
          db,
          'health',
          getStat(draft, db, 'health', mob.target) - h.mob.beaten.health,
          mob.target,
        );
    }
    out.push(...setHysteria(draft, db, hysteriaOf(draft, db) - h.mob.sparedRelief));
    out.push(
      ...addSuspicion(draft, db, rules, mob.target, -suspicionOf(draft, db, rules, mob.target) / 2),
    );
  }
  draft.hysteria.trials.push({ day: now.day, target: mob.target, verdict, innocent });
  if (draft.hysteria.trials.length > 200) draft.hysteria.trials.shift();
  out.push(event('hysteria/trialHeld', { target: mob.target, verdict }));
  return out;
}

/** A clue the guardian holds that refutes the mob's accusation. */
function hasRefutingClue(draft: ReadState, db: ContentDatabase, target: string): boolean {
  const claim = `culprit:${target}`;
  return db
    .all('mysteries')
    .some((m) =>
      m.clues.some(
        (c) => c.refutes.includes(claim) && draft.mysteries[m.id]?.clues.includes(c.id) === true,
      ),
    );
}

/** Difficulty of facing the mob: + 1 step per 10 hysteria above the mob stage, − 1 with a clue. */
export function mobDifficulty(
  draft: ReadState,
  db: ContentDatabase,
  rules: FearRules,
  target: string,
): Difficulty {
  const h = rules.hysteria;
  const above = Math.max(0, hysteriaOf(draft, db) - h.stages.mob);
  let step = DIFFICULTIES.indexOf(h.mob.difficulty) + Math.floor(above / 10);
  if (hasRefutingClue(draft, db, target)) step -= 1;
  return DIFFICULTIES[Math.min(DIFFICULTIES.length - 1, Math.max(0, step))] ?? 'average';
}

/** The guardian confronts the mob: calm it, steer it to someone else, or exploit it. */
export function confrontMob(
  draft: WorldState,
  ctx: FearContext,
  approach: MobApproach,
  now: GameTime,
  newTarget?: string,
): CoreEvent[] {
  const { db, rules } = ctx;
  const h = rules.hysteria;
  const mob = draft.hysteria.mob;
  if (!mob) throw new FearRuleError('there is no mob');
  if (mob.confronted) throw new FearRuleError('the crowd will not listen again');
  if (!atHome(draft, rules)) throw new FearRuleError('the mob is in the village');

  if (approach === 'exploit') {
    if (mob.target === GUARDIAN) throw new FearRuleError('the mob wants you');
    mob.complicit = true;
    return [...ctx.apply(h.mob.exploitEffects, 'mob'), ...holdTrial(draft, ctx, now)];
  }
  if (approach === 'steer') {
    if (newTarget === undefined || newTarget === GUARDIAN || newTarget === mob.target)
      throw new FearRuleError('steer the mob toward someone else');
    if (draft.villagers[newTarget]?.alive !== true) throw new FearRuleError('no such villager');
  }
  const prules = progressionRules(db);
  if (!prules || draft.guardian.callingId === null)
    throw new FearRuleError('the guardian cannot make checks yet');
  const check = resolveCheck(
    draft,
    db,
    prules,
    {
      skill: h.mob.skill,
      difficulty: mobDifficulty(draft, db, rules, mob.target),
      context: h.mob.context,
      target: mob.target,
    },
    ctx.random('director'),
  );
  const out: CoreEvent[] = [...check.events, ...ctx.apply(check.effects, 'mob')];
  mob.confronted = true;
  if (!check.result.success) {
    out.push(...addSuspicion(draft, db, rules, GUARDIAN, h.guardianSuspicion.failedConfrontation));
    return out;
  }
  if (approach === 'calm') {
    draft.hysteria.mob = null;
    out.push(...setHysteria(draft, db, hysteriaOf(draft, db) - h.mob.calmRelief));
    out.push(event('hysteria/mobDispersed', { target: mob.target, reason: 'calmed' }));
  } else if (newTarget !== undefined) {
    const from = mob.target;
    mob.target = newTarget;
    mob.complicit = true;
    out.push(...addSuspicion(draft, db, rules, newTarget, h.accusationSuspicion));
    out.push(event('hysteria/mobSteered', { from, to: newTarget }));
  }
  return out;
}
