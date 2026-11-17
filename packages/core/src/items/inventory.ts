/**
 * The guardian's pack, house store and the ground (docs/systems/inventory.md → Implementation).
 * Pure functions over a draft WorldState; `Game` validates commands and commits.
 */
import type { Effect, Item, ItemRules } from '@mrak/content-schema';
import type { ContentDatabase } from '../content/database';
import { event, type CoreEvent } from '../events';
import { effectiveStat, getStat, setStat } from '../state/stats';
import type { Stack, WorldState } from '../state/world-state';
import {
  atHome,
  countIn,
  ItemRuleError,
  normalPotency,
  potencyOf,
  sameStack,
  slotsOf,
  stackLimit,
  weightOf,
  type PotencyFilter,
  type ReadState,
} from './rules';

export type Place = 'pack' | 'storage';

/** Without item rules (content with no items) the pack has no limits. */
const UNLIMITED = 1_000;

export function packSlots(state: ReadState, db: ContentDatabase, rules: ItemRules | null): number {
  if (!rules) return UNLIMITED;
  const bonus = rules.inventory.slotsStat ? effectiveStat(state, db, rules.inventory.slotsStat) : 0;
  return rules.inventory.packSlots + Math.floor(bonus);
}

export function carryCapacity(
  state: ReadState,
  db: ContentDatabase,
  rules: ItemRules | null,
): number {
  if (!rules) return UNLIMITED;
  const bonus = rules.inventory.weightStat
    ? effectiveStat(state, db, rules.inventory.weightStat)
    : 0;
  return rules.inventory.carryWeight + bonus;
}

export interface PackLoad {
  /** Slots available and used. */
  slots: number;
  used: number;
  /** Carried weight and the weight the guardian carries without slowing down. */
  weight: number;
  capacity: number;
  encumbered: boolean;
  /** Movement multiplier (1, or `encumberedSpeed`). */
  speed: number;
}

export function packLoad(state: ReadState, db: ContentDatabase, rules: ItemRules | null): PackLoad {
  const weight = Math.round(weightOf(db, state.guardian.pack) * 10) / 10;
  const capacity = carryCapacity(state, db, rules);
  const encumbered = weight > capacity;
  return {
    slots: packSlots(state, db, rules),
    used: slotsOf(db, state.guardian.pack),
    weight,
    capacity,
    encumbered,
    speed: encumbered && rules ? rules.inventory.encumberedSpeed : 1,
  };
}

/** Does the guardian already own this unique item (anywhere)? */
export function ownsUnique(state: ReadState, item: string): boolean {
  const g = state.guardian;
  return (
    countIn(g.pack, item) > 0 ||
    countIn(g.storage, item) > 0 ||
    Object.values(g.ground).some((stacks) => countIn(stacks, item) > 0) ||
    state.collection.cabinet.includes(item)
  );
}

/** Units of an item in the pack, the store or both (`hasItem`, task materials…). */
export function itemCount(
  state: ReadState,
  item: string,
  where: Place | 'any' = 'any',
  potency: PotencyFilter = 'any',
): number {
  const g = state.guardian;
  return (
    (where !== 'storage' ? countIn(g.pack, item, potency) : 0) +
    (where !== 'pack' ? countIn(g.storage, item, potency) : 0)
  );
}

/** Adds to the pack within slots and stack sizes; returns the units that did not fit. */
function addToPack(
  pack: Stack[],
  db: ContentDatabase,
  slots: number,
  item: Item,
  qty: number,
  potency: number | undefined,
): number {
  const limit = stackLimit(item);
  let left = qty;
  if (!item.unique)
    for (const s of pack) {
      if (left === 0) break;
      if (!sameStack(s, item.id, potency) || s.qty >= limit) continue;
      const add = Math.min(limit - s.qty, left);
      s.qty += add;
      left -= add;
    }
  let used = slotsOf(db, pack);
  while (left > 0 && used + item.slotSize <= slots) {
    const add = Math.min(limit, left);
    pack.push(
      potency === undefined ? { item: item.id, qty: add } : { item: item.id, qty: add, potency },
    );
    used += item.slotSize;
    left -= add;
  }
  return left;
}

