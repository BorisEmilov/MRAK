/**
 * The exorcism (docs/systems/exorcism.md → Implementation): preparation, confrontation (the
 * demon taunts with real facts of the playthrough), naming, and the expulsion — a test of
 * endurance paid in Sanity. Failure lets the demon jump; binding ends it with a debt.
 */
import type { ContentDatabase } from '../content/database';
import { event, type CoreEvent } from '../events';
import { resolveCheck, type Difficulty } from '../guardian/checks';
import { progressionRules } from '../guardian/rules';
import { itemCount, takeItem } from '../items/inventory';
import { getStat, setStat } from '../state/stats';
import type { ExorcismPhase, WorldState } from '../state/world-state';
import { livingVillagers } from '../village/common';
import { FearRuleError, type FearContext, type ReadState } from '../fear/common';
import { changeSanity, sanityRatio } from '../fear/sanity';
import { trueNameProgress } from './possession';

const STEPS: readonly Difficulty[] = ['easy', 'average', 'hard', 'daunting', 'dire'];

export interface Taunt {
  key: string;
  params: Record<string, string>;
}

/**
 * What the demon throws at the guardian: facts taken from the WorldState — pacts signed,
 * sacrifices made, the dead, the lynched, debts owed. One of each kind first, newest first.
 */
export function tauntsFor(
  state: ReadState,
  db: ContentDatabase,
  demon: string,
  max: number,
): Taunt[] {
  const t = db.get('demons', demon).taunts;
  const kinds: Taunt[][] = [
    Object.keys(state.pacts)
      .reverse()
      .map((id) => ({ key: t.pact, params: { pact: db.get('pacts', id).nameKey } })),
    state.decisions
      .filter((d) => d.id === 'sacrifice')
      .reverse()
      .map(() => ({ key: t.sacrifice, params: {} })),
    state.hysteria.trials
      .filter((x) => x.verdict === 'lynched' && x.target !== 'guardian')
      .reverse()
      .map((x) => ({ key: t.lynching, params: { name: db.get('villagers', x.target).nameKey } })),
    Object.entries(state.villagers)
      .filter(([id, v]) => !v.alive && v.death?.cause !== 'lynching' && db.has('villagers', id))
      .sort(([, a], [, b]) => (b.death?.day ?? 0) - (a.death?.day ?? 0))
      .map(([id]) => ({ key: t.death, params: { name: db.get('villagers', id).nameKey } })),
    state.debt.entries
      .slice()
      .reverse()
      .map((e) => ({ key: t.debt, params: { debt: db.get('debt-sources', e.source).nameKey } })),
  ];
  const out: Taunt[] = [];
  for (let round = 0; out.length < max && kinds.some((k) => k.length > round); round++)
    for (const k of kinds) {
      const taunt = k[round];
      if (taunt && out.length < max) out.push(taunt);
    }
  return out;
}

function possessionOf(
  state: WorldState,
  host: string,
): WorldState['possessions'][number] | undefined {
  return state.possessions.find((p) => p.host === host);
}

function requireRite(draft: WorldState, phase: ExorcismPhase) {
  const rite = draft.exorcism;
  if (!rite) throw new FearRuleError('no rite in progress');
  if (rite.phase !== phase) throw new FearRuleError(`the rite is not at ${phase}`);
  return rite;
}

export function startExorcism(draft: WorldState, host: string): CoreEvent[] {
  if (draft.exorcism) throw new FearRuleError('a rite is already in progress');
  if (draft.villagers[host]?.alive !== true) throw new FearRuleError('no such villager');
  draft.exorcism = { host, phase: 'preparation', prepared: [], taunts: [], progress: 0, round: 0 };
  return [
    event('exorcism/started', { host }),
    event('exorcism/phaseChanged', { phase: 'preparation' }),
  ];
}

