/**
 * Pure helpers of the belongings panel (docs/systems/inventory.md, alchemy.md, collection.md):
 * sorting, item details and comparison rows, effect and modifier wording, mortar candidates.
 */
import type { LocaleKey } from '@mrak/content';
import type { Effect, Item, Modifier } from '@mrak/content-schema';
import { potencyOf, type ContentDatabase, type Snapshot, type Stack } from '@mrak/core';
import type { IconName } from '@mrak/ui-kit';

export type Translate = (
  key: LocaleKey,
  params?: Readonly<Record<string, string | number>>,
) => string;

export const SORTS = ['category', 'name', 'weight', 'potency'] as const;
export type SortKey = (typeof SORTS)[number];

const CATEGORY_ORDER: readonly Item['category'][] = [
  'consumable',
  'ritual',
  'herb',
  'material',
  'tool',
  'relic',
  'ammo',
  'quest',
];

export interface StackView {
  /** Stable React key: item + potency. */
  key: string;
  stack: Stack;
  item: Item;
  name: string;
  potency: number;
}

export function stackViews(
  stacks: readonly Readonly<Stack>[],
  db: ContentDatabase,
  name: (item: Item) => string,
): StackView[] {
  const seen = new Map<string, number>();
  return stacks.flatMap((stack) => {
    const item = db.find('items', stack.item);
    if (!item) return [];
    const base = `${stack.item}:${String(stack.potency ?? '')}`;
    const n = seen.get(base) ?? 0;
    seen.set(base, n + 1);
    return [
      {
        key: n === 0 ? base : `${base}#${String(n)}`,
        stack: { ...stack },
        item,
        name: name(item),
        potency: potencyOf(item, stack),
      },
    ];
  });
}

/** Sorted copy (presentation only; the core keeps insertion order). */
export function sortStacks(views: readonly StackView[], by: SortKey): StackView[] {
  const byName = (a: StackView, b: StackView) => a.name.localeCompare(b.name);
  const compare: Record<SortKey, (a: StackView, b: StackView) => number> = {
    category: (a, b) =>
      CATEGORY_ORDER.indexOf(a.item.category) - CATEGORY_ORDER.indexOf(b.item.category) ||
      byName(a, b),
    name: byName,
    weight: (a, b) => b.item.weight * b.stack.qty - a.item.weight * a.stack.qty || byName(a, b),
    potency: (a, b) => b.potency - a.potency || byName(a, b),
  };
  return [...views].sort(compare[by]);
}

export function potencyKey(potency: number): LocaleKey {
  return potency >= 3 ? 'items.potency.3' : potency === 2 ? 'items.potency.2' : 'items.potency.1';
}

function signed(value: number): string {
  return value > 0 ? `+${String(value)}` : String(value);
}

const statName = (t: Translate, stat: string): string => t(`stat.${stat}.name` as LocaleKey);

/** "Sanity +15, Corruption +2" — the numeric effects of using an item (others: "something more"). */
export function effectsText(effects: readonly Effect[], t: Translate, scale = 1): string {
  const parts = effects.map((e) =>
    'addStat' in e
      ? t('items.effect.stat', {
          stat: statName(t, e.addStat),
          value: signed(Math.round(e.value * scale)),
        })
      : t('items.effect.other'),
  );
  return [...new Set(parts)].join(', ');
}

/** "Notice +5, Debt collection ×0.9" — passive modifiers in words. */
export function modifiersText(mods: readonly Modifier[], t: Translate): string {
  return mods
    .map((m) => {
      if ('statBonus' in m)
        return t('items.mod.bonus', { stat: statName(t, m.statBonus), value: signed(m.value) });
      if ('multiply' in m)
        return t('items.mod.multiply', { stat: statName(t, m.multiply), factor: m.factor });
      if ('fateDice' in m) return t('items.mod.dice', { value: signed(m.fateDice) });
      if ('shadowDice' in m) return t('items.mod.dice', { value: signed(-m.shadowDice) });
      return t('items.mod.omen');
    })
    .join(', ');
}