/** Store and ground: one stack per item and potency, no stack size (unique items: one each). */
function addToPile(stacks: Stack[], item: Item, qty: number, potency: number | undefined): void {
  const existing = item.unique ? undefined : stacks.find((s) => sameStack(s, item.id, potency));
  if (existing) existing.qty += qty;
  else
    for (let i = 0; i < (item.unique ? qty : 1); i++)
      stacks.push(
        potency === undefined
          ? { item: item.id, qty: item.unique ? 1 : qty }
          : { item: item.id, qty: item.unique ? 1 : qty, potency },
      );
}

/** Removes units, lowest potency first; returns what was taken (stored potencies). */
function removeFrom(stacks: Stack[], item: Item, qty: number, potency: PotencyFilter): Stack[] {
  const taken: Stack[] = [];
  let left = qty;
  const candidates = stacks
    .filter((s) => s.item === item.id && (potency === 'any' || s.potency === potency))
    .sort((a, b) => potencyOf(item, a) - potencyOf(item, b));
  for (const s of candidates) {
    if (left === 0) break;
    const take = Math.min(s.qty, left);
    s.qty -= take;
    left -= take;
    const prev = taken.find((t) => t.potency === s.potency);
    if (prev) prev.qty += take;
    else
      taken.push(
        s.potency === undefined
          ? { item: item.id, qty: take }
          : { item: item.id, qty: take, potency: s.potency },
      );
  }
  for (let i = stacks.length - 1; i >= 0; i--) if ((stacks[i]?.qty ?? 0) <= 0) stacks.splice(i, 1);
  return taken;
}

export interface GiveOptions {
  to?: Place | undefined;
  /** Effective potency (1–3); omitted = the item's default. */
  potency?: number | undefined;
}

/**
 * Gives items (the `giveItem` effect, gathering, brewing). Returns the events and whether the
 * item was found for the first time (the caller applies a cursed object's `effects`).
 */
export function giveItem(
  draft: WorldState,
  db: ContentDatabase,
  rules: ItemRules | null,
  itemId: string,
  qty: number,
  options: GiveOptions = {},
): { events: CoreEvent[]; firstFound: boolean } {
  const item = db.get('items', itemId);
  const events: CoreEvent[] = [];
  if (item.unique && ownsUnique(draft, itemId)) return { events, firstFound: false };
  const amount = item.unique ? 1 : qty;
  const potency = normalPotency(item, options.potency);
  const g = draft.guardian;
  if (options.to === 'storage') {
    addToPile(g.storage, item, amount, potency);
    events.push(event('inventory/itemAdded', { item: itemId, qty: amount, to: 'storage' }));
  } else {
    const left = addToPack(g.pack, db, packSlots(draft, db, rules), item, amount, potency);
    if (amount - left > 0)
      events.push(event('inventory/itemAdded', { item: itemId, qty: amount - left, to: 'pack' }));
    if (left > 0) {
      if (atHome(draft, rules)) {
        addToPile(g.storage, item, left, potency);
        events.push(event('inventory/itemAdded', { item: itemId, qty: left, to: 'storage' }));
        events.push(event('inventory/full', { item: itemId, qty: left, where: 'storage' }));
      } else {
        const zone = draft.currentZone ?? 'nowhere';
        const ground = (g.ground[zone] ??= []);
        const cap = rules?.inventory.groundStacks ?? UNLIMITED;
        // Unique items are never lost; ordinary ones beyond a full ground are.
        if (item.unique || ground.length < cap || ground.some((s) => sameStack(s, itemId, potency)))
          addToPile(ground, item, left, potency);
        events.push(event('inventory/itemAdded', { item: itemId, qty: left, to: 'ground' }));
        events.push(event('inventory/full', { item: itemId, qty: left, where: 'ground' }));
      }
    }
  }
  const firstFound = !draft.collection.found.includes(itemId);
  if (firstFound) {
    draft.collection.found.push(itemId);
    events.push(event('collection/found', { item: itemId }));
  }
  return { events, firstFound };
}

