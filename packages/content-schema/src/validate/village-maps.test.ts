/** Validation of village data (villagers.md, tasks.md) and of zone maps (maps.md). */
import { describe, expect, it } from 'vitest';
import type { RawPack } from '../pack';
import { codes, errorsOf, mutate, realPack } from '../test-helpers';

type Json = Record<string, unknown>;

function village(raw: RawPack, fn: (rules: Json) => void): RawPack {
  return mutate(raw, 'village-rules', 'default', fn);
}

function mapObjects(raw: RawPack, path: string): Json[] {
  const map = raw.maps?.maps[path] as { layers: { type: string; objects?: Json[] }[] };
  const layer = map.layers.find((l) => l.type === 'objectgroup');
  if (!layer?.objects) throw new Error('no object layer');
  return layer.objects;
}

describe('village data', () => {
  it('rejects a home that is not a house POI of the village', () => {
    expect(
      codes(mutate(realPack(), 'villagers', 'velika', (v) => (v['home'] = 'nowhere'))),
    ).toContain('village-place');
    expect(
      codes(mutate(realPack(), 'villagers', 'velika', (v) => (v['home'] = 'tavern'))),
    ).toContain('villager-home');
  });

  it('rejects an unknown trait, routine or task place', () => {
    expect(
      codes(mutate(realPack(), 'villagers', 'velika', (v) => (v['traits'] = ['flying']))),
    ).toContain('unknown-trait');
    expect(
      codes(mutate(realPack(), 'villagers', 'velika', (v) => (v['routine'] = 'sunday'))),
    ).toContain('villager-routine');
    expect(codes(mutate(realPack(), 'tasks', 'firewood', (t) => (t['place'] = 'moon')))).toContain(
      'village-place',
    );
  });

  it('rejects routine blocks out of order and filters on a base routine', () => {
    const unordered = mutate(realPack(), 'routines', 'common', (r) => {
      (r['blocks'] as Json[]).reverse();
    });
    expect(codes(unordered)).toContain('routine-order');
    const filtered = mutate(realPack(), 'routines', 'common', (r) => {
      r['days'] = [0];
    });
    expect(codes(filtered)).toContain('routine-base-filter');
  });

  it('rejects a day task without output and rules pointing at unknown places', () => {
    expect(codes(mutate(realPack(), 'tasks', 'garlic', (t) => (t['output'] = [])))).toContain(
      'task-no-output',
    );
    const rules = village(realPack(), (r) => {
      (r['death'] as Json)['grave'] = 'nowhere';
    });
    expect(codes(rules)).toContain('village-place');
  });

  it('needs the village rules when there are villagers', () => {
    const raw = realPack();
    raw.collections['village-rules'] = [];
    expect(codes(raw)).toContain('village-rules-missing');
  });
});

describe('zone maps', () => {
  it('requires the default spawn', () => {
    const raw = realPack();
    const objects = mapObjects(raw, 'maps/village.tmj');
    const spawn = objects.find((o) => o['type'] === 'spawn' && o['name'] === 'default');
    if (spawn) spawn['name'] = 'elsewhere';
    expect(codes(raw)).toContain('map-spawn');
  });

  it('rejects an unknown object type and a POI placed twice', () => {
    const raw = realPack();
    const objects = mapObjects(raw, 'maps/village.tmj');
    const poi = objects.find((o) => o['type'] === 'poi' && o['name'] === 'well');
    if (!poi) throw new Error('setup');
    objects.push({ ...poi, id: 9001 }, { ...poi, id: 9002, type: 'treasure' });
    const found = codes(raw);
    expect(found).toContain('map-poi');
    expect(found).toContain('map-object-type');
  });

  it('rejects an exit to an unknown spawn and a variant the zone lacks', () => {
    const raw = realPack();
    const objects = mapObjects(raw, 'maps/village.tmj');
    const exit = objects.find((o) => o['type'] === 'exit');
    const props = exit?.['properties'] as { name: string; value: unknown }[] | undefined;
    const spawn = props?.find((p) => p.name === 'spawn');
    if (spawn) spawn.value = 'nowhere';
    const light = objects.find((o) => o['type'] === 'light');
    if (light)
      light['properties'] = [
        ...((light['properties'] as Json[] | undefined) ?? []),
        { name: 'variants', type: 'string', value: 'atlantis' },
      ];
    const found = codes(raw);
    expect(found).toContain('map-exit');
    expect(found).toContain('map-variant');
  });

  it('rejects a missing map file', () => {
    const raw = realPack();
    if (raw.maps) delete raw.maps.maps['maps/monastery.tmj'];
    expect(errorsOf(raw).some((i) => i.code === 'map-missing')).toBe(true);
  });
});
