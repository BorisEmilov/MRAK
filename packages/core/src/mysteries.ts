/**
 * Mysteries (docs/systems/mysteries.md → Implementation): clues found at their sources, lying
 * witnesses exposed by their secrets, the deduction board (threads and card positions), and the
 * final act — carried out whether it is right or wrong.
 */
import type { Effect, Mystery } from '@mrak/content-schema';
import type { ContentDatabase } from './content/database';
import { event, type CoreEvent } from './events';
import { resolveCheck } from './guardian/checks';
import { progressionRules } from './guardian/rules';
import type { IRandom } from './random';
import type { WorldState } from './state/world-state';
import { evaluatorAt } from './village/common';

export class MysteryError extends Error {}

export interface MysteryContext {
  db: ContentDatabase;
  apply: (effects: readonly Effect[], source: string) => CoreEvent[];
  rng: IRandom;
}

const BOARD_LIMIT = 5000;

/** The propositions a mystery's board offers: suspects, causes, remedies, motives, chances. */
export function propositionsOf(m: Mystery): string[] {
  return [
    ...m.suspects.map((s) => `culprit:${s.villager}`),
    ...m.causes.map((c) => `cause:${c.id}`),
    ...m.remedies.map((r) => `remedy:${r.id}`),
    ...m.suspects.map((s) => `motive:${s.villager}`),
    ...m.suspects.map((s) => `opportunity:${s.villager}`),
  ];
}

function activeMystery(draft: WorldState, db: ContentDatabase, id: string) {
  const m = db.get('mysteries', id);
  const state = draft.mysteries[id];
  if (state?.status !== 'active') throw new MysteryError('the case is not open');
  return { m, state };
}

function sourceMatches(source: Mystery['clues'][number]['sources'][number], e: CoreEvent): boolean {
  switch (source.kind) {
    case 'zone':
      return (
        e.type === 'world/poiInteracted' &&
        e.payload.zone === source.ref &&
        (source.poi === undefined || source.poi === e.payload.poi)
      );
    case 'villager':
      return e.type === 'villager/talked' && e.payload.villager === source.ref;
    case 'event':
      return (
        (e.type === 'director/eventFired' || e.type === 'director/eventTriggered') &&
        e.payload.event === source.ref
      );
    case 'collectible':
      return e.type === 'journal/collectibleGranted' && e.payload.collectible === source.ref;
  }
}

/** Reactions: clues found at their sources, liars exposed, deadlines passed. */
export function mysteriesAfter(
  draft: WorldState,
  ctx: MysteryContext,
  events: readonly CoreEvent[],
): CoreEvent[] {
  const { db } = ctx;
  const out: CoreEvent[] = [];
  const holds = evaluatorAt(draft, db, draft.clock.day, draft.clock.minute);
  for (const [id, state] of Object.entries(draft.mysteries)) {
    if (state.status !== 'active') continue;
    const m = db.find('mysteries', id);
    if (!m) continue;
    for (const e of events) {
      for (const clue of m.clues) {
        if (state.clues.includes(clue.id)) continue;
        const source = clue.sources.find(
          (s) => sourceMatches(s, e) && (s.when === undefined || holds(s.when)),
        );
        if (!source) continue;
        if (source.check) {
          const prules = progressionRules(db);
          if (prules && draft.guardian.callingId !== null) {
            const r = resolveCheck(
              draft,
              db,
              prules,
              { skill: source.check.skill, difficulty: source.check.difficulty, target: clue.id },
              ctx.rng,
            );
            out.push(...r.events, ...ctx.apply(r.effects, `clue:${clue.id}`));
            if (!r.result.success) continue;
          }
        }
        out.push(...ctx.apply([{ addClue: clue.id }], `mystery:${id}`));
      }
      if (e.type === 'villager/secretRevealed') {
        for (const clue of m.clues) {
          const liar = clue.liar;
          if (!liar || liar.villager !== e.payload.villager || liar.secret !== e.payload.secret)
            continue;
          if (!state.clues.includes(clue.id) || state.retracted.includes(clue.id)) continue;
          state.retracted.push(clue.id);
          state.links = state.links.filter((l) => l.clue !== clue.id);
          out.push(event('mystery/clueRetracted', { mystery: id, clue: clue.id }));
        }
      }
      const past =
        (e.type === 'time/chapterEnded' && e.payload.chapter === m.chapter) ||
        (e.type === 'time/dawn' &&
          draft.calendar.chapterId === m.chapter &&
          draft.calendar.nightIndex > m.deadlineNight);
      if (past) {
        out.push(...giveUp(draft, ctx, m));
        break;
      }
    }
  }
  return out;
}

