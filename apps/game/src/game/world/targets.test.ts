import { describe, expect, it } from 'vitest';
import { interactable, nearestTarget, photoSubject, type PoiAt } from './targets';

const poi = (id: string, x: number, gather = false): PoiAt => ({
  def: {
    id,
    kind: gather ? 'herbs' : 'well',
    nameKey: `poi.${id}`,
    action: gather ? 'gather' : 'use',
    effects: [],
    once: !gather,
    ...(gather
      ? { gather: { item: 'yarrow', qty: 1, potency: 1, regrowDays: 1, tint: '#ffffff' } }
      : {}),
  },
  x,
  y: 0,
});

describe('targets', () => {
  it('a gathering point is offered only when ready', () => {
    const herb = poi('meadow', 0, true).def;
    expect(interactable(herb, { meadow: 'ready' })).toBe(true);
    expect(interactable(herb, { meadow: 'season' })).toBe(false);
    expect(interactable(herb, { meadow: 'regrowing' })).toBe(false);
    expect(interactable(poi('well', 0).def, {})).toBe(true);
  });

  it('picks the nearest target in reach; out-of-season plants are skipped', () => {
    const pois = [poi('meadow', 5, true), poi('well', 12)];
    const villagers = [{ id: 'velika', nameKey: 'v', x: 20, y: 0 }];
    expect(nearestTarget({ x: 0, y: 0 }, pois, villagers, { meadow: 'ready' }, 24)).toMatchObject({
      kind: 'poi',
      poi: { def: { id: 'meadow' } },
    });
    expect(nearestTarget({ x: 0, y: 0 }, pois, villagers, { meadow: 'season' }, 24)).toMatchObject({
      kind: 'poi',
      poi: { def: { id: 'well' } },
    });
    expect(nearestTarget({ x: 19, y: 0 }, pois, villagers, {}, 24)).toMatchObject({
      kind: 'villager',
    });
    expect(nearestTarget({ x: 100, y: 0 }, pois, villagers, {}, 24)).toBeNull();
  });

  it('the camera prefers a villager, then a place, then the zone', () => {
    const pois = [poi('well', 30)];
    const villagers = [{ id: 'velika', nameKey: 'v', x: 50, y: 0 }];
    expect(photoSubject({ x: 45, y: 0 }, 'village', pois, villagers, 64)).toEqual({
      villager: 'velika',
    });
    expect(photoSubject({ x: 0, y: 0 }, 'village', pois, [], 64)).toEqual({
      zone: 'village',
      poi: 'well',
    });
    expect(photoSubject({ x: 500, y: 0 }, 'village', pois, villagers, 64)).toEqual({
      zone: 'village',
    });
  });
});
