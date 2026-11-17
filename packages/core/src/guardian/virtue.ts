/**
 * Virtue and sin (docs/systems/progression.md V1–V5): acting by your virtue or sin, sin takeover
 * and sin blocking of tagged options (v1 surface: talk tones).
 */
import type { Condition, Effect, ProgressionRules, TalkTone } from '@mrak/content-schema';
import type { ContentDatabase } from '../content/database';
import { event, type CoreEvent } from '../events';
import type { IRandom } from '../random';
import { effectiveStat, getStat, setStat } from '../state/stats';
import type { WorldState } from '../state/world-state';
import { ProgressionError, type ReadState } from './rules';

/** Reacts to tags of a choice or action (V2, V3). `apply` runs effects with a source. */
export function actOnTags(
  draft: WorldState,
  db: ContentDatabase,
  rules: ProgressionRules,
  tags: readonly string[],
  apply: (effects: readonly Effect[], source: string) => CoreEvent[],
): CoreEvent[] {
  const g = draft.guardian;
  const events: CoreEvent[] = [];
  if (g.virtue && tags.includes(`virtue:${g.virtue}`)) {
    const faith = getStat(draft, db, 'faith');
    setStat(draft, db, 'faith', faith + rules.virtue.faith);
    if (g.boonDay !== draft.clock.day) {
      g.boonDay = draft.clock.day;
      g.boonReady = true;
    }
    g.virtueActs += 1;
    events.push(event('virtue/acted', { virtue: g.virtue, acts: g.virtueActs }));
    if (g.virtueActs === rules.virtue.virtuousAfter && !draft.flags[rules.virtue.virtuousFlag]) {
      draft.flags[rules.virtue.virtuousFlag] = true;
      events.push(event('state/flagSet', { flag: rules.virtue.virtuousFlag }));
      events.push(...apply(rules.virtue.virtuousEffects, 'virtuous'));
    }
  }
  if (g.sin && tags.includes(`sin:${g.sin}`)) {
    const corruption = getStat(draft, db, 'corruption');
    setStat(draft, db, 'corruption', corruption + rules.sin.corruption);
    events.push(event('sin/acted', { sin: g.sin }));
  }
  return events;
}

/** A new chapter: virtue count and the Virtuous status reset (V2). */
export function resetVirtue(draft: WorldState, rules: ProgressionRules): CoreEvent[] {
  draft.guardian.virtueActs = 0;
  draft.modifiers = draft.modifiers.filter((m) => m.source !== 'virtuous');
  if (!draft.flags[rules.virtue.virtuousFlag]) return [];
  // eslint-disable-next-line @typescript-eslint/no-dynamic-delete -- flags is a plain record
  delete draft.flags[rules.virtue.virtuousFlag];
  return [event('state/flagCleared', { flag: rules.virtue.virtuousFlag })];
}

/** Chance that the sin speaks instead of the guardian (V4). */
export function takeoverChance(
  state: ReadState,
  db: ContentDatabase,
  rules: ProgressionRules,
): number {
  const diff = effectiveStat(state, db, 'corruption') - effectiveStat(state, db, 'faith');
  return Math.max(0, Math.min(rules.sin.takeoverMax, diff / 100));
}

export interface ToneOption {
  tone: TalkTone;
  /** The sin that forbids it (V5), or null. */
  blockedBy: string | null;
  /** Tagged with the guardian's own virtue / sin (for UI markers). */
  virtue: boolean;
  sin: boolean;
}

/** Talk tones offered now, in order, with blocking (V5). */
export function toneOptions(
  state: ReadState,
  db: ContentDatabase,
  rules: ProgressionRules,
  evaluate: (c: Condition) => boolean,
): ToneOption[] {
  const g = state.guardian;
  const sin = g.sin ? db.find('sins', g.sin) : undefined;
  const corrupt = effectiveStat(state, db, 'corruption') >= rules.sin.blockAt;
  return [...db.all('talk-tones')]
    .filter((t) => !t.when || evaluate(t.when))
    .sort((a, b) => a.order - b.order)
    .map((tone) => {
      const blockedBy =
        corrupt &&
        sin !== undefined &&
        tone.tags.some((tag) => sin.blocks.some((v) => tag === `virtue:${v}`))
          ? sin.id
          : null;
      return {
        tone,
        blockedBy,
        virtue: g.virtue !== null && tone.tags.includes(`virtue:${g.virtue}`),
        sin: g.sin !== null && tone.tags.includes(`sin:${g.sin}`),
      };
    });
}

/** Resolves the tone actually used (V4): the sin may take over. */
export function chooseTone(
  state: ReadState,
  db: ContentDatabase,
  rules: ProgressionRules,
  wanted: string,
  rng: IRandom,
  evaluate: (c: Condition) => boolean,
): { tone: TalkTone; events: CoreEvent[] } {
  const options = toneOptions(state, db, rules, evaluate);
  const pick = options.find((o) => o.tone.id === wanted);
  if (!pick) throw new ProgressionError('tone not available');
  if (pick.blockedBy) throw new ProgressionError('your sin will not allow it');
  const sinOption = options.find((o) => o.sin && o.blockedBy === null);
  if (pick.sin || !sinOption || pick.tone.noSinTakeover) return { tone: pick.tone, events: [] };
  const chance = takeoverChance(state, db, rules);
  if (chance <= 0 || rng.next() >= chance) return { tone: pick.tone, events: [] };
  return {
    tone: sinOption.tone,
    events: [
      event('sin/tookOver', {
        sin: state.guardian.sin ?? '',
        wanted: pick.tone.id,
        chosen: sinOption.tone.id,
      }),
    ],
  };
}
