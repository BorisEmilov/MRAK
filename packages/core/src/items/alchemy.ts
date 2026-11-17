/**
 * The mortar: recipes discovered by experiment (docs/systems/alchemy.md → Implementation).
 */
import type { Condition, ItemRules, Recipe } from '@mrak/content-schema';
import type { ContentDatabase } from '../content/database';
import { event, type CoreEvent } from '../events';
import type { AlchemyHint, WorldState } from '../state/world-state';
import { giveItem, itemCount, takeItem } from './inventory';
import { atHome, ItemRuleError, normalPotency, potencyOf, type ReadState } from './rules';

export interface Ingredient {
  item: string;
  qty: number;
  /** Effective potency to use (1–3); omitted = any, lowest first. */
  potency?: number | undefined;
}

type Bag = ReadonlyMap<string, number>;

function bagOf(list: readonly { item: string; qty: number }[]): Map<string, number> {
  const bag = new Map<string, number>();
  for (const i of list) bag.set(i.item, (bag.get(i.item) ?? 0) + i.qty);
  return bag;
}

/** Every unit of `a` is in `b`. */
function within(a: Bag, b: Bag): boolean {
  for (const [item, qty] of a) if ((b.get(item) ?? 0) < qty) return false;
  return true;
}

function equal(a: Bag, b: Bag): boolean {
  return a.size === b.size && within(a, b);
}

/** Recipes the mortar can find now (their `visibleWhen` holds). */
export function visibleRecipes(db: ContentDatabase, evaluate: (c: Condition) => boolean): Recipe[] {
  return db.all('recipes').filter((r) => !r.visibleWhen || evaluate(r.visibleWhen));
}

/** The recipe whose inputs are exactly these ingredients, if any. */
export function matchRecipe(
  recipes: readonly Recipe[],
  ingredients: readonly { item: string; qty: number }[],
): Recipe | null {
  const bag = bagOf(ingredients);
  return recipes.find((r) => equal(bagOf(r.inputs), bag)) ?? null;
}

/** Hint of a failed attempt (rule 4), never naming the recipe. */
export function hintFor(
  recipes: readonly Recipe[],
  ingredients: readonly { item: string; qty: number }[],
): AlchemyHint {
  const bag = bagOf(ingredients);
  const bags = recipes.map((r) => bagOf(r.inputs));
  if (bags.some((r) => within(r, bag))) return 'excess';
  if (bags.some((r) => within(bag, r))) return 'missing';
  if (bags.some((r) => [...bag.keys()].some((item) => r.has(item)))) return 'kindred';
  return 'nothing';
}

export interface GrindResult {
  events: CoreEvent[];
  /** In-world minutes the work takes (the caller passes the time). */
  minutes: number;
  recipe: Recipe | null;
  /** Items found for the first time (cursed objects' effects are the caller's). */
  firstFound: string[];
}

/** Grinds ingredients in the mortar (rules 1–4). */
export function grind(
  draft: WorldState,
  db: ContentDatabase,
  rules: ItemRules,
  ingredients: readonly Ingredient[],
  evaluate: (c: Condition) => boolean,
): GrindResult {
  if (!atHome(draft, rules)) throw new ItemRuleError('not at home');
  const { maxIngredients, maxQty } = rules.alchemy;
  if (ingredients.length === 0 || ingredients.length > maxIngredients)
    throw new ItemRuleError('wrong number of ingredients');
  if (new Set(ingredients.map((i) => i.item)).size !== ingredients.length)
    throw new ItemRuleError('an ingredient appears twice');
  for (const i of ingredients) {
    if (i.qty < 1 || i.qty > maxQty) throw new ItemRuleError('too much of one ingredient');
    const item = db.get('items', i.item);
    const filter = i.potency === undefined ? 'any' : normalPotency(item, i.potency);
    if (itemCount(draft, i.item, 'any', filter) < i.qty)
      throw new ItemRuleError(`missing ${i.item}`);
  }

  // Store first, then the pack.
  const units: number[] = [];
  for (const i of ingredients) {
    const item = db.get('items', i.item);
    const filter = i.potency === undefined ? 'any' : normalPotency(item, i.potency);
    const fromStore = Math.min(i.qty, itemCount(draft, i.item, 'storage', filter));
    const taken = [
      ...takeItem(draft, db, i.item, fromStore, 'storage', filter),
      ...takeItem(draft, db, i.item, i.qty - fromStore, 'pack', filter),
    ];
    for (const t of taken) for (let n = 0; n < t.qty; n++) units.push(potencyOf(item, t));
  }
  const events: CoreEvent[] = ingredients.map((i) =>
    event('inventory/itemRemoved', { item: i.item, qty: i.qty }),
  );
  const at = { day: draft.clock.day, minute: draft.clock.minute };
  const recipes = visibleRecipes(db, evaluate);
  const recipe = matchRecipe(recipes, ingredients);
  const attempts = draft.alchemy.attempts;
  const logged = ingredients.map((i) => ({ item: i.item, qty: i.qty }));
  const firstFound: string[] = [];

  if (!recipe) {
    const hint = hintFor(recipes, ingredients);
    attempts.push({ ...at, ingredients: logged, recipe: null, hint });
    if (attempts.length > rules.alchemy.journalSize)
      attempts.splice(0, attempts.length - rules.alchemy.journalSize);
    events.push(event('alchemy/failed', { hint }));
    return { events, minutes: rules.alchemy.failMinutes, recipe: null, firstFound };
  }

  const potency = Math.min(
    3,
    Math.max(1, Math.round(units.reduce((a, b) => a + b, 0) / Math.max(1, units.length))),
  );
  const extra = Math.min(2, potency - 1);
  let doses = 0;
  recipe.outputs.forEach((out, index) => {
    const item = db.get('items', out.item);
    const qty = out.qty + (index === 0 ? extra : 0);
    doses += qty;
    const brew = item.useEffects !== undefined && item.useEffects.length > 0;
    const given = giveItem(draft, db, rules, out.item, qty, {
      to: 'storage',
      ...(brew ? { potency } : {}),
    });
    events.push(...given.events);
    if (given.firstFound) firstFound.push(out.item);
  });
  if (!draft.guardian.unlockedRecipes.includes(recipe.id)) {
    draft.guardian.unlockedRecipes.push(recipe.id);
    events.push(event('alchemy/discovered', { recipe: recipe.id }));
    events.push(event('unlock/recipe', { recipe: recipe.id }));
  }
  attempts.push({ ...at, ingredients: logged, recipe: recipe.id, hint: null });
  if (attempts.length > rules.alchemy.journalSize)
    attempts.splice(0, attempts.length - rules.alchemy.journalSize);
  events.push(event('alchemy/brewed', { recipe: recipe.id, doses, potency }));
  return { events, minutes: recipe.minutes, recipe, firstFound };
}

/** Was this exact combination already written in the journal of experiments? */
export function triedBefore(
  state: ReadState,
  ingredients: readonly { item: string; qty: number }[],
): boolean {
  const bag = bagOf(ingredients);
  return state.alchemy.attempts.some((a) => equal(bagOf(a.ingredients), bag));
}
