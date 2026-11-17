/**
 * Dialogue choices (docs/systems/dialogue.md → Implementation): requirement tags, sin blocking
 * and sin takeover (progression.md V4–V5) applied by core, so the client cannot pick a choice it
 * is not allowed.
 */
import type { ProgressionRules } from '@mrak/content-schema';
import type { ContentDatabase } from './content/database';
import { event, type CoreEvent } from './events';
import { itemCount } from './items/inventory';
import type { IRandom } from './random';
import { effectiveStat } from './state/stats';
import type { Snapshot, WorldState } from './state/world-state';
import { takeoverChance } from './guardian/virtue';

type ReadState = Snapshot | WorldState;

export interface ChoiceStatus {
  /** The first unmet `#requires:` tag, e.g. "requires:item:salt:2", or null. */
  requirement: string | null;
  /** The guardian's sin that forbids it (V5), or null. */
  blockedBy: string | null;
  sin: boolean;
}

/** Is a `#requires:<kind>:<id>[:<n>]` tag met now? */
export function requirementMet(state: ReadState, db: ContentDatabase, tag: string): boolean {
  const [, kind, id = '', n = '1'] = tag.split(':');
  const need = Number(n);
  switch (kind) {
    case 'flag':
      return state.flags[id] === true;
    case 'item':
      return itemCount(state, id, 'any') >= need;
    case 'skill':
      return (state.guardian.skills[id]?.rank ?? 0) >= need;
    case 'stat':
      return db.hasStat(id) && effectiveStat(state, db, id) >= need;
    default:
      return false;
  }
}

export function choiceStatus(
  state: ReadState,
  db: ContentDatabase,
  rules: ProgressionRules | null,
  tags: readonly string[],
): ChoiceStatus {
  const requirement =
    tags.find((t) => t.startsWith('requires:') && !requirementMet(state, db, t)) ?? null;
  const sinId = state.guardian.sin;
  const sin = sinId !== null && tags.includes(`sin:${sinId}`);
  let blockedBy: string | null = null;
  if (rules && sinId && effectiveStat(state, db, 'corruption') >= rules.sin.blockAt) {
    const blocks = db.find('sins', sinId)?.blocks ?? [];
    if (tags.some((t) => blocks.some((v) => t === `virtue:${v}`))) blockedBy = sinId;
  }
  return { requirement, blockedBy, sin };
}

export class DialogueError extends Error {}

/**
 * Resolves the choice actually made: refuses blocked ones, and the sin may take over (V4) unless
 * the wanted choice is `noSinTakeover`. Returns the chosen index and events.
 */
export function resolveChoice(
  state: ReadState,
  db: ContentDatabase,
  rules: ProgressionRules | null,
  story: string,
  options: readonly (readonly string[])[],
  wanted: number,
  rng: IRandom,
): { chosen: number; events: CoreEvent[] } {
  const want = options[wanted];
  if (!want) throw new DialogueError('no such choice');
  const status = choiceStatus(state, db, rules, want);
  if (status.requirement) throw new DialogueError('requirement not met');
  if (status.blockedBy) throw new DialogueError('your sin will not allow it');
  if (rules && !status.sin && !want.includes('noSinTakeover')) {
    const sinIndex = options.findIndex((tags) => {
      const s = choiceStatus(state, db, rules, tags);
      return s.sin && !s.requirement && !s.blockedBy;
    });
    const chance = sinIndex >= 0 ? takeoverChance(state, db, rules) : 0;
    if (chance > 0 && rng.next() < chance)
      return {
        chosen: sinIndex,
        events: [
          event('sin/tookOver', {
            sin: state.guardian.sin ?? '',
            wanted: `${story}#${String(wanted)}`,
            chosen: `${story}#${String(sinIndex)}`,
          }),
        ],
      };
  }
  return { chosen: wanted, events: [] };
}
