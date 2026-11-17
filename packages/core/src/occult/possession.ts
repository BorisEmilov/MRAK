/**
 * Hidden possession (docs/systems/possession.md → Implementation): hosts chosen by
 * vulnerability, nightly stage advance at 03:33, symptoms at dawn — and false symptoms in the
 * unpossessed, so a symptom alone never proves anything.
 */
import type { FearRules } from '@mrak/content-schema';
import type { ContentDatabase } from '../content/database';
import { event, type CoreEvent } from '../events';
import type { IRandom } from '../random';
import { getStat } from '../state/stats';
import type { WorldState } from '../state/world-state';
import { livingVillagers } from '../village/common';
import { fearRules, weightedIndex, type FearContext, type ReadState } from '../fear/common';

/** Vulnerability of a villager: fear and lack of faith open the door. */
export function vulnerability(state: ReadState, db: ContentDatabase, villager: string): number {
  const rules = fearRules(db);
  const fear = getStat(state, db, 'fear', villager) / 100;
  if (!rules) return 1 + fear;
  const v = rules.possession.vulnerability;
  const faith = db.hasStat(v.faithStat) ? getStat(state, db, v.faithStat, villager) / 100 : 0.5;
  return 1 + v.fear * fear + v.lowFaith * (1 - faith);
}

/** The most vulnerable living, unpossessed villager (weighted pick), or null. */
export function chooseHost(
  state: ReadState,
  db: ContentDatabase,
  rng: IRandom,
  exclude: readonly string[] = [],
): string | null {
  const free = livingVillagers(state, db).filter(
    (v) => !exclude.includes(v.id) && !state.possessions.some((p) => p.host === v.id),
  );
  const i = weightedIndex(
    free.map((v) => vulnerability(state, db, v.id)),
    rng,
  );
  return free[i]?.id ?? null;
}

export function advanceChance(rules: FearRules, rank: number): number {
  const a = rules.possession.advance;
  return Math.min(a.max, Math.max(a.min, a.base + a.perRank * rank));
}

/** 03:33: each possession may advance one stage (hidden). */
export function advancePossessions(draft: WorldState, ctx: FearContext): CoreEvent[] {
  const out: CoreEvent[] = [];
  const rng = ctx.random('director');
  for (const p of draft.possessions) {
    const demon = ctx.db.get('demons', p.demon);
    if (p.stage >= demon.maxStage) continue;
    if (rng.next() >= advanceChance(ctx.rules, demon.rank)) continue;
    p.stage += 1;
    out.push(event('possession/stageAdvanced', { demon: p.demon, host: p.host, stage: p.stage }));
  }
  return out;
}

/** Dawn: every host shows its stage's symptom; sometimes an innocent shows a false one. */
export function symptomsAtDawn(draft: WorldState, ctx: FearContext): CoreEvent[] {
  const { db } = ctx;
  const out: CoreEvent[] = [];
  for (const p of draft.possessions) {
    if (p.host === 'guardian' || draft.villagers[p.host]?.alive !== true) continue;
    const symptom = db.get('demons', p.demon).symptoms.find((s) => s.stage === p.stage);
    if (symptom)
      out.push(event('possession/symptomSeen', { villager: p.host, symptom: symptom.descKey }));
  }
  const rng = ctx.random('villagers');
  if (rng.next() < ctx.rules.possession.falseSymptomChance) {
    const free = livingVillagers(draft, db).filter(
      (v) => !draft.possessions.some((p) => p.host === v.id),
    );
    const demons = db.all('demons');
    const villager = free[rng.int(0, Math.max(0, free.length - 1))];
    const demon = demons[rng.int(0, Math.max(0, demons.length - 1))];
    const symptom = demon?.symptoms.filter((s) => s.stage <= 2)[0];
    if (villager && symptom)
      out.push(
        event('possession/symptomSeen', { villager: villager.id, symptom: symptom.descKey }),
      );
  }
  return out;
}

/** Journal: fragments of a demon's true name found so far, and whether it is complete. */
export function trueNameProgress(
  state: ReadState,
  db: ContentDatabase,
  demon: string,
): { have: string[]; total: number; known: boolean } {
  const def = db.get('demons', demon);
  const have = def.fragments
    .filter((f) => state.journal.learned.includes(`name:${demon}:${f.id}`))
    .map((f) => f.id);
  return { have, total: def.fragments.length, known: have.length === def.fragments.length };
}

/** Writes a fragment into the journal; completing the name emits `journal/trueNameComposed`. */
export function learnFragment(
  draft: WorldState,
  db: ContentDatabase,
  demon: string,
  fragment: string,
): CoreEvent[] {
  const def = db.get('demons', demon);
  if (!def.fragments.some((f) => f.id === fragment))
    throw new RangeError(`demon "${demon}" has no fragment "${fragment}"`);
  const entry = `name:${demon}:${fragment}`;
  if (draft.journal.learned.includes(entry)) return [];
  draft.journal.learned.push(entry);
  const out = [event('journal/nameFragmentFound', { demon, fragment })];
  if (trueNameProgress(draft, db, demon).known)
    out.push(event('journal/trueNameComposed', { demon }));
  return out;
}
