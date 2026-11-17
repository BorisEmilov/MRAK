/**
 * Specialization trees (docs/systems/progression.md T1–T8): a generic engine over the tree data —
 * grid nodes, row costs, prerequisites by connection, ranked talents, dark trees.
 */
import type { Effect, ProgressionRules, SpecializationTree } from '@mrak/content-schema';
import type { ContentDatabase } from '../content/database';
import { event, type CoreEvent } from '../events';
import { getStat, setStat } from '../state/stats';
import type { WorldState } from '../state/world-state';
import { spend } from './skills';
import { assertCanSpend, debtTotal, ProgressionError, revelationOf, type ReadState } from './rules';

export function rowOf(cell: string): number {
  return Number(cell.slice(1));
}

/** Is this one of the calling's own trees? */
export function isNative(state: ReadState, db: ContentDatabase, tree: SpecializationTree): boolean {
  const calling = state.guardian.callingId ? db.find('callings', state.guardian.callingId) : null;
  return tree.kind === 'dark' || (calling?.trees.includes(tree.id) ?? false);
}

/** Revelation to own a tree, or null when it cannot be bought (owned, or dark: pact only). */
export function treeAccessCost(
  state: ReadState,
  db: ContentDatabase,
  rules: ProgressionRules,
  treeId: string,
): number | null {
  const tree = db.get('trees', treeId);
  if (state.guardian.unlockedTrees.includes(treeId) || tree.kind === 'dark') return null;
  return isNative(state, db, tree) ? rules.trees.secondNativeCost : rules.trees.foreignAccess;
}

export function buyTree(
  draft: WorldState,
  db: ContentDatabase,
  rules: ProgressionRules,
  treeId: string,
): CoreEvent[] {
  assertCanSpend(draft);
  const cost = treeAccessCost(draft, db, rules, treeId);
  if (cost === null)
    throw new ProgressionError(
      draft.guardian.unlockedTrees.includes(treeId) ? 'already owned' : 'opened by a pact',
    );
  const events = spend(draft, db, cost, `tree:${treeId}`);
  draft.guardian.unlockedTrees.push(treeId);
  events.push(event('tree/bought', { tree: treeId, cost }));
  return events;
}

export type NodeStatus = 'owned' | 'available' | 'locked';

/** What buying a node would do (T8): shown by the UI before confirming. */
export interface TalentPreview {
  tree: string;
  cell: string;
  talent: string;
  ranked: boolean;
  /** Ranks of this talent already owned (across trees). */
  rank: number;
  cost: number;
  status: NodeStatus;
  /** Why it cannot be bought now (owned nodes have none). */
  reason: 'tree' | 'prerequisite' | 'revelation' | 'night' | null;
  revelationAfter: number;
  corruption: number;
  debt: number;
  notice: number;
  /** Effects the talent applies. */
  effects: readonly Effect[];
}

export function talentCost(
  state: ReadState,
  db: ContentDatabase,
  rules: ProgressionRules,
  tree: SpecializationTree,
  cell: string,
): number {
  const node = tree.nodes.find((n) => n.cell === cell);
  if (!node) throw new ProgressionError('no such cell');
  let cost = node.cost ?? tree.rowCosts[rowOf(cell) - 1] ?? 0;
  if (!isNative(state, db, tree)) cost += rules.trees.foreignPerTalent;
  if (state.guardian.revelation.lifetime > rules.trees.softCapLifetime)
    cost = Math.ceil(cost * rules.trees.softCapFactor);
  return cost;
}

