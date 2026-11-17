/**
 * Item rules and shared helpers of the inventory, gathering, alchemy, collection and photography
 * systems (docs/systems/inventory.md, alchemy.md, collection.md, photography.md).
 */
import type { Item, ItemRules } from '@mrak/content-schema';
import type { ContentDatabase } from '../content/database';
import type { Snapshot, Stack, WorldState } from '../state/world-state';

export type ReadState = Snapshot | WorldState;

export class ItemRuleError extends Error {}

/** The item rules (data/item-rules/default), or null when the pack has none. */
export function itemRules(db: ContentDatabase): ItemRules | null {
  return db.find('item-rules', 'default') ?? null;
}

export function requireItemRules(db: ContentDatabase): ItemRules {
  const rules = itemRules(db);
  if (!rules) throw new ItemRuleError('this content has no item rules');
  return rules;
}

/** Is the guardian where the house (store, mortar, cabinet) is? */
export function atHome(state: ReadState, rules: ItemRules | null): boolean {
  return rules === null || state.currentZone === rules.inventory.homeZone;
}

/** Potency of a stack: its own, else the item's content potency, else 1. */
export function potencyOf(item: Item, stack: { potency?: number | undefined }): number {
  return stack.potency ?? item.potency ?? 1;
}

/** Stored potency: undefined when it equals the item's default (so stacks merge). */
export function normalPotency(item: Item, potency: number | undefined): number | undefined {
  if (potency === undefined) return undefined;
  const p = Math.min(3, Math.max(1, Math.round(potency)));
  return p === (item.potency ?? 1) ? undefined : p;
}

/** A stack's identity: same item and same (normalized) potency. */
export function sameStack(s: Stack, item: string, potency: number | undefined): boolean {
  return s.item === item && s.potency === potency;
}

export function stackLimit(item: Item): number {
  return item.unique ? 1 : item.stackSize;
}

export function slotsOf(db: ContentDatabase, stacks: readonly Stack[]): number {
  return stacks.reduce((sum, s) => sum + (db.find('items', s.item)?.slotSize ?? 1), 0);
}

export function weightOf(db: ContentDatabase, stacks: readonly Stack[]): number {
  return stacks.reduce((sum, s) => sum + (db.find('items', s.item)?.weight ?? 1) * s.qty, 0);
}

/** A stored potency (see `normalPotency`) or any potency. */
export type PotencyFilter = number | undefined | 'any';

/** Units of `item` in a list of stacks. */
export function countIn(
  stacks: readonly Stack[],
  item: string,
  potency: PotencyFilter = 'any',
): number {
  return stacks
    .filter((s) => s.item === item && (potency === 'any' || s.potency === potency))
    .reduce((sum, s) => sum + s.qty, 0);
}
