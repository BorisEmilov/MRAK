import type { LocaleKey } from '@mrak/content';
import { Game } from '@mrak/core';
import { describe, expect, it } from 'vitest';
import { loadContentDatabase } from '../../host/content';
import { t } from '../../i18n/t';
import {
  compareRows,
  effectsText,
  modifiersText,
  mortarCandidates,
  reasonKey,
  sortStacks,
  stackViews,
} from './items-ui';

const db = loadContentDatabase();
const name = (item: { nameKey: string }) => t(item.nameKey as LocaleKey);
const views = stackViews(
  [
    { item: 'firewood', qty: 4 },
    { item: 'yarrow', qty: 2, potency: 3 },
    { item: 'calming-tea', qty: 1 },
    { item: 'yarrow', qty: 1 },
  ],
  db,
  name,
);

describe('items ui', () => {
  it('stack views have stable unique keys and effective potency', () => {
    expect(views.map((v) => v.key)).toEqual(['firewood:', 'yarrow:3', 'calming-tea:', 'yarrow:']);
    expect(views.map((v) => v.potency)).toEqual([1, 3, 1, 1]);
  });

  it('sorts by kind, name, weight and strength without touching the core order', () => {
    expect(sortStacks(views, 'category').map((v) => v.item.category)).toEqual([
      'consumable',
      'herb',
      'herb',
      'material',
    ]);
    expect(sortStacks(views, 'weight')[0]?.item.id).toBe('firewood');
    expect(sortStacks(views, 'potency')[0]?.key).toBe('yarrow:3');
    const names = sortStacks(views, 'name').map((v) => v.name);
    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b)));
  });

  it('compares two items row by row and says which is better', () => {
    const [firewood, strong] = views;
    if (!firewood || !strong) throw new Error('views');
    const rows = compareRows(firewood, strong, t);
    expect(rows.find((r) => r.label === 'items.compare.row.weight')?.better).toBe('b');
    expect(rows.find((r) => r.label === 'items.compare.row.potency')?.better).toBe('b');
    expect(rows.find((r) => r.label === 'items.compare.row.slots')?.better).toBe('b');
  });

  it('words effects and modifiers with stat names', () => {
    expect(effectsText([{ addStat: 'sanity', value: 15 }], t, 1.5)).toBe('Sanity +23');
    expect(
      modifiersText(
        [
          { statBonus: 'notice', value: 5 },
          { multiply: 'debt-collection-rate', factor: 0.9 },
        ],
        t,
      ),
    ).toBe('Seen by demons +5, Debt collection ×0.9');
  });

  it('every stat used by a cursed object or a set has a name', () => {
    const stats = [
      ...db.all('cursed-objects').flatMap((c) => [...c.carried, ...c.displayed]),
      ...db.all('cabinet-sets').flatMap((s) => s.modifiers),
    ].flatMap((m) => ('statBonus' in m ? [m.statBonus] : 'multiply' in m ? [m.multiply] : []));
    for (const stat of stats) expect(t(`stat.${stat}.name` as LocaleKey), stat).toBeTruthy();
  });

  it('mortar candidates are everything at hand but tools and unique things', () => {
    const s = Game.newGame({ content: db, seed: 1 }).snapshot();
    const ids = mortarCandidates(s, db).map((c) => c.item.id);
    expect(ids).toContain('lamp-oil');
    expect(ids).toContain('garlic');
    expect(mortarCandidates(s, db).find((c) => c.item.id === 'lamp-oil')?.qty).toBe(8);
  });

  it('maps refusal reasons to words', () => {
    expect(reasonKey('pack full').key).toBe('items.reason.pack-full');
    expect(reasonKey('missing garlic')).toEqual({ key: 'items.reason.missing', item: 'garlic' });
    expect(reasonKey('something odd').key).toBe('items.reason.other');
  });
});
