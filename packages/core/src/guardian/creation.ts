/**
 * Creating a guardian (docs/systems/progression.md C1–C4): calling, native tree, attribute point,
 * virtue and sin.
 */
import type { Effect, ProgressionRules } from '@mrak/content-schema';
import type { ContentDatabase } from '../content/database';
import { event, type CoreEvent } from '../events';
import { setStat } from '../state/stats';
import type { WorldState } from '../state/world-state';
import { grantGear } from './gear';
import { ProgressionError } from './rules';

export interface GuardianChoices {
  calling: string;
  /** Native tree owned for free. */
  tree: string;
  /** Attribute that gets the player's point. */
  bonus: string;
  virtue: string;
  sin: string;
}

/** Attributes a calling + bonus choice gives (C1), for the creation screen preview. */
export function startingAttributes(
  db: ContentDatabase,
  rules: ProgressionRules,
  calling: string,
  bonus: string,
): Record<string, number> {
  const c = db.get('callings', calling);
  const out: Record<string, number> = {};
  for (const a of db.all('attributes')) out[a.id] = rules.attributes.base;
  for (const a of c.attributeBonuses) out[a] = (out[a] ?? rules.attributes.base) + 1;
  out[bonus] = (out[bonus] ?? rules.attributes.base) + rules.attributes.playerPoints;
  return out;
}

export function createGuardian(
  draft: WorldState,
  db: ContentDatabase,
  rules: ProgressionRules,
  choices: GuardianChoices,
  apply: (effects: readonly Effect[], source: string) => CoreEvent[],
): CoreEvent[] {
  if (draft.guardian.callingId !== null) throw new ProgressionError('guardian already created');
  const calling = db.get('callings', choices.calling);
  if (!calling.trees.includes(choices.tree))
    throw new ProgressionError('not a tree of this calling');
  db.get('attributes', choices.bonus);
  db.get('virtues', choices.virtue);
  db.get('sins', choices.sin);
  const attributes = startingAttributes(db, rules, calling.id, choices.bonus);
  if (Object.values(attributes).some((v) => v > rules.attributes.creationMax))
    throw new ProgressionError('attribute above the creation maximum');
  const g = draft.guardian;
  g.callingId = calling.id;
  g.attributes = attributes;
  g.skills = {};
  for (const s of db.all('skills')) {
    const own = calling.callingSkills.includes(s.id);
    g.skills[s.id] = {
      rank: calling.startingRanks.includes(s.id) ? 1 : 0,
      cap: own ? rules.skills.callingCap : rules.skills.otherCap,
      practice: 0,
    };
  }
  if (!g.unlockedTrees.includes(choices.tree)) g.unlockedTrees.push(choices.tree);
  g.virtue = choices.virtue;
  g.sin = choices.sin;
  setStat(draft, db, 'faith', calling.startingFaith);
  const events: CoreEvent[] = [
    event('guardian/created', {
      calling: calling.id,
      tree: choices.tree,
      virtue: choices.virtue,
      sin: choices.sin,
    }),
  ];
  for (const gear of calling.startingEquipment) events.push(...grantGear(draft, db, gear));
  events.push(
    ...apply(
      calling.startingGear.map((s) => ({ giveItem: s.item, qty: s.qty, to: 'pack' as const })),
      `calling:${calling.id}`,
    ),
  );
  events.push(...apply(calling.ability.effects, `calling:${calling.id}`));
  return events;
}