/** Lays out an item (consumed): holy items, the salt circle, the demon's weaknesses. */
export function prepareItem(draft: WorldState, ctx: FearContext, item: string): CoreEvent[] {
  const rite = requireRite(draft, 'preparation');
  const prep = ctx.rules.exorcism.preparation;
  if (rite.prepared.length >= prep.maxItems) throw new FearRuleError('the altar is full');
  if (rite.prepared.includes(item)) throw new FearRuleError('already laid out');
  if (itemCount(draft, item, 'pack') === 0) throw new FearRuleError('not in the pack');
  takeItem(draft, ctx.db, item, 1, 'pack');
  rite.prepared.push(item);
  return [event('inventory/itemRemoved', { item, qty: 1 }), event('exorcism/prepared', { item })];
}

/** Difficulty steps the preparation removes: holy items, the salt circle, the demon's weaknesses. */
export function preparationBonus(
  db: ContentDatabase,
  ctx: Pick<FearContext, 'rules'>,
  prepared: readonly string[],
  demon: string | null,
): number {
  const prep = ctx.rules.exorcism.preparation;
  const weak = demon
    ? db.get('demons', demon).weaknesses.flatMap((w) => (w.item ? [w.item] : []))
    : [];
  let bonus = 0;
  if (prepared.some((i) => db.get('items', i).tags.includes(prep.holyTag))) bonus += 1;
  if (prepared.includes(prep.circleItem)) bonus += 1;
  if (prepared.some((i) => weak.includes(i))) bonus += 1;
  return bonus;
}

function check(
  draft: WorldState,
  ctx: FearContext,
  rank: number,
  bonus: number,
): { success: boolean; events: CoreEvent[] } {
  const prules = progressionRules(ctx.db);
  if (!prules || draft.guardian.callingId === null)
    throw new FearRuleError('the guardian cannot make checks yet');
  const ex = ctx.rules.exorcism;
  const step = STEPS.indexOf(ex.difficulty) + (rank - 1) - bonus;
  const difficulty = STEPS[Math.min(STEPS.length - 1, Math.max(0, step))] ?? 'average';
  const r = resolveCheck(
    draft,
    ctx.db,
    prules,
    { skill: ex.skill, difficulty, context: ex.context },
    ctx.random('director'),
  );
  return { success: r.result.success, events: [...r.events, ...ctx.apply(r.effects, 'exorcism')] };
}

/** Confrontation: the demon taunts (each taunt costs Sanity), then the will is tested. */
export function confront(draft: WorldState, ctx: FearContext): CoreEvent[] {
  const rite = requireRite(draft, 'preparation');
  const possession = possessionOf(draft, rite.host);
  if (!possession) {
    draft.exorcism = null;
    return [event('exorcism/empty', { host: rite.host })];
  }
  const ex = ctx.rules.exorcism;
  const demon = ctx.db.get('demons', possession.demon);
  rite.phase = 'confrontation';
  const out: CoreEvent[] = [event('exorcism/phaseChanged', { phase: 'confrontation' })];
  rite.taunts = tauntsFor(draft, ctx.db, demon.id, ex.maxTaunts);
  for (const taunt of rite.taunts) {
    out.push(event('exorcism/taunted', taunt));
    out.push(...changeSanity(draft, ctx.db, -ex.sanityPerTaunt));
  }
  const result = check(
    draft,
    ctx,
    demon.rank,
    preparationBonus(ctx.db, ctx, rite.prepared, demon.id),
  );
  out.push(...result.events);
  if (!result.success) return [...out, ...fail(draft, ctx)];
  rite.phase = 'naming';
  out.push(event('exorcism/phaseChanged', { phase: 'naming' }));
  return out;
}

