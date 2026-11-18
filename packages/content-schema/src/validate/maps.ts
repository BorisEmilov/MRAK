/**
 * Zone maps against zone data (docs/systems/maps.md). Runs only when the raw pack carries maps
 * (Node tooling); the browser bundle validates data without them.
 */
import {
  LIGHT_KINDS,
  MAP_OBJECT_TYPES,
  MAP_TERRAINS,
  objectsOf,
  objectType,
  prop,
  REQUIRED_LAYERS,
  TiledMap,
  variantsOf,
} from '../tiled';
import type { Zone } from '../entities/world';
import type { ContentPack, RawMaps, SourceMap } from '../pack';
import type { IssueList } from './issues';

/**
 * Fixed lights per map: Phaser renders ≤ 32 per camera (apps/game config); the lantern, its spill
 * and night effects need the rest (docs/systems/performance.md → Light budget).
 */
export const MAP_LIGHT_BUDGET = 24;

const KNOWN_TYPES = new Set<string>(MAP_OBJECT_TYPES);
const KNOWN_LIGHTS = new Set<string>(LIGHT_KINDS);
const KNOWN_TERRAINS = new Set<string>(MAP_TERRAINS);

function mapPaths(zone: Zone): string[] {
  return [...new Set([zone.map, ...zone.variants.flatMap((v) => (v.map ? [v.map] : []))])];
}

function dirOf(path: string): string {
  const i = path.lastIndexOf('/');
  return i < 0 ? '' : path.slice(0, i + 1);
}

/** Normalizes "a/b/../c" → "a/c". */
function normalize(path: string): string {
  const out: string[] = [];
  for (const part of path.split('/')) {
    if (part === '..') out.pop();
    else if (part !== '.' && part !== '') out.push(part);
  }
  return out.join('/');
}