function giveUp(draft: WorldState, ctx: MysteryContext, m: Mystery): CoreEvent[] {
  const state = draft.mysteries[m.id];
  if (!state) return [];
  state.status = 'unsolved';
  return [
    event('mystery/unsolved', { mystery: m.id }),
    ...ctx.apply(m.unsolved.effects, `mystery:${m.id}`),
  ];
}

/** Ties (or unties) a red thread between a found clue and a proposition. Never judged. */
export function linkClue(
  draft: WorldState,
  db: ContentDatabase,
  mystery: string,
  clue: string,
  proposition: string,
  linked: boolean,
): CoreEvent[] {
  const { m, state } = activeMystery(draft, db, mystery);
  if (!state.clues.includes(clue)) throw new MysteryError('clue not found yet');
  if (!propositionsOf(m).includes(proposition)) throw new MysteryError('no such proposition');
  const has = state.links.some((l) => l.clue === clue && l.proposition === proposition);
  if (has === linked) return [];
  state.links = linked
    ? [...state.links, { clue, proposition }]
    : state.links.filter((l) => !(l.clue === clue && l.proposition === proposition));
  return [event('mystery/linked', { mystery, clue, proposition, linked })];
}

/** Moves a card on the board (a found clue or a proposition). */
export function moveCard(
  draft: WorldState,
  db: ContentDatabase,
  mystery: string,
  card: string,
  x: number,
  y: number,
): CoreEvent[] {
  const { m, state } = activeMystery(draft, db, mystery);
  if (!state.clues.includes(card) && !propositionsOf(m).includes(card))
    throw new MysteryError('no such card');
  const clamp = (v: number) => Math.round(Math.max(-BOARD_LIMIT, Math.min(BOARD_LIMIT, v)));
  state.board[card] = { x: clamp(x), y: clamp(y) };
  return [];
}

/**
 * The final act: the chosen culprit, cause and remedy are carried out (accuse, exorcise, burn,
 * exhume, confront) and the world answers — the right culprit's outcome, the partial outcome
 * if the culprit is right but not the rest, or the wrongly accused's outcome.
 */
export function concludeMystery(
  draft: WorldState,
  ctx: MysteryContext,
  mystery: string,
  culprit: string,
  cause: string,
  remedy: string,
): CoreEvent[] {
  const { m, state } = activeMystery(draft, ctx.db, mystery);
  if (!m.suspects.some((s) => s.villager === culprit)) throw new MysteryError('not a suspect');
  if (!m.causes.some((c) => c.id === cause)) throw new MysteryError('no such cause');
  const chosen = m.remedies.find((r) => r.id === remedy);
  if (!chosen) throw new MysteryError('no such remedy');
  const s = m.solution;
  const correct = culprit === s.culprit && cause === s.cause && remedy === s.remedy;
  const outcome = m.outcomes.find((o) => o.culprit === culprit);
  const effects =
    culprit === s.culprit && !correct && m.partial ? m.partial.effects : (outcome?.effects ?? []);
  state.status = 'concluded';
  state.conclusion = { culprit, correct, cause, remedy };
  return [
    event('mystery/concluded', { mystery, culprit, action: chosen.action, correct }),
    ...ctx.apply(effects, `mystery:${mystery}`),
  ];
}

/** Giving up the case: its unsolved outcome follows. */
export function abandonMystery(
  draft: WorldState,
  ctx: MysteryContext,
  mystery: string,
): CoreEvent[] {
  const { m } = activeMystery(draft, ctx.db, mystery);
  return giveUp(draft, ctx, m);
}
