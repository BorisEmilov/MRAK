/**
 * The event director (docs/systems/event-director.md → Implementation): an "AI director" that
 * paces dread over the night — settle, build, peak around 03:33, release — and mixes noise,
 * mystery seeds and hallucinations that look exactly alike. Every tick leaves a decision in
 * `director.log` for the debug console.
 */
import type { DirectorEvent, EvidenceMethod, FearRules, PacingPhase } from '@mrak/content-schema';
import type { ContentDatabase } from '../content/database';
import { event, type CoreEvent } from '../events';
import { directorWeight } from '../guardian/journal';
import { progressionRules } from '../guardian/rules';
import { itemCount, takeItem } from '../items/inventory';
import { itemRules } from '../items/rules';
import { effectiveStat } from '../state/stats';
import type { DirectorDecision, Occurrence, WorldState } from '../state/world-state';
import { festivalsOn, jdnToJulian, seasonOf } from '../time/calendar';
import { evaluatorAt, possessedHidden } from '../village/common';
import {
  clock,
  FearRuleError,
  inWindow,
  isNightAt,
  nightOf,
  toTime,
  weightedIndex,
  type FearContext,
  type ReadState,
} from './common';
import { hysteriaOf } from './hysteria';
import { sanityRatio } from './sanity';
import { corruptionAspect } from '../occult/pacts';

export type DirectedCategory = 'noise' | 'seed' | 'hallucination';
const CATEGORIES: readonly DirectedCategory[] = ['noise', 'seed', 'hallucination'];

/** Pacing phase and target tension at an absolute minute of the night. */
export function pacingAt(a: number, rules: FearRules): { phase: PacingPhase; target: number } {
  const d = rules.director;
  const night = nightOf(a);
  const elapsed = a - night.start;
  const peak = (clock(d.peakAround) - (night.start % 1440) + 1440) % 1440;
  const settleEnd = night.length * d.settleShare;
  const peakStart = peak - d.peakHalfWidth;
  if (Math.abs(elapsed - peak) <= d.peakHalfWidth) return { phase: 'peak', target: d.targets.peak };
  if (elapsed > peak) return { phase: 'release', target: d.targets.release };
  if (elapsed < settleEnd) return { phase: 'settle', target: d.targets.settle };
  const t = peakStart > settleEnd ? (elapsed - settleEnd) / (peakStart - settleEnd) : 1;
  return {
    phase: 'build',
    target: d.targets.buildFrom + (d.targets.buildTo - d.targets.buildFrom) * t,
  };
}

/** Category shares now: hallucinations grow as Sanity falls (sanity.md formula). */
export function categoryShares(
  state: ReadState,
  db: ContentDatabase,
  rules: FearRules,
): Record<DirectedCategory, number> {
  const { mix, hallucination: h } = rules.director;
  const sanity = db.hasStat('sanity') ? effectiveStat(state, db, 'sanity') : 100;
  // Low Sanity and a corrupted soul both let the lies in.
  const hall = Math.min(
    h.max,
    h.base + Math.max(0, (h.pivot - sanity) / 100) + h.perCorruption * corruptionAspect(state, db),
  );
  const rest = mix.noise + mix.seed;
  return {
    noise: rest > 0 ? ((1 - hall) * mix.noise) / rest : 0,
    seed: rest > 0 ? ((1 - hall) * mix.seed) / rest : 0,
    hallucination: hall,
  };
}

/** Weight of an event now, with the factors that shaped it (for the debug log). */
export function eventWeight(
  state: ReadState,
  db: ContentDatabase,
  rules: FearRules,
  e: DirectorEvent,
  a: number,
): { weight: number; factors: Record<string, number> } {
  const d = rules.director;
  const t = toTime(a);
  const bias = e.bias ?? {};
  const factors: Record<string, number> = { base: e.weight };
  factors['season'] = bias.seasons?.[seasonOf(jdnToJulian(t.day).month)] ?? 1;
  factors['hour'] = bias.hours?.find((h) => inWindow(t.minute, h.from, h.to))?.factor ?? 1;
  factors['zone'] =
    e.zone === undefined ? 1 : e.zone === state.currentZone ? d.zoneFactor : d.offZoneFactor;
  const corruption = Math.max(
    db.hasStat('corruption') ? effectiveStat(state, db, 'corruption') : 0,
    db.hasStat('village-corruption') ? effectiveStat(state, db, 'village-corruption') : 0,
  );
  factors['corruption'] = Math.max(0, 1 + (bias.corruption ?? 0) * (corruption / 100));
  factors['hysteria'] = Math.max(0, 1 + (bias.hysteria ?? 0) * (hysteriaOf(state, db) / 100));
  factors['sanity'] = Math.max(
    0,
    1 + (bias.lowSanity ?? 0) * (1 - Math.min(1, sanityRatio(state, db))),
  );
  const prules = progressionRules(db);
  factors['notice'] =
    e.target === 'guardian' && prules && db.hasStat('notice')
      ? directorWeight(state, db, prules)
      : 1;
  const weight = Object.values(factors).reduce((p, f) => p * f, 1);
  return { weight, factors };
}

