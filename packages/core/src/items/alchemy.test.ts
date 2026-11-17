import { describe, expect, it } from 'vitest';
import { Game } from '../game';
import { effectiveStat } from '../state/stats';
import { fixtureDb } from '../test/fixture';
import { hintFor, matchRecipe, triedBefore } from './alchemy';
import { itemCount } from './inventory';

function home(): Game {
  return Game.newGame(
    { content: fixtureDb, seed: 4 },
    { start: { year: 1835, month: 1, day: 10 }, startMinute: 600, startZone: 'village' },
  );
}

const store = (g: Game, item: string, qty: number) =>
  g.dispatch({ type: 'applyEffects', effects: [{ giveItem: item, qty, to: 'storage' }] });

describe('the mortar', () => {
  it('every recipe is found by grinding exactly its inputs, in any order', () => {
    for (const recipe of fixtureDb.all('recipes')) {
      const g = home();
      if (recipe.visibleWhen)
        g.dispatch({ type: 'applyEffects', effects: [{ setFlag: 'witch-allied' }] });
      for (const i of recipe.inputs) store(g, i.item, i.qty);
      const ingredients = [...recipe.inputs].reverse().map((i) => ({ item: i.item, qty: i.qty }));
      const r = g.dispatch({ type: 'grind', ingredients });
      expect(r.ok, recipe.id).toBe(true);
      expect(r.events).toContainEqual({
        type: 'alchemy/discovered',
        payload: { recipe: recipe.id },
      });
      expect(g.snapshot().guardian.unlockedRecipes).toContain(recipe.id);
      for (const out of recipe.outputs)
        expect(itemCount(g.snapshot(), out.item, 'storage')).toBeGreaterThanOrEqual(out.qty);
    }
  });

  it('a wrong combination fails, consumes the ingredients and is written in the journal', () => {
    const g = home();
    store(g, 'garlic', 2);
    store(g, 'bread', 1);
    const before = g.snapshot().clock.minute;
    const r = g.dispatch({
      type: 'grind',
      ingredients: [
        { item: 'garlic', qty: 2 },
        { item: 'bread', qty: 1 },
      ],
    });
    expect(r.ok).toBe(true);
    expect(r.events).toContainEqual({ type: 'alchemy/failed', payload: { hint: 'kindred' } });
    expect(itemCount(g.snapshot(), 'garlic')).toBe(0);
    expect(g.snapshot().clock.minute).toBe(before + 15);
    expect(g.snapshot().alchemy.attempts).toEqual([
      expect.objectContaining({
        ingredients: [
          { item: 'garlic', qty: 2 },
          { item: 'bread', qty: 1 },
        ],
        recipe: null,
        hint: 'kindred',
      }),
    ]);
    expect(
      triedBefore(g.snapshot(), [
        { item: 'bread', qty: 1 },
        { item: 'garlic', qty: 2 },
      ]),
    ).toBe(true);
  });

  it('hints: too much, something missing, a familiar smell, nothing', () => {
    const recipes = fixtureDb.all('recipes').filter((r) => !r.visibleWhen);
    expect(hintFor(recipes, [{ item: 'yarrow', qty: 3 }])).toBe('excess');
    expect(hintFor(recipes, [{ item: 'garlic', qty: 2 }])).toBe('missing');
    expect(
      hintFor(recipes, [
        { item: 'garlic', qty: 9 },
        { item: 'lamp-oil', qty: 1 },
      ]),
    ).toBe('excess');
    expect(hintFor(recipes, [{ item: 'red-thread', qty: 2 }])).toBe('kindred');
    expect(hintFor(recipes, [{ item: 'bread', qty: 1 }])).toBe('nothing');
    expect(matchRecipe(recipes, [{ item: 'garlic', qty: 3 }])?.id).toBe('braid');
  });

  it('a hidden recipe does not match until its condition holds; dark brews add corruption', () => {
    const g = home();
    store(g, 'incense', 4);
    const fail = g.dispatch({ type: 'grind', ingredients: [{ item: 'incense', qty: 2 }] });
    expect(fail.events).toContainEqual({ type: 'alchemy/failed', payload: { hint: 'nothing' } });
    g.dispatch({ type: 'applyEffects', effects: [{ setFlag: 'witch-allied' }] });
    const corruption = effectiveStat(g.snapshot(), fixtureDb, 'corruption');
    const ok = g.dispatch({ type: 'grind', ingredients: [{ item: 'incense', qty: 2 }] });
    expect(ok.events).toContainEqual({
      type: 'alchemy/discovered',
      payload: { recipe: 'dark-incense' },
    });
    expect(effectiveStat(g.snapshot(), fixtureDb, 'corruption')).toBe(corruption + 3);
  });

  it('potency raises doses (max +2) and brews keep it', () => {
    // Two potency-3 yarrow in the store (as gathered at dawn on Enyovden).
    const draft = home().save();
    draft.state.guardian.storage.push({ item: 'yarrow', qty: 2, potency: 3 });
    const loaded = Game.load(draft, { content: fixtureDb });
    const r = loaded.dispatch({ type: 'grind', ingredients: [{ item: 'yarrow', qty: 2 }] });
    expect(r.events).toContainEqual({
      type: 'alchemy/brewed',
      payload: { recipe: 'brew-tea', doses: 3, potency: 3 },
    });
    expect(loaded.snapshot().guardian.storage).toContainEqual({ item: 'tea', qty: 3, potency: 3 });
    // Potency 3 tea restores twice as much.
    loaded.dispatch({ type: 'moveItem', item: 'tea', qty: 1, to: 'pack' });
    const sanity = effectiveStat(loaded.snapshot(), fixtureDb, 'sanity');
    loaded.dispatch({ type: 'useItem', item: 'tea' });
    expect(effectiveStat(loaded.snapshot(), fixtureDb, 'sanity')).toBe(sanity + 20);
  });

  it('takes from the store first, then the pack; brewing passes the recipe time', () => {
    const g = home();
    store(g, 'yarrow', 1);
    g.dispatch({ type: 'applyEffects', effects: [{ giveItem: 'yarrow', qty: 3 }] });
    const before = g.snapshot().clock.minute;
    g.dispatch({ type: 'grind', ingredients: [{ item: 'yarrow', qty: 2 }] });
    expect(itemCount(g.snapshot(), 'yarrow', 'storage')).toBe(0);
    expect(itemCount(g.snapshot(), 'yarrow', 'pack')).toBe(2);
    expect(g.snapshot().clock.minute).toBe(before + 60);
  });

  it('is refused away from home, with missing ingredients, or with an item twice', () => {
    const g = home();
    expect(g.dispatch({ type: 'grind', ingredients: [{ item: 'garlic', qty: 1 }] })).toMatchObject({
      ok: false,
      reason: 'missing garlic',
    });
    store(g, 'garlic', 2);
    expect(
      g.dispatch({
        type: 'grind',
        ingredients: [
          { item: 'garlic', qty: 1 },
          { item: 'garlic', qty: 1 },
        ],
      }),
    ).toMatchObject({ ok: false, reason: 'an ingredient appears twice' });
    g.dispatch({ type: 'enterZone', zone: 'forest' });
    expect(g.dispatch({ type: 'grind', ingredients: [{ item: 'garlic', qty: 1 }] })).toMatchObject({
      ok: false,
      reason: 'not at home',
    });
    expect(itemCount(g.snapshot(), 'garlic')).toBe(2);
  });

  it('the journal keeps the newest attempts only', () => {
    const g = home();
    store(g, 'bread', 20);
    for (let i = 0; i < 12; i++)
      g.dispatch({ type: 'grind', ingredients: [{ item: 'bread', qty: 1 }] });
    expect(g.snapshot().alchemy.attempts).toHaveLength(10);
  });
});