/**
 * Takes up to `qty` units (pack first, then the store, for "any"). Returns the stacks taken;
 * callers that need all of them check `itemCount` first.
 */
export function takeItem(
  draft: WorldState,
  db: ContentDatabase,
  itemId: string,
  qty: number,
  from: Place | 'any' = 'any',
  potency: PotencyFilter = 'any',
): Stack[] {
  const item = db.get('items', itemId);
  const g = draft.guardian;
  const order: Stack[][] =
    from === 'pack' ? [g.pack] : from === 'storage' ? [g.storage] : [g.pack, g.storage];
  const taken: Stack[] = [];
  let left = qty;
  for (const stacks of order) {
    if (left === 0) break;
    for (const t of removeFrom(stacks, item, left, potency)) {
      left -= t.qty;
      taken.push(t);
    }
  }
  return taken;
}

/** Stored potency of a command's effective potency (undefined → any). */
function filterOf(item: Item, potency: number | undefined): PotencyFilter {
  return potency === undefined ? 'any' : normalPotency(item, potency);
}

function assertHome(draft: WorldState, rules: ItemRules | null): void {
  if (!atHome(draft, rules)) throw new ItemRuleError('not at home');
}

/** Moves units between the pack and the house store (home zone only). */
export function moveItem(
  draft: WorldState,
  db: ContentDatabase,
  rules: ItemRules | null,
  itemId: string,
  potency: number | undefined,
  qty: number,
  to: Place,
): CoreEvent[] {
  assertHome(draft, rules);
  const item = db.get('items', itemId);
  const from: Place = to === 'pack' ? 'storage' : 'pack';
  const filter = filterOf(item, potency);
  if (itemCount(draft, itemId, from, filter) === 0) throw new ItemRuleError('nothing to move');
  const taken = takeItem(draft, db, itemId, qty, from, filter);
  const g = draft.guardian;
  let moved = 0;
  let left = 0;
  for (const t of taken) {
    if (to === 'storage') {
      addToPile(g.storage, item, t.qty, t.potency);
      moved += t.qty;
    } else {
      const rest = addToPack(g.pack, db, packSlots(draft, db, rules), item, t.qty, t.potency);
      if (rest > 0) addToPile(g.storage, item, rest, t.potency);
      moved += t.qty - rest;
      left += rest;
    }
  }
  if (moved === 0) throw new ItemRuleError('pack full');
  const events = [event('inventory/moved', { item: itemId, qty: moved, to })];
  if (left > 0) events.push(event('inventory/full', { item: itemId, qty: left, where: 'storage' }));
  return events;
}

/** Puts pack units on the ground of the current zone. Cursed items cling at night. */
export function dropItem(
  draft: WorldState,
  db: ContentDatabase,
  rules: ItemRules | null,
  itemId: string,
  potency: number | undefined,
  qty: number,
  night: boolean,
): CoreEvent[] {
  const item = db.get('items', itemId);
  if (item.cursed && night) throw new ItemRuleError('it will not leave your hand');
  const filter = filterOf(item, potency);
  if (itemCount(draft, itemId, 'pack', filter) === 0) throw new ItemRuleError('not carried');
  const zone = draft.currentZone ?? 'nowhere';
  const ground = (draft.guardian.ground[zone] ??= []);
  const cap = rules?.inventory.groundStacks ?? UNLIMITED;
  if (ground.length >= cap && !ground.some((s) => s.item === itemId))
    throw new ItemRuleError('no room on the ground');
  const taken = takeItem(draft, db, itemId, qty, 'pack', filter);
  let total = 0;
  for (const t of taken) {
    addToPile(ground, item, t.qty, t.potency);
    total += t.qty;
  }
  return [event('inventory/dropped', { item: itemId, qty: total, zone })];
}