function log(draft: WorldState, rules: FearRules, decision: DirectorDecision): void {
  const { logSize } = rules.director;
  if (logSize === 0) return;
  draft.director.log.push(decision);
  while (draft.director.log.length > logSize) draft.director.log.shift();
}

/**
 * One director tick at absolute minute `a` (`witching`: the 03:33 moment, which only considers
 * windowed events). Never forces an event: no candidate ⇒ nothing happens.
 */
export function directorTick(
  draft: WorldState,
  ctx: FearContext,
  a: number,
  witching: boolean,
): CoreEvent[] {
  if (!isNightAt(a)) return [];
  const { db, rules } = ctx;
  const d = rules.director;
  const dir = draft.director;
  const night = nightOf(a);
  if (dir.night !== night.day) {
    dir.night = night.day;
    dir.spent = {};
    dir.tension = Math.round(dir.tension * 50) / 100;
  }
  dir.recent = dir.recent.filter((r) => a - r < 60);
  const { phase, target } = pacingAt(a, rules);
  if (!witching) dir.tension = Math.max(0, dir.tension - d.decayPerTick[phase]);
  const shares = categoryShares(draft, db, rules);
  const base = {
    at: a,
    night: night.day,
    phase,
    target: Math.round(target * 10) / 10,
    tension: dir.tension,
    shares,
  };

  if (dir.quietUntil !== null && a < dir.quietUntil) {
    if (!witching)
      log(draft, rules, {
        ...base,
        p: 0,
        roll: null,
        outcome: 'quiet',
        event: null,
        category: null,
        candidates: 0,
        factors: {},
      });
    return [];
  }

  const chapter = festivalChapter(db, night.day);
  const intensity = chapter !== null ? (d.budget.chapterIntensity[chapter] ?? 1) : 1;
  const left = d.budget.perNight * intensity * d.budget.shares[phase] - (dir.spent[phase] ?? 0);
  const t = toTime(a);
  const holds = evaluatorAt(draft, db, t.day, t.minute);
  const candidates = db.all('events').filter((e) => {
    if (e.category === 'set-piece') return false;
    if (
      witching
        ? !e.window || !inWindow(t.minute, e.window.from, e.window.to)
        : e.window && !inWindow(t.minute, e.window.from, e.window.to)
    )
      return false;
    if ((dir.cooldowns[e.id] ?? -Infinity) > a) return false;
    if (!witching && e.tensionCost > left) return false;
    return e.conditions === undefined || holds(e.conditions);
  });
  if (witching && candidates.length === 0) return [];

  const rng = ctx.random('director');
  const f = d.fire;
  const p = witching
    ? 1
    : Math.min(
        f.max,
        Math.max(
          f.min,
          f.base + (target - dir.tension) / f.tensionDivisor - f.recentPenalty * dir.recent.length,
        ),
      );
  const roll = witching ? null : rng.next();
  if (roll !== null && roll >= p) {
    log(draft, rules, {
      ...base,
      p,
      roll,
      outcome: 'held',
      event: null,
      category: null,
      candidates: candidates.length,
      factors: {},
    });
    return [];
  }
  if (candidates.length === 0) {
    log(draft, rules, {
      ...base,
      p,
      roll,
      outcome: 'no-candidates',
      event: null,
      category: null,
      candidates: 0,
      factors: {},
    });
    return [];
  }

  const present = CATEGORIES.filter((c) => candidates.some((e) => e.category === c));
  const category =
    present[
      weightedIndex(
        present.map((c) => shares[c]),
        rng,
      )
    ] ?? present[0];
  const pool = candidates.filter((e) => e.category === category);
  const weighed = pool.map((e) => eventWeight(draft, db, rules, e, a));
  const index = weightedIndex(
    weighed.map((w) => w.weight),
    rng,
  );
  const chosen = pool[index];
  if (!chosen || category === undefined) {
    log(draft, rules, {
      ...base,
      p,
      roll,
      outcome: 'no-candidates',
      event: null,
      category: null,
      candidates: candidates.length,
      factors: {},
    });
    return [];
  }
  return fire(draft, ctx, chosen, a, phase, (decision) => {
    log(draft, rules, {
      ...base,
      p,
      roll,
      outcome: 'fired',
      event: chosen.id,
      category,
      candidates: candidates.length,
      factors: weighed[index]?.factors ?? {},
      ...decision,
    });
  });
}

