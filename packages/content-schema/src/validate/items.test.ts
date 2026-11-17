/** Validation of items, recipes, cursed objects and photo layers (inventory.md, alchemy.md). */
import { describe, expect, it } from 'vitest';
import type { RawPack } from '../pack';
import { codes, mutate, realPack } from '../test-helpers';

type Json = Record<string, unknown>;

function withoutItemRules(raw: RawPack): RawPack {
  return { ...raw, collections: { ...raw.collections, 'item-rules': [] } };
}

describe('item data', () => {
  it('the real pack is valid', () => {
    expect(codes(realPack())).toEqual([]);
  });

  it('every cursed object is embodied by exactly one unique item', () => {
    expect(codes(mutate(realPack(), 'items', 'rag-doll', (i) => (i['unique'] = false)))).toContain(
      'cursed-item',
    );
    expect(codes(mutate(realPack(), 'items', 'rag-doll', (i) => delete i['cursed']))).toContain(
      'cursed-item',
    );
  });

  it('recipes have distinct inputs, and no two recipes share them', () => {
    expect(
      codes(
        mutate(realPack(), 'recipes', 'mistletoe-charm', (r) => {
          r['inputs'] = [
            { item: 'mistletoe', qty: 1 },
            { item: 'mistletoe', qty: 1 },
          ];
        }),
      ),
    ).toContain('recipe-inputs');
    expect(
      codes(
        mutate(realPack(), 'recipes', 'mistletoe-charm', (r) => {
          r['inputs'] = [{ item: 'st-johns-wort', qty: 2 }];
        }),
      ),
    ).toContain('recipe-inputs');
  });

  it('photo layers point at real POIs', () => {
    expect(
      codes(
        mutate(realPack(), 'photo-layers', 'well-symbol', (l) => {
          (l['target'] as Json)['poi'] = 'nowhere';
        }),
      ),
    ).toContain('photo-layer-poi');
  });

  it('items need the item rules; the camera must be unique', () => {
    expect(codes(withoutItemRules(realPack()))).toContain('item-rules-missing');
    expect(
      codes(mutate(realPack(), 'items', 'daguerreotype-camera', (i) => (i['unique'] = false))),
    ).toContain('item-rules-camera');
  });

  it('gathering points use known items and well-formed dates', () => {
    expect(
      codes(
        mutate(realPack(), 'zones', 'samodivi-forest', (z) => {
          const poi = (z['pois'] as Json[]).find((p) => p['id'] === 'juniper') as Json;
          (poi['gather'] as Json)['item'] = 'unicorn-hair';
        }),
      ),
    ).toContain('unknown-item');
    expect(
      codes(
        mutate(realPack(), 'zones', 'samodivi-forest', (z) => {
          const poi = (z['pois'] as Json[]).find((p) => p['id'] === 'yarrow-meadow') as Json;
          (poi['gather'] as Json)['when'] = { date: { from: '13-01', to: '07-31' } };
        }),
      ),
    ).not.toEqual([]);
  });
});