export function validateMaps(
  pack: ContentPack,
  sources: SourceMap,
  raw: RawMaps,
  issues: IssueList,
): void {
  const parsed = new Map<string, TiledMap>();
  for (const zone of pack.zones) {
    for (const path of mapPaths(zone)) {
      if (parsed.has(path)) continue;
      const data = raw.maps[path];
      if (data === undefined) {
        issues.error('map-missing', `map "${path}" of zone "${zone.id}" not found`, {
          file: sources.zones?.[zone.id],
          entity: `zones/${zone.id}`,
        });
        continue;
      }
      const result = TiledMap.safeParse(data);
      if (!result.success) {
        const issue = result.error.issues[0];
        issues.error(
          'map-invalid',
          `${issue?.path.join('.') ?? ''}: ${issue?.message ?? 'invalid Tiled map'}`,
          { file: path },
        );
        continue;
      }
      parsed.set(path, result.data);
    }
  }

  const zones = new Map(pack.zones.map((z) => [z.id, z]));
  const spawnsOf = (zoneId: string): Set<string> => {
    const zone = zones.get(zoneId);
    const map = zone ? parsed.get(zone.map) : undefined;
    return new Set(
      map
        ? objectsOf(map)
            .filter((o) => objectType(o) === 'spawn')
            .map((o) => o.name)
        : [],
    );
  };
  const links = new Map<string, Set<string>>();

  for (const zone of pack.zones) {
    const variants = new Set(zone.variants.map((v) => v.id));
    const pois = new Set(zone.pois.map((p) => p.id));
    const edges = new Set(zone.paths.edges.map((e) => e.id));
    for (const path of mapPaths(zone)) {
      const map = parsed.get(path);
      if (!map) continue;
      const where = { file: path, entity: `zones/${zone.id}` };
      const err = (code: string, message: string): void => {
        issues.error(code, message, where);
      };

      const names = new Set(map.layers.map((l) => l.name));
      for (const layer of REQUIRED_LAYERS)
        if (!names.has(layer)) err('map-layer-missing', `missing layer "${layer}"`);
      for (const layer of map.layers) {
        if (layer.name === 'objects' && layer.type !== 'objectgroup')
          err('map-layer-type', 'layer "objects" must be an object layer');
        if (layer.name !== 'objects' && layer.type !== 'tilelayer')
          err('map-layer-type', `layer "${layer.name}" must be a tile layer`);
        if (layer.type === 'tilelayer' && layer.data.length !== map.width * map.height)
          err('map-layer-size', `layer "${layer.name}" has the wrong number of tiles`);
        for (const v of variantsOf(layer.properties) ?? [])
          if (!variants.has(v)) err('map-variant', `layer "${layer.name}": unknown variant "${v}"`);
      }

      for (const ts of map.tilesets) {
        const image = normalize(dirOf(path) + ts.image);
        if (!raw.files.has(image))
          err('map-tileset-image', `tileset "${ts.name}": image "${image}" not found`);
        if (ts.tilecount !== ts.columns * Math.floor(ts.imageheight / 16))
          err('map-tileset', `tileset "${ts.name}": tilecount does not match the image`);
        for (const tile of ts.tiles ?? []) {
          const terrain = prop(tile.properties, 'map');
          if (terrain !== undefined && !KNOWN_TERRAINS.has(String(terrain)))
            err('map-terrain', `tileset "${ts.name}" tile ${String(tile.id)}: unknown map terrain`);
        }
      }

      const placedPois = new Map<string, number>();
      const placedEdges = new Set<string>();
      const spawns = new Set<string>();
      let lights = 0;
      for (const o of objectsOf(map)) {
        const type = objectType(o);
        const label = `object ${String(o.id)} "${o.name}"`;
        if (!KNOWN_TYPES.has(type)) {
          err('map-object-type', `${label}: unknown type "${type}"`);
          continue;
        }
        for (const v of variantsOf(o.properties) ?? [])
          if (!variants.has(v)) err('map-variant', `${label}: unknown variant "${v}"`);
        if (o.x < 0 || o.y < 0 || o.x > map.width * 16 || o.y > map.height * 16)
          err('map-object-bounds', `${label} is outside the map`);
        switch (type) {
          case 'spawn':
            spawns.add(o.name);
            break;
          case 'poi':
            if (!pois.has(o.name)) err('map-poi', `${label}: no POI "${o.name}" in zone data`);
            placedPois.set(o.name, (placedPois.get(o.name) ?? 0) + 1);
            break;
          case 'path':
            if (!edges.has(o.name)) err('map-path', `${label}: no path edge "${o.name}"`);
            if (o.width <= 0 || o.height <= 0) err('map-path', `${label} must be a rectangle`);
            placedEdges.add(o.name);
            break;
          case 'light': {
            const kind = String(prop(o.properties, 'kind') ?? '');
            if (!KNOWN_LIGHTS.has(kind)) err('map-light', `${label}: unknown light kind "${kind}"`);
            if (++lights === MAP_LIGHT_BUDGET + 1)
              err(
                'map-light-budget',
                `more than ${String(MAP_LIGHT_BUDGET)} fixed lights (60 fps budget, docs/systems/performance.md)`,
              );
            break;
          }
          case 'exit': {
            const to = String(prop(o.properties, 'to') ?? '');
            const spawn = String(prop(o.properties, 'spawn') ?? 'default');
            if (o.width <= 0 || o.height <= 0) err('map-exit', `${label} must be a rectangle`);
            if (!zones.has(to)) err('map-exit', `${label}: unknown zone "${to}"`);
            else if (!spawnsOf(to).has(spawn))
              err('map-exit', `${label}: zone "${to}" has no spawn "${spawn}"`);
            if (path === zone.map && zones.has(to)) {
              const set = links.get(zone.id) ?? new Set<string>();
              set.add(to);
              links.set(zone.id, set);
            }
            break;
          }
        }
      }
      if (path === zone.map) {
        if (!spawns.has('default')) err('map-spawn', 'missing the "default" spawn');
        for (const poi of pois) {
          const n = placedPois.get(poi) ?? 0;
          if (n !== 1) err('map-poi', `POI "${poi}" is placed ${String(n)} times (expected 1)`);
        }
        for (const edge of edges)
          if (!placedEdges.has(edge)) err('map-path', `path edge "${edge}" has no area`);
      }
    }
  }

  // Every zone with exits must be able to reach every other such zone and come back.
  const linked = [...links.keys()];
  for (const from of linked) {
    const seen = new Set([from]);
    const queue = [from];
    while (queue.length > 0) {
      const z = queue.shift() ?? '';
      for (const next of links.get(z) ?? [])
        if (!seen.has(next)) {
          seen.add(next);
          queue.push(next);
        }
    }
    for (const to of linked)
      if (!seen.has(to))
        issues.error('map-unreachable', `zone "${to}" cannot be reached from "${from}"`, {
          file: zones.get(from)?.map,
          entity: `zones/${from}`,
        });
  }
}