function festivalChapter(db: ContentDatabase, day: number): string | null {
  return festivalsOn(db.all('festivals'), day)[0]?.festival.id ?? null;
}

function fire(
  draft: WorldState,
  ctx: FearContext,
  e: DirectorEvent,
  a: number,
  phase: PacingPhase,
  record: (decision: Partial<DirectorDecision>) => void,
): CoreEvent[] {
  const { rules } = ctx;
  const d = rules.director;
  const dir = draft.director;
  const id = dir.nextOccurrence;
  dir.nextOccurrence += 1;
  dir.occurrences.push({
    id,
    event: e.id,
    at: a,
    zone: e.zone ?? draft.currentZone,
    hallucination: e.category === 'hallucination',
    examined: [],
  });
  while (dir.occurrences.length > 100) dir.occurrences.shift();
  dir.cooldowns[e.id] = a + e.cooldownMinutes;
  dir.spent[phase] = (dir.spent[phase] ?? 0) + e.tensionCost;
  dir.recent.push(a);
  dir.tension = Math.min(100, dir.tension + e.tensionCost);
  record({ tension: dir.tension });
  const out: CoreEvent[] = [
    event('director/eventFired', { event: e.id, occurrence: id, zone: e.zone ?? null }),
    ...ctx.apply(e.effects, e.id),
  ];
  if (e.tensionCost >= d.peakCost) {
    dir.quietUntil = a + ctx.random('director').int(d.quiet.min, d.quiet.max);
    out.push(event('director/peakReached', { event: e.id, tension: dir.tension }));
  }
  return out;
}

export interface ExamineRequest {
  occurrence: number;
  method: EvidenceMethod;
  villager?: string | undefined;
  item?: string | undefined;
}

/**
 * Tests an occurrence for evidence. The answer is probabilistic — "something was there" or
 * "nothing" — and never the label (sanity.md rule 4).
 */
export function examineOccurrence(
  draft: WorldState,
  ctx: FearContext,
  req: ExamineRequest,
  now: number,
): CoreEvent[] {
  const { db, rules } = ctx;
  const ev = rules.evidence;
  const occ: Occurrence | undefined = draft.director.occurrences.find(
    (o) => o.id === req.occurrence,
  );
  if (!occ) throw new FearRuleError('no such occurrence');
  if (now - occ.at > ev.windowMinutes) throw new FearRuleError('too long ago to examine');
  if (occ.examined.includes(req.method)) throw new FearRuleError('already examined that way');
  const out: CoreEvent[] = [];
  let odds = ev[req.method];
  let lies = false;
  if (req.method === 'photograph') {
    const photo = itemRules(db)?.photography;
    if (!photo) throw new FearRuleError('this content has no photography');
    if (itemCount(draft, photo.camera, 'pack') === 0) throw new FearRuleError('no camera');
    if (itemCount(draft, photo.plate, 'pack') === 0) throw new FearRuleError('no plates');
    takeItem(draft, db, photo.plate, 1, 'pack');
    out.push(event('inventory/itemRemoved', { item: photo.plate, qty: 1 }));
  } else if (req.method === 'witness') {
    const v = req.villager;
    if (v === undefined || draft.villagers[v]?.alive !== true)
      throw new FearRuleError('no such witness');
    const affinity = draft.villagers[v].affinity['guardian'] ?? 0;
    if (affinity < ev.witness.minAffinity)
      throw new FearRuleError('they will not speak to the guardian');
    // A hidden possession host lies.
    lies = possessedHidden(draft, v);
  } else {
    const item = req.item;
    if (item === undefined || !db.get('items', item).tags.includes(ev.relic.tag))
      throw new FearRuleError('that is not a relic');
    if (itemCount(draft, item, 'pack') === 0) throw new FearRuleError('no such relic in the pack');
    takeItem(draft, db, item, 1, 'pack');
    out.push(event('inventory/itemRemoved', { item, qty: 1 }));
    odds = ev.relic;
  }
  occ.examined.push(req.method);
  const chance = occ.hallucination ? odds.hallucination : odds.real;
  const roll = ctx.random('director').next() < chance;
  out.push(
    event('director/evidenceFound', {
      occurrence: occ.id,
      method: req.method,
      presence: lies ? !roll : roll,
    }),
  );
  return out;
}