export function previewTalent(
  state: ReadState,
  db: ContentDatabase,
  rules: ProgressionRules,
  treeId: string,
  cell: string,
  night: boolean,
): TalentPreview {
  const tree = db.get('trees', treeId);
  const node = tree.nodes.find((n) => n.cell === cell);
  if (!node) throw new ProgressionError('no such cell');
  const key = `${treeId}/${cell}`;
  // A relic talent chosen in the Endless Chronicle replaces the cell's own (never adds).
  const talent = db.get('talents', state.endless.swaps[key] ?? node.talent);
  const owned = new Set(state.guardian.talents);
  const cost = talentCost(state, db, rules, tree, cell);
  const row = rowOf(cell) - 1;
  const dark = tree.kind === 'dark';
  let rank = 0;
  for (const k of owned) {
    const [t, c] = k.split('/');
    if (db.find('trees', t ?? '')?.nodes.find((n) => n.cell === c)?.talent === talent.id) rank += 1;
  }
  let status: NodeStatus = 'available';
  let reason: TalentPreview['reason'] = null;
  if (owned.has(key)) status = 'owned';
  else if (!state.guardian.unlockedTrees.includes(treeId)) [status, reason] = ['locked', 'tree'];
  else if (node.requires.length > 0 && !node.requires.some((r) => owned.has(`${treeId}/${r}`)))
    [status, reason] = ['locked', 'prerequisite'];
  else if (night) [status, reason] = ['locked', 'night'];
  else if (revelationOf(state) < cost) [status, reason] = ['locked', 'revelation'];
  return {
    tree: treeId,
    cell,
    talent: talent.id,
    ranked: talent.ranked,
    rank,
    cost,
    status,
    reason,
    revelationAfter: revelationOf(state) - cost,
    corruption: dark ? (tree.rowCorruption?.[row] ?? 0) : 0,
    debt: dark ? (tree.rowDebt?.[row] ?? 0) : 0,
    notice: dark ? (db.find('progression-rules', 'default')?.notice.darkTalent ?? 0) : 0,
    effects: talent.effects,
  };
}

/**
 * Buys a node. `apply` runs effect lists with a source (the Game's effect applier), so passive
 * modifiers and abilities are registered under `talent:<tree>/<cell>` (T3, T4).
 */
export function buyTalent(
  draft: WorldState,
  db: ContentDatabase,
  rules: ProgressionRules,
  treeId: string,
  cell: string,
  apply: (effects: readonly Effect[], source: string) => CoreEvent[],
): CoreEvent[] {
  assertCanSpend(draft);
  const preview = previewTalent(draft, db, rules, treeId, cell, false);
  if (preview.status === 'owned') throw new ProgressionError('already owned');
  if (preview.reason === 'tree') throw new ProgressionError('tree not owned');
  if (preview.reason === 'prerequisite') throw new ProgressionError('prerequisite missing');
  const tree = db.get('trees', treeId);
  const events = spend(draft, db, preview.cost, `talent:${treeId}/${cell}`);
  const key = `${treeId}/${cell}`;
  draft.guardian.talents.push(key);
  events.push(
    event('talent/bought', { tree: treeId, cell, talent: preview.talent, cost: preview.cost }),
  );
  if (tree.kind === 'dark') {
    if (preview.corruption > 0) {
      const [from, to] = setStat(
        draft,
        db,
        'corruption',
        getStat(draft, db, 'corruption') + preview.corruption,
      );
      if (from !== to) events.push(event('state/statChanged', { stat: 'corruption', from, to }));
    }
    if (preview.debt > 0 && tree.debtSource) {
      const source = db.get('debt-sources', tree.debtSource);
      draft.debt.entries.push({
        source: source.id,
        amount: preview.debt,
        creditor: source.creditor,
        at: { day: draft.clock.day, minute: draft.clock.minute },
      });
      const total = debtTotal(draft);
      setStat(draft, db, 'debt', total);
      events.push(event('debt/added', { source: source.id, amount: preview.debt, total }));
    }
    if (preview.notice > 0)
      setStat(draft, db, 'notice', getStat(draft, db, 'notice') + preview.notice);
  }
  events.push(...apply(db.get('talents', preview.talent).effects, `talent:${key}`));
  if (tree.onEachPurchase) events.push(...apply(tree.onEachPurchase, `tree:${treeId}`));
  return events;
}

/** Nodes that could be bought right now (for the "talent available" notice). */
export function affordableTalents(
  state: ReadState,
  db: ContentDatabase,
  rules: ProgressionRules,
): TalentPreview[] {
  const out: TalentPreview[] = [];
  for (const treeId of state.guardian.unlockedTrees) {
    const tree = db.find('trees', treeId);
    for (const n of tree?.nodes ?? []) {
      const p = previewTalent(state, db, rules, treeId, n.cell, false);
      if (p.status === 'available') out.push(p);
    }
  }
  return out;
}
