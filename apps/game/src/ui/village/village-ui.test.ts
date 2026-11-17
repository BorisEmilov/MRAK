import type { VillagerView } from '@mrak/core';
import { describe, expect, it } from 'vitest';
import { affinityKey, bandOf, edgesOf, layoutCircle, matches, NEEDS } from './village-ui';

const view = (id: string, over: Partial<VillagerView> = {}): VillagerView => ({
  id,
  alive: true,
  status: 'healthy',
  possessed: false,
  fear: 10,
  hunger: 10,
  cold: 10,
  faith: 50,
  health: 100,
  tasks: { day: null, night: null },
  efficiency: {},
  activity: { activity: 'work', place: 'mill', task: null, routine: 'common' },
  secrets: [],
  death: null,
  affinity: {},
  ...over,
});

describe('village panel helpers', () => {
  it('needs are bands of words', () => {
    const fear = NEEDS.find((n) => n.id === 'fear');
    if (!fear) throw new Error('no fear');
    expect(bandOf(fear, 0)).toBe('village.band.calm');
    expect(bandOf(fear, 79)).toBe('village.band.afraid');
    expect(bandOf(fear, 100)).toBe('village.band.terrified');
  });

  it('filters', () => {
    expect(matches(view('a', { tasks: { day: 'food', night: null } }), 'working')).toBe(true);
    expect(matches(view('a'), 'idle')).toBe(true);
    expect(matches(view('a', { hunger: 80 }), 'needy')).toBe(true);
    expect(matches(view('a', { alive: false, status: 'dead' }), 'dead')).toBe(true);
    expect(matches(view('a', { alive: false, status: 'dead' }), 'idle')).toBe(false);
  });

  it('edges merge both directions and filter bonds, grudges and strength', () => {
    const views = [
      view('a', { affinity: { b: 80, c: -40 } }),
      view('b', { affinity: { a: 60 } }),
      view('c', { affinity: {} }),
    ];
    const all = edgesOf(views, 'all');
    expect(all).toEqual([
      { a: 'a', b: 'b', value: 70, ab: 80, ba: 60 },
      { a: 'a', b: 'c', value: -40, ab: -40, ba: undefined },
    ]);
    expect(edgesOf(views, 'bonds').map((e) => e.b)).toEqual(['b']);
    expect(edgesOf(views, 'grudges').map((e) => e.b)).toEqual(['c']);
    expect(edgesOf(views, 'all', 50).map((e) => e.b)).toEqual(['b']);
  });

  it('words for bonds and a stable circle layout', () => {
    expect(affinityKey(80)).toBe('village.bond.devoted');
    expect(affinityKey(-70)).toBe('village.bond.hateful');
    const nodes = layoutCircle([view('a'), view('b')]);
    expect(nodes[0]).toMatchObject({ id: 'a', x: 50 });
    expect(nodes[0]?.y).toBeCloseTo(12);
  });
});