export interface CompareRow {
  label: LocaleKey;
  a: string;
  b: string;
  /** Which side is better for this row (undefined = not comparable). */
  better?: 'a' | 'b' | undefined;
}

/** Rows comparing two stacks (weight, strength, stacking, slots, kind, use). */
export function compareRows(a: StackView, b: StackView, t: Translate): CompareRow[] {
  const none = t('items.compare.none');
  const tags = (v: StackView) =>
    v.item.tags.map((tag) => t(`items.tag.${tag}` as LocaleKey)).join(', ') || none;
  const usage = (v: StackView, scale: number) =>
    v.item.useEffects?.length ? effectsText(v.item.useEffects, t, scale) : none;
  const lower = (x: number, y: number) => (x === y ? undefined : x < y ? 'a' : 'b');
  const higher = (x: number, y: number) => (x === y ? undefined : x > y ? 'a' : 'b');
  return [
    {
      label: 'items.compare.row.weight',
      a: String(a.item.weight),
      b: String(b.item.weight),
      better: lower(a.item.weight, b.item.weight),
    },
    {
      label: 'items.compare.row.potency',
      a: t(potencyKey(a.potency)),
      b: t(potencyKey(b.potency)),
      better: higher(a.potency, b.potency),
    },
    {
      label: 'items.compare.row.stack',
      a: String(a.item.unique ? 1 : a.item.stackSize),
      b: String(b.item.unique ? 1 : b.item.stackSize),
      better: higher(a.item.stackSize, b.item.stackSize),
    },
    {
      label: 'items.compare.row.slots',
      a: String(a.item.slotSize),
      b: String(b.item.slotSize),
      better: lower(a.item.slotSize, b.item.slotSize),
    },
    { label: 'items.compare.row.tags', a: tags(a), b: tags(b) },
    { label: 'items.compare.row.effects', a: usage(a, 1), b: usage(b, 1) },
  ];
}

/** Items that can go into the mortar: everything at hand (store + pack), by item. */
export function mortarCandidates(
  snapshot: Snapshot,
  db: ContentDatabase,
): { item: Item; qty: number }[] {
  const totals = new Map<string, number>();
  for (const s of [...snapshot.guardian.storage, ...snapshot.guardian.pack])
    totals.set(s.item, (totals.get(s.item) ?? 0) + s.qty);
  return [...totals.entries()].flatMap(([id, qty]) => {
    const item = db.find('items', id);
    // Tools, unique things and the camera's plates are never ground.
    const plate = db.find('item-rules', 'default')?.photography.plate;
    return item && !item.unique && item.category !== 'tool' && item.id !== plate
      ? [{ item, qty }]
      : [];
  });
}

export function itemIcon(item: Item): IconName {
  return item.icon as IconName;
}

/** Locale key of a command refusal reason from the item systems. */
export function reasonKey(reason: string): { key: LocaleKey; item?: string } {
  if (reason.startsWith('missing ')) return { key: 'items.reason.missing', item: reason.slice(8) };
  const map: Record<string, LocaleKey> = {
    'not at home': 'items.reason.not-at-home',
    'pack full': 'items.reason.pack-full',
    'nothing to move': 'items.reason.nothing-to-move',
    'it will not leave your hand': 'items.reason.clings',
    'not carried': 'items.reason.not-carried',
    'no room on the ground': 'items.reason.no-room',
    'cannot be used': 'items.reason.cannot-use',
    'nothing there': 'items.reason.nothing-there',
    'no camera': 'items.reason.no-camera',
    'no plates': 'items.reason.no-plates',
    'album full': 'items.reason.album-full',
    'not here': 'items.reason.not-here',
    'cabinet full': 'items.reason.cabinet-full',
    'already displayed': 'items.reason.already-displayed',
    'not a cursed object': 'items.reason.not-cursed',
    'not owned': 'items.reason.not-owned',
    'wrong number of ingredients': 'items.reason.ingredients',
    'an ingredient appears twice': 'items.reason.ingredients',
    'too much of one ingredient': 'items.reason.ingredients',
  };
  return { key: map[reason] ?? 'items.reason.other' };
}