/** Picks a ground stack of the current zone back up (as much as fits). */
export function pickUp(
  draft: WorldState,
  db: ContentDatabase,
  rules: ItemRules | null,
  itemId: string,
  potency: number | undefined,
): CoreEvent[] {
  const item = db.get('items', itemId);
  const zone = draft.currentZone ?? 'nowhere';
  const ground = draft.guardian.ground[zone] ?? [];
  const filter = filterOf(item, potency);
  const qty = countIn(ground, itemId, filter);
  if (qty === 0) throw new ItemRuleError('nothing there');
  const taken = removeFrom(ground, item, qty, filter);
  let picked = 0;
  for (const t of taken) {
    const rest = addToPack(
      draft.guardian.pack,
      db,
      packSlots(draft, db, rules),
      item,
      t.qty,
      t.potency,
    );
    if (rest > 0) addToPile(ground, item, rest, t.potency);
    picked += t.qty - rest;
  }
  if (ground.length === 0) {
    const { [zone]: _empty, ...others } = draft.guardian.ground;
    draft.guardian.ground = others;
  }
  if (picked === 0) throw new ItemRuleError('pack full');
  return [event('inventory/pickedUp', { item: itemId, qty: picked, zone })];
}

/**
 * Uses one unit of a carried item: returns its `useEffects` (addStat scaled by potency) for the
 * caller to apply.
 */
export function useItem(
  draft: WorldState,
  db: ContentDatabase,
  rules: ItemRules | null,
  itemId: string,
  potency: number | undefined,
): { events: CoreEvent[]; effects: Effect[] } {
  const item = db.get('items', itemId);
  if (!item.useEffects || item.useEffects.length === 0) throw new ItemRuleError('cannot be used');
  const filter = filterOf(item, potency);
  if (itemCount(draft, itemId, 'pack', filter) === 0) throw new ItemRuleError('not carried');
  const [taken] = takeItem(draft, db, itemId, 1, 'pack', filter);
  const p = taken ? potencyOf(item, taken) : 1;
  const scale = rules?.inventory.potencyScale[p - 1] ?? 1;
  const effects = item.useEffects.map((e): Effect =>
    'addStat' in e ? { ...e, value: Math.round(e.value * scale) } : e,
  );
  return {
    events: [
      event('inventory/itemRemoved', { item: itemId, qty: 1 }),
      event('inventory/used', { item: itemId, potency: p }),
    ],
    effects,
  };
}

/** Whispers of carried cursed objects for `hours` in-world hours (−6 × whisper per hour). */
export function whisper(
  draft: WorldState,
  db: ContentDatabase,
  rules: ItemRules | null,
  hours: number,
): CoreEvent[] {
  if (!rules || hours <= 0) return [];
  let loss = 0;
  for (const s of draft.guardian.pack) {
    const cursed = db.find('items', s.item)?.cursed;
    if (cursed) loss += (db.find('cursed-objects', cursed)?.whisper ?? 0) * 6 * hours;
  }
  if (loss === 0) return [];
  const stat = rules.inventory.whisperStat;
  const [from, to] = setStat(draft, db, stat, getStat(draft, db, stat) - loss);
  return from === to ? [] : [event('state/statChanged', { stat, from, to })];
}

/** In-world hour boundaries crossed between two moments. */
export function hoursCrossed(
  from: { day: number; minute: number },
  to: { day: number; minute: number },
): number {
  const a = Math.floor((from.day * 1440 + from.minute) / 60);
  const b = Math.floor((to.day * 1440 + to.minute) / 60);
  return Math.max(0, b - a);
}