/** Naming: the guardian speaks a true name they have composed. The wrong one fails the rite. */
export function speakName(
  draft: WorldState,
  ctx: FearContext,
  demon: string,
  bind: boolean,
): CoreEvent[] {
  const rite = requireRite(draft, 'naming');
  if (!trueNameProgress(draft, ctx.db, demon).known)
    throw new FearRuleError('you do not know that name');
  const possession = possessionOf(draft, rite.host);
  if (!possession || possession.demon !== demon) return fail(draft, ctx);
  if (bind) {
    draft.possessions = draft.possessions.filter((p) => p !== possession);
    draft.exorcism = null;
    if (!draft.journal.learned.includes(`bound:${demon}`))
      draft.journal.learned.push(`bound:${demon}`);
    return [
      event('possession/ended', { demon, host: rite.host, how: 'bound' }),
      event('exorcism/bound', { host: rite.host }),
      ...ctx.apply([{ addDebt: ctx.rules.exorcism.bindDebt }], `bound:${demon}`),
    ];
  }
  rite.phase = 'expulsion';
  return [event('exorcism/phaseChanged', { phase: 'expulsion' })];
}

/** Expulsion round: press (fast, costly) or hold (slow, cheap) against the demon's push. */
export function expel(draft: WorldState, ctx: FearContext, effort: 'press' | 'hold'): CoreEvent[] {
  const rite = requireRite(draft, 'expulsion');
  const possession = possessionOf(draft, rite.host);
  if (!possession) return fail(draft, ctx);
  const x = ctx.rules.exorcism.expulsion;
  const rank = ctx.db.get('demons', possession.demon).rank;
  const push = rank * x.pushPerRank * (0.5 + ctx.random('director').next());
  rite.round += 1;
  rite.progress = Math.max(0, rite.progress + x[effort].progress - push);
  const out: CoreEvent[] = [
    ...changeSanity(draft, ctx.db, -x[effort].sanity),
    event('exorcism/round', { round: rite.round, progress: rite.progress }),
  ];
  if (rite.progress >= x.goal) {
    draft.possessions = draft.possessions.filter((p) => p !== possession);
    draft.exorcism = null;
    const fear = getStat(draft, ctx.db, 'fear', rite.host);
    setStat(draft, ctx.db, 'fear', fear - ctx.rules.exorcism.success.hostFear, rite.host);
    return [
      ...out,
      event('possession/ended', { demon: possession.demon, host: rite.host, how: 'cast-out' }),
      event('exorcism/succeeded', { host: rite.host }),
    ];
  }
  if (sanityRatio(draft, ctx.db) < x.breakBelow || rite.round >= x.rounds)
    return [...out, ...fail(draft, ctx)];
  return out;
}

/** Abandoning the rite is a failure. */
export function abandon(draft: WorldState, ctx: FearContext): CoreEvent[] {
  if (!draft.exorcism) throw new FearRuleError('no rite in progress');
  return fail(draft, ctx);
}

/** The rite fails: the demon jumps to the most frightened villager nearby — or to the guardian. */
function fail(draft: WorldState, ctx: FearContext): CoreEvent[] {
  const rite = draft.exorcism;
  draft.exorcism = null;
  if (!rite) return [];
  const out: CoreEvent[] = [event('exorcism/failed', { host: rite.host })];
  out.push(...changeSanity(draft, ctx.db, -ctx.rules.exorcism.failure.sanity));
  const possession = possessionOf(draft, rite.host);
  if (!possession) return out;
  const rng = ctx.random('director');
  const others = livingVillagers(draft, ctx.db)
    .filter((v) => v.id !== rite.host && !draft.possessions.some((p) => p.host === v.id))
    .sort((a, b) => getStat(draft, ctx.db, 'fear', b.id) - getStat(draft, ctx.db, 'fear', a.id));
  const toGuardian =
    others.length === 0 || rng.next() < ctx.rules.exorcism.failure.guardianJumpChance;
  const to = toGuardian ? 'guardian' : (others[0]?.id ?? 'guardian');
  possession.host = to;
  possession.stage = 1;
  out.push(event('exorcism/demonJumped', { to }));
  return out;
}
