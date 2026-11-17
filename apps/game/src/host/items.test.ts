/**
 * Acceptance (docs/systems/inventory.md, alchemy.md, photography.md) with the real content: a
 * herb is there only on its dates, every recipe is found by combining its ingredients in the
 * mortar, and photographing a possessed villager shows the hidden sign.
 */
import { Game, itemCount, type Snapshot } from '@mrak/core';
import { describe, expect, it } from 'vitest';
import { loadContentDatabase } from './content';

const content = loadContentDatabase();

function at(year: number, month: number, day: number, minute = 600, zone = 'village'): Game {
  return Game.newGame(
    { content, seed: 1834 },
    { start: { year, month, day }, startMinute: minute, startZone: zone },
  );
}

describe('the start', () => {
  it('lantern oil in the pack, household supplies in the house store', () => {
    const s = Game.newGame({ content, seed: 1 }).snapshot();
    expect(itemCount(s, 'lamp-oil', 'pack')).toBe(4);
    expect(itemCount(s, 'lamp-oil', 'storage')).toBe(4);
    expect(itemCount(s, 'bread', 'storage')).toBe(8);
    expect(itemCount(s, 'bread', 'pack')).toBe(0);
    // The daguerreotype does not exist yet in 1834.
    expect(itemCount(s, 'daguerreotype-camera')).toBe(0);
  });
});

describe('gathering by date and moon', () => {
  const status = (g: Game, zone: string, poi: string) => g.gathering(zone)[poi];

  it('St John’s wort and yarrow grow in summer only', () => {
    expect(status(at(1835, 1, 10, 600, 'samodivi-forest'), 'samodivi-forest', 'herbs')).toBe(
      'season',
    );
    expect(status(at(1835, 6, 20, 600, 'samodivi-forest'), 'samodivi-forest', 'herbs')).toBe(
      'ready',
    );
    expect(
      status(at(1835, 7, 15, 600, 'samodivi-forest'), 'samodivi-forest', 'yarrow-meadow'),
    ).toBe('ready');
  });

  it('the fern blossoms only on the night before Enyovden', () => {
    const fern = (month: number, day: number, minute: number) =>
      status(at(1835, month, day, minute, 'samodivi-forest'), 'samodivi-forest', 'fern-hollow');
    expect(fern(6, 23, 23 * 60)).toBe('ready');
    expect(fern(6, 23, 12 * 60)).toBe('season');
    expect(fern(6, 25, 23 * 60)).toBe('season');
    expect(fern(1, 10, 23 * 60)).toBe('season');
  });

  it('mistletoe: winter months, and only while the moon grows', () => {
    const days = Array.from({ length: 31 }, (_, i) => i + 1).map((d) =>
      status(at(1835, 1, d, 600, 'samodivi-forest'), 'samodivi-forest', 'mistletoe-oak'),
    );
    expect(days).toContain('ready');
    expect(days).toContain('season');
    expect(
      status(at(1835, 5, 10, 600, 'samodivi-forest'), 'samodivi-forest', 'mistletoe-oak'),
    ).toBe('season');
  });

  it('gathering on Enyovden gives herbs twice as strong', () => {
    const g = at(1835, 6, 24, 10 * 60, 'samodivi-forest');
    const r = g.dispatch({ type: 'interactPoi', zone: 'samodivi-forest', poi: 'herbs' });
    expect(r.ok).toBe(true);
    expect(g.snapshot().guardian.pack).toContainEqual({
      item: 'st-johns-wort',
      qty: 2,
      potency: 2,
    });
  });
});

describe('recipes are discovered by combining', () => {
  it.each(content.all('recipes').map((r) => [r.id, r] as const))('%s', (_id, recipe) => {
    const base = at(1835, 1, 10).save();
    // Hidden recipes need their condition (a talent here).
    if (recipe.visibleWhen && 'talent' in recipe.visibleWhen) {
      const talent = recipe.visibleWhen.talent;
      const tree = content.all('trees').find((tr) => tr.nodes.some((n) => n.talent === talent));
      const cell = tree?.nodes.find((n) => n.talent === talent)?.cell;
      if (tree && cell) base.state.guardian.talents.push(`${tree.id}/${cell}`);
    }
    for (const i of recipe.inputs) base.state.guardian.storage.push({ item: i.item, qty: i.qty });
    const g = Game.load(base, { content });
    expect(g.snapshot().guardian.unlockedRecipes).not.toContain(recipe.id);
    const r = g.dispatch({
      type: 'grind',
      ingredients: recipe.inputs.map((i) => ({ item: i.item, qty: i.qty })),
    });
    expect(r.events).toContainEqual({ type: 'alchemy/discovered', payload: { recipe: recipe.id } });
    expect(g.snapshot().guardian.unlockedRecipes).toContain(recipe.id);
  });
});

describe('the daguerreotype', () => {
  it('photographing a possessed villager shows the hidden sign', () => {
    const g = at(1858, 5, 10, 11 * 60);
    g.dispatch({
      type: 'applyEffects',
      effects: [
        { giveItem: 'daguerreotype-camera', qty: 1 },
        { giveItem: 'photographic-plate', qty: 3 },
        { startPossession: 'mamnik', host: 'velika' },
      ],
    });
    const layers = (s: Snapshot) => s.collection.album.at(-1)?.layers ?? [];
    expect(g.dispatch({ type: 'takePhotograph', subject: { villager: 'krastyo' } }).ok).toBe(true);
    expect(layers(g.snapshot())).toEqual([]);
    expect(g.dispatch({ type: 'takePhotograph', subject: { villager: 'velika' } }).ok).toBe(true);
    expect(layers(g.snapshot())).toEqual(['possessed-second-face', 'mamnik-veil']);
    // The demon's sign gives a clue; the village still knows nothing.
    expect(g.snapshot().mysteries['wasting-bride']?.clues).toContain('m1-name');
    expect(g.snapshot().possessions[0]?.revealed).toBe(false);
  });
});
