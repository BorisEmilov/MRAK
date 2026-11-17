/**
 * Scaffolds the MVP zone maps (Tiled .tmj) and their placeholder tilesets (ADR 0006,
 * docs/systems/maps.md). Run once; afterwards the .tmj files are edited in Tiled and are the
 * source of truth. Refuses to overwrite existing maps unless `--force`.
 *
 * Usage: tsx scripts/scaffold-maps.ts [--force]
 */
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { encodePng } from './art/png';
import {
  COLUMNS,
  PALETTES,
  paintTileset,
  TILE,
  TILE_TERRAIN,
  tileIndex,
  TILES,
  type TileName,
} from './art/tiles';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../../..');
const MAPS = join(ROOT, 'packages/content/maps');
const force = process.argv.includes('--force');

// ------------------------------------------------------------------ seeded helpers

function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Props = Record<string, string | number | boolean>;
interface Obj {
  type: string;
  name: string;
  x: number;
  y: number;
  w: number;
  h: number;
  props: Props;
}

const COLLISION_TILE = tileIndex('rock');

class MapBuilder {
  readonly layers = new Map<string, { data: number[]; variants?: string }>();
  readonly objects: Obj[] = [];

  constructor(
    readonly w: number,
    readonly h: number,
  ) {
    for (const name of ['ground', 'decor', 'overhead', 'collision']) this.layer(name);
  }

  layer(name: string, variants?: string): number[] {
    let layer = this.layers.get(name);
    if (!layer) {
      layer = {
        data: new Array<number>(this.w * this.h).fill(0),
        ...(variants ? { variants } : {}),
      };
      this.layers.set(name, layer);
    }
    return layer.data;
  }

  inside(x: number, y: number): boolean {
    return x >= 0 && y >= 0 && x < this.w && y < this.h;
  }

  set(layer: string, x: number, y: number, tile: TileName | null): void {
    if (!this.inside(x, y)) return;
    this.layer(layer)[y * this.w + x] = tile === null ? 0 : tileIndex(tile) + 1;
  }

  get(layer: string, x: number, y: number): number {
    return this.inside(x, y) ? (this.layer(layer)[y * this.w + x] ?? 0) : 0;
  }

  solid(x: number, y: number, on = true, layer = 'collision'): void {
    if (!this.inside(x, y)) return;
    this.layer(layer)[y * this.w + x] = on ? COLLISION_TILE + 1 : 0;
  }

  isSolid(x: number, y: number): boolean {
    return this.get('collision', x, y) !== 0;
  }

  fill(
    layer: string,
    x: number,
    y: number,
    w: number,
    h: number,
    tile: TileName | ((x: number, y: number) => TileName | null),
  ): void {
    for (let j = y; j < y + h; j++)
      for (let i = x; i < x + w; i++)
        this.set(layer, i, j, typeof tile === 'function' ? tile(i, j) : tile);
  }

  /** Clears decor/overhead/collision in a rectangle (carving a passage). */
  clear(x: number, y: number, w: number, h: number): void {
    for (let j = y; j < y + h; j++)
      for (let i = x; i < x + w; i++) {
        this.set('decor', i, j, null);
        this.set('overhead', i, j, null);
        this.solid(i, j, false);
      }
  }

  /** Shows a layer only in the given variants (comma-separated). */
  tag(name: string, variants: string): void {
    this.layer(name);
    const layer = this.layers.get(name);
    if (layer) layer.variants = variants;
  }

  /** Solid map border, except under exit areas. */
  sealBorder(): void {
    const exits = this.objects.filter((o) => o.type === 'exit');
    for (let y = 0; y < this.h; y++)
      for (let x = 0; x < this.w; x++) {
        if (x > 0 && y > 0 && x < this.w - 1 && y < this.h - 1) continue;
        if (exits.some((e) => x >= e.x && x < e.x + e.w && y >= e.y && y < e.y + e.h)) continue;
        this.solid(x, y);
      }
  }

  /** Object at tile coordinates (point when w = h = 0). */
  obj(type: string, name: string, x: number, y: number, props: Props = {}, w = 0, h = 0): void {
    this.objects.push({ type, name, x, y, w, h, props });
  }

  /** A tree: trunk at (x, y), 2 × 2 canopy above it (overhead). */
  tree(x: number, y: number, variants = ''): void {
    const suffix = variants ? `-${variants}` : '';
    this.set(`decor${suffix}`, x, y, 'trunk');
    this.set(`overhead${suffix}`, x, y - 2, 'canopy-tl');
    this.set(`overhead${suffix}`, x + 1, y - 2, 'canopy-tr');
    this.set(`overhead${suffix}`, x, y - 1, 'canopy-bl');
    this.set(`overhead${suffix}`, x + 1, y - 1, 'canopy-br');
    this.solid(x, y);
  }

  /**
   * A house: roof rows, then a wall row with windows and a door row. Solid footprint; returns the
   * door tile. Window lights (night) and the door POI are added by the caller via `windows`.
   */
  building(
    x: number,
    y: number,
    w: number,
    h: number,
    opts: { door: number; windows: number[]; roof?: TileName; poi?: string; lightColor?: string },
  ): void {
    const roof = opts.roof ?? 'roof';
    for (let j = 0; j < h; j++)
      for (let i = 0; i < w; i++) {
        const tx = x + i;
        const ty = y + j;
        let tile: TileName;
        if (j === 0) tile = roof === 'roof' ? 'roof-ridge' : roof;
        else if (j < h - 2) tile = roof;
        else if (j === h - 2) tile = opts.windows.includes(i) ? 'wall-window' : 'wall';
        else tile = i === opts.door ? 'door' : opts.windows.includes(i) ? 'wall-window' : 'wall';
        this.set('decor', tx, ty, tile);
        this.solid(tx, ty);
      }
    for (const i of opts.windows)
      this.obj('light', '', x + i + 0.5, y + h + 0.2, {
        kind: 'window',
        night: true,
        ...(opts.lightColor ? { color: opts.lightColor } : {}),
      });
    if (opts.poi) this.obj('poi', opts.poi, x + opts.door + 0.5, y + h + 0.5);
  }

  /** A thick line of carved floor between two tile points. */
  corridor(ax: number, ay: number, bx: number, by: number, radius: number, floor: TileName): void {
    const steps = Math.ceil(Math.hypot(bx - ax, by - ay) * 2);
    for (let s = 0; s <= steps; s++) {
      const t = s / steps;
      this.clearing(ax + (bx - ax) * t, ay + (by - ay) * t, radius, floor);
    }
  }

  clearing(cx: number, cy: number, r: number, floor: TileName): void {
    for (let j = Math.floor(cy - r); j <= Math.ceil(cy + r); j++)
      for (let i = Math.floor(cx - r); i <= Math.ceil(cx + r); i++)
        if ((i + 0.5 - cx) ** 2 + (j + 0.5 - cy) ** 2 <= r * r) {
          this.clear(i, j, 1, 1);
          this.set('ground', i, j, floor);
        }
  }

  toTmj(tileset: string): unknown {
    let layerId = 1;
    let objectId = 1;
    const tileLayers = [...this.layers.entries()].map(([name, layer]) => ({
      data: layer.data,
      height: this.h,
      id: layerId++,
      name,
      opacity: 1,
      type: 'tilelayer',
      visible: !name.startsWith('collision'),
      width: this.w,
      x: 0,
      y: 0,
      ...(layer.variants
        ? { properties: [{ name: 'variants', type: 'string', value: layer.variants }] }
        : {}),
    }));
    const objects = this.objects.map((o) => ({
      height: o.h * TILE,
      id: objectId++,
      name: o.name,
      ...(o.w === 0 && o.h === 0 ? { point: true } : {}),
      rotation: 0,
      type: o.type,
      visible: true,
      width: o.w * TILE,
      x: Math.round(o.x * TILE),
      y: Math.round(o.y * TILE),
      ...(Object.keys(o.props).length > 0
        ? {
            properties: Object.entries(o.props)
              .sort(([a], [b]) => a.localeCompare(b))
              .map(([name, value]) => ({
                name,
                type:
                  typeof value === 'boolean'
                    ? 'bool'
                    : typeof value === 'number'
                      ? 'float'
                      : name === 'color'
                        ? 'color'
                        : 'string',
                value: name === 'color' ? `#ff${String(value).slice(1)}` : value,
              })),
          }
        : {}),
    }));
    const rows = Math.ceil(TILES.length / COLUMNS);
    return {
      compressionlevel: -1,
      height: this.h,
      infinite: false,
      layers: [
        ...tileLayers,
        {
          draworder: 'topdown',
          id: layerId++,
          name: 'objects',
          objects,
          opacity: 1,
          type: 'objectgroup',
          visible: true,
          x: 0,
          y: 0,
        },
      ],
      nextlayerid: layerId,
      nextobjectid: objectId,
      orientation: 'orthogonal',
      renderorder: 'right-down',
      tiledversion: '1.11.2',
      tileheight: TILE,
      tilesets: [
        {
          columns: COLUMNS,
          firstgid: 1,
          image: `tilesets/${tileset}.png`,
          imageheight: rows * TILE,
          imagewidth: COLUMNS * TILE,
          margin: 0,
          name: tileset,
          spacing: 0,
          tilecount: COLUMNS * rows,
          tileheight: TILE,
          tiles: TILES.flatMap((name, id) => {
            const properties = [
              ...(TILE_TERRAIN[name]
                ? [{ name: 'map', type: 'string', value: TILE_TERRAIN[name] }]
                : []),
              ...(name === 'thicket' || name === 'rubble'
                ? [{ name: 'blocker', type: 'string', value: name }]
                : []),
            ];
            return properties.length > 0 ? [{ id, properties }] : [];
          }),
          tilewidth: TILE,
        },
      ],
      tilewidth: TILE,
      type: 'map',
      version: '1.10',
      width: this.w,
    };
  }
}

/** Path area: a rectangle (tiles) centred on a point. */
function pathArea(
  b: MapBuilder,
  edge: string,
  cx: number,
  cy: number,
  size = 6,
  props: Props = {},
): void {
  b.obj('path', edge, Math.round(cx - size / 2), Math.round(cy - size / 2), props, size, size);
}

// ------------------------------------------------------------------ village (80 × 60)

function village(): MapBuilder {
  const W = 80;
  const H = 60;
  const b = new MapBuilder(W, H);
  const r = rng(1834);
  b.fill('ground', 0, 0, W, H, () => (r() < 0.18 ? 'grass-alt' : r() < 0.05 ? 'flower' : 'grass'));

  // Forest ring with gaps for the exits (east road → forest, north road → monastery).
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const edge = x < 3 || y < 3 || x >= W - 3 || y >= H - 3;
      const eastGap = x >= W - 3 && y >= 28 && y <= 32;
      const northGap = y < 3 && x >= 49 && x <= 54;
      if (!edge || eastGap || northGap) continue;
      b.set('decor', x, y, (x + y) % 3 === 0 ? 'trunk' : 'bush');
      b.solid(x, y);
      if ((x + y) % 3 === 0) {
        b.set('overhead', x, y - 1, 'canopy-bl');
        b.set('overhead', x + 1, y - 1, 'canopy-br');
      }
    }

  // River (west), with reeds and a bridge on the main road.
  for (let y = 0; y < H; y++)
    for (let x = 12; x <= 14; x++) {
      b.set('ground', x, y, x === 12 && y % 4 === 0 ? 'reeds' : 'water');
      b.set('decor', x, y, null);
      b.set('overhead', x, y, null);
      b.solid(x, y);
    }
  for (let x = 12; x <= 14; x++)
    for (let y = 29; y <= 31; y++) {
      b.set('ground', x, y, 'bridge');
      b.solid(x, y, false);
    }

  // Roads: main east–west road, the north road, the plaza.
  b.fill('ground', 3, 29, W - 3, 3, 'path');
  b.fill('ground', 12, 29, 3, 3, 'bridge');
  b.fill('ground', 49, 0, 4, 24, 'path');
  b.fill('ground', 30, 22, 22, 14, 'cobble');
  b.fill('ground', 38, 18, 3, 4, 'path');

  // Church with bell tower; the chapel's oil allocation at the side door.
  b.building(32, 8, 13, 11, {
    door: 7,
    windows: [3, 10],
    roof: 'roof-slate',
    poi: 'church',
    lightColor: '#ffd890',
  });
  b.fill('decor', 32, 8, 3, 4, 'tower');
  b.obj('poi', 'chapel-oil', 45.5, 15.5);
  b.set('decor', 45, 14, 'barrel');
  b.solid(45, 14);

  // Cemetery (fenced) with its gate facing the road.
  for (let x = 54; x <= 70; x++) {
    b.set('decor', x, 6, 'fence-h');
    b.solid(x, 6);
    if (x < 61 || x > 62) {
      b.set('decor', x, 19, 'fence-h');
      b.solid(x, 19);
    }
  }
  for (let y = 6; y <= 19; y++)
    for (const x of [54, 70]) {
      b.set('decor', x, y, 'fence-v');
      b.solid(x, y);
    }
  for (let y = 8; y <= 17; y += 3)
    for (let x = 56; x <= 68; x += 3) {
      b.set('decor', x, y, (x + y) % 2 === 0 ? 'grave' : 'cross');
      b.solid(x, y);
      b.set('ground', x, y + 1, 'dirt');
    }
  b.obj('poi', 'cemetery', 61.5, 13.5);
  b.obj('poi', 'old-grave', 66.5, 9.5);

  // Houses (8), the tavern and the mill.
  b.building(22, 9, 7, 7, { door: 3, windows: [1, 5], poi: 'house-stoyan' });
  b.building(64, 21, 7, 6, { door: 2, windows: [5], poi: 'house-petko' });
  b.building(25, 38, 12, 8, { door: 6, windows: [2, 9], poi: 'tavern', roof: 'roof' });
  b.obj('light', '', 31.5, 46.8, { kind: 'hearth', radius: 4 });
  b.building(17, 40, 6, 6, { door: 2, windows: [4], poi: 'house-radka' });
  b.building(43, 38, 10, 8, { door: 5, windows: [1, 3, 8], poi: 'house-dimo', roof: 'roof-slate' });
  b.building(56, 38, 7, 6, { door: 3, windows: [1], poi: 'house-todor' });
  b.building(66, 38, 7, 6, { door: 3, windows: [5], poi: 'house-velika' });
  b.building(66, 48, 7, 6, { door: 2, windows: [5], poi: 'house-neda' });
  b.building(4, 21, 7, 7, { door: 3, windows: [1], poi: 'mill', roof: 'roof' });
  b.set('decor', 11, 24, 'mill-wheel');
  b.set('decor', 11, 25, 'mill-wheel');
  b.solid(11, 24);
  b.solid(11, 25);
  b.building(4, 33, 6, 6, { door: 2, windows: [4], poi: 'house-krastyo' });

  // Plaza: well, bonfire, lamp posts.
  b.set('decor', 44, 26, 'well');
  b.solid(44, 26);
  b.obj('poi', 'well', 44.5, 27.6);
  b.set('decor', 35, 33, 'fire-pit');
  b.solid(35, 33);
  b.obj('light', '', 35.5, 33.5, { kind: 'bonfire', radius: 5 });
  b.obj('poi', 'bonfire', 35.5, 34.8);
  for (const [x, y] of [
    [33, 28],
    [48, 28],
    [56, 32],
    [24, 28],
  ] as const) {
    b.set('decor', x, y, 'lamp-post');
    b.solid(x, y);
    b.obj('light', '', x + 0.5, y + 0.3, { kind: 'lamp-post', night: true });
  }

  // Scattered trees and bushes inside the village.
  for (let i = 0; i < 70; i++) {
    const x = 4 + Math.floor(r() * (W - 9));
    const y = 5 + Math.floor(r() * (H - 9));
    let free = true;
    for (let j = y - 2; j <= y + 1 && free; j++)
      for (let k = x - 1; k <= x + 2 && free; k++)
        if (
          b.isSolid(k, j) ||
          (b.get('ground', k, j) !== tileIndex('grass') + 1 &&
            b.get('ground', k, j) !== tileIndex('grass-alt') + 1 &&
            b.get('ground', k, j) !== tileIndex('flower') + 1)
        )
          free = false;
    if (!free || b.objects.some((o) => Math.abs(o.x - x) < 4 && Math.abs(o.y - y) < 4)) continue;
    if (r() < 0.6) b.tree(x, y);
    else {
      b.set('decor', x, y, 'bush');
      b.solid(x, y);
    }
  }

  // Mourning variant: black cloth over the doors of the houses.
  for (const o of b.objects.filter((o) => o.type === 'poi' && o.name.startsWith('house-')))
    b.set('overhead-mourning', Math.floor(o.x), Math.floor(o.y) - 2, 'mourning-cloth');
  b.tag('overhead-mourning', 'mourning');

  // Spawns and exits.
  b.obj('spawn', 'default', 41, 31.5);
  b.obj('spawn', 'from-forest', 75, 30.5);
  b.obj('spawn', 'from-monastery', 51, 5);
  b.obj('exit', '', W - 1, 28, { to: 'samodivi-forest', spawn: 'from-village' }, 1, 5);
  b.obj('exit', '', 49, 0, { to: 'monastery', spawn: 'from-village' }, 5, 1);

  // Path graph: the bridge to the west bank.
  pathArea(b, 'bridge', 13.5, 30.5, 3);
  b.sealBorder();
  return b;
}

// ------------------------------------------------------------------ Samodivi forest (90 × 70)

function forest(): MapBuilder {
  const W = 90;
  const H = 70;
  const b = new MapBuilder(W, H);
  const r = rng(1876);
  const ALL = 'wild,hostile,allied';
  b.tag('decor', ALL);
  b.tag('overhead', ALL);
  b.fill('ground', 0, 0, W, H, () => (r() < 0.3 ? 'moss' : 'grass-dark'));

  // Everything is undergrowth (solid) until carved.
  const trees: [number, number][] = [];
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      b.solid(x, y);
      const tree = (x % 3 === 0 && y % 3 === 2) || ((x + 1) % 3 === 0 && y % 3 === 0 && r() < 0.3);
      if (tree) trees.push([x, y]);
      else b.set('decor', x, y, r() < 0.55 ? 'thicket' : 'bush');
    }
  for (const [x, y] of trees) b.tree(x, y);

  const nodes = {
    edge: [5, 35],
    crossroads: [20, 57],
    glade: [44, 34],
    oak: [70, 18],
    spring: [64, 52],
    deep: [82, 62],
  } as const;
  const edges: [string, keyof typeof nodes, keyof typeof nodes][] = [
    ['e-edge-crossroads', 'edge', 'crossroads'],
    ['e-edge-glade', 'edge', 'glade'],
    ['e-crossroads-glade', 'crossroads', 'glade'],
    ['e-glade-oak', 'glade', 'oak'],
    ['e-glade-spring', 'glade', 'spring'],
    ['e-oak-spring', 'oak', 'spring'],
    ['e-spring-deep', 'spring', 'deep'],
    ['e-dead-road', 'crossroads', 'spring'],
    ['e-bone-path', 'oak', 'deep'],
  ];
  // The way out to the village.
  b.corridor(0, 35, nodes.edge[0], nodes.edge[1], 1.7, 'path');
  for (const [, a, c] of edges) {
    const [ax, ay] = nodes[a];
    const [cx, cy] = nodes[c];
    b.corridor(ax, ay, cx, cy, 1.6, 'dirt');
  }
  const radii: Record<keyof typeof nodes, number> = {
    edge: 4,
    crossroads: 5,
    glade: 7,
    oak: 5,
    spring: 5,
    deep: 5,
  };
  for (const [name, [x, y]] of Object.entries(nodes) as [
    keyof typeof nodes,
    readonly [number, number],
  ][])
    b.clearing(x, y, radii[name], name === 'glade' ? 'grass' : 'moss');
  for (const [id, a, c] of edges) {
    const [ax, ay] = nodes[a];
    const [cx, cy] = nodes[c];
    pathArea(b, id, (ax + cx) / 2, (ay + cy) / 2);
  }

  // Landmarks and POIs.
  const [gx, gy] = nodes.glade;
  for (let k = 0; k < 12; k++) {
    const a = (k / 12) * Math.PI * 2;
    b.set('ground', Math.round(gx + Math.cos(a) * 4), Math.round(gy + Math.sin(a) * 4), 'mushroom');
  }
  b.obj('poi', 'samodiva-circle', gx + 0.5, gy + 0.5);
  b.obj('poi', 'crossroads', nodes.crossroads[0] + 0.5, nodes.crossroads[1] + 0.5);
  b.set('decor', nodes.crossroads[0] + 2, nodes.crossroads[1] - 2, 'cross');
  b.solid(nodes.crossroads[0] + 2, nodes.crossroads[1] - 2);
  b.obj('light', '', nodes.crossroads[0] + 0.5, nodes.crossroads[1] - 1, {
    kind: 'bonfire',
    night: true,
    radius: 4,
  });
  b.set('decor', nodes.crossroads[0], nodes.crossroads[1] - 1, 'fire-pit');
  b.solid(nodes.crossroads[0], nodes.crossroads[1] - 1);
  const [ox, oy] = nodes.oak;
  b.tree(ox, oy - 1);
  b.tree(ox + 2, oy - 1);
  b.obj('poi', 'old-oak', ox + 1.5, oy + 1);
  const [sx, sy] = nodes.spring;
  b.fill('ground', sx - 1, sy - 1, 3, 2, 'water');
  for (let j = sy - 1; j <= sy; j++) for (let i = sx - 1; i <= sx + 1; i++) b.solid(i, j);
  b.obj('poi', 'spring', sx + 0.5, sy + 1.6);
  b.obj('poi', 'herbs', 52.5, 29.5);
  b.set('ground', 52, 29, 'herbs');
  b.obj('poi', 'hunters-cache', nodes.deep[0] - 2.5, nodes.deep[1] - 2.5);
  b.set('decor', nodes.deep[0] - 3, nodes.deep[1] - 3, 'barrel');
  b.solid(nodes.deep[0] - 3, nodes.deep[1] - 3);
  b.obj('poi', 'bone-cairn', nodes.deep[0] + 0.5, nodes.deep[1] + 0.5);
  b.set('decor', nodes.deep[0] + 1, nodes.deep[1] - 1, 'rubble');
  b.solid(nodes.deep[0] + 1, nodes.deep[1] - 1);

  // Spirit lights in the glade (cold); more when the samodivi are allies.
  for (let k = 0; k < 3; k++) {
    const a = (k / 3) * Math.PI * 2 + 0.4;
    b.obj('light', '', gx + Math.cos(a) * 5 + 0.5, gy + Math.sin(a) * 5 + 0.5, {
      kind: 'spirit',
      night: true,
    });
  }
  for (let k = 0; k < 4; k++) {
    const a = (k / 4) * Math.PI * 2;
    b.obj('light', '', gx + Math.cos(a) * 2.5 + 0.5, gy + Math.sin(a) * 2.5 + 0.5, {
      kind: 'spirit',
      variants: 'allied',
    });
  }
  b.fill('ground-allied', gx - 6, gy - 6, 13, 13, (x, y) =>
    (x - gx) ** 2 + (y - gy) ** 2 < 30 && (x * 7 + y * 3) % 5 === 0 ? 'flower' : null,
  );
  b.tag('ground-allied', 'allied');

  // Burned: stumps and ash where the forest was; no canopy.
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const decor = b.get('decor', x, y);
      if (decor === tileIndex('trunk') + 1)
        b.set('decor-burned', x, y, r() < 0.5 ? 'stump-burned' : 'dead-tree');
      else if (decor !== 0) b.set('decor-burned', x, y, r() < 0.3 ? 'rubble' : 'ash');
      const ground = b.get('ground', x, y);
      if (
        ground === tileIndex('moss') + 1 ||
        ground === tileIndex('grass-dark') + 1 ||
        ground === tileIndex('grass') + 1
      )
        b.set('ground-burned', x, y, r() < 0.7 ? 'scorched' : 'ash');
    }
  b.tag('decor-burned', 'burned');
  b.tag('ground-burned', 'burned');

  // Hostile: thorns crowd the corridors (the forest closes in), never inside path areas.
  const areas = b.objects.filter((o) => o.type === 'path');
  const inArea = (x: number, y: number): boolean =>
    areas.some((a) => x >= a.x && x < a.x + a.w && y >= a.y && y < a.y + a.h);
  for (let y = 1; y < H - 1; y++)
    for (let x = 1; x < W - 1; x++) {
      if (b.isSolid(x, y) || inArea(x, y)) continue;
      const nearWall = [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ].some(([dx, dy]) => b.isSolid(x + (dx ?? 0), y + (dy ?? 0)));
      const nearObject = b.objects.some((o) => Math.abs(o.x - x) < 3 && Math.abs(o.y - y) < 3);
      if (nearWall && !nearObject && r() < 0.35) {
        b.set('decor-hostile', x, y, 'thicket');
        b.solid(x, y, true, 'collision-hostile');
      }
    }
  b.tag('decor-hostile', 'hostile');
  b.tag('collision-hostile', 'hostile');

  b.obj('spawn', 'default', 6, 35.5);
  b.obj('spawn', 'from-village', 6, 35.5);
  b.obj('exit', '', 0, 33, { to: 'village', spawn: 'from-forest' }, 1, 5);
  b.sealBorder();
  return b;
}

// ------------------------------------------------------------------ monastery (60 × 50)

const RUBBLE: Props = { blocker: 'rubble' };

function monastery(): MapBuilder {
  const W = 60;
  const H = 50;
  const b = new MapBuilder(W, H);
  const r = rng(1856);
  b.fill('ground', 0, 0, W, H, () => (r() < 0.25 ? 'grass-alt' : 'grass'));

  const wall = (x: number, y: number): void => {
    b.set('decor', x, y, 'wall-stone');
    b.solid(x, y);
  };
  const room = (x0: number, y0: number, x1: number, y1: number, floor: TileName): void => {
    for (let y = y0; y <= y1; y++)
      for (let x = x0; x <= x1; x++) {
        if (x === x0 || x === x1 || y === y0 || y === y1) wall(x, y);
        else b.set('ground', x, y, floor);
      }
  };
  const door = (x: number, y: number, w: number, h: number, floor: TileName): void => {
    b.clear(x, y, w, h);
    b.fill('ground', x, y, w, h, floor);
  };

  // Outer enclosure.
  room(1, 1, W - 2, H - 2, 'grass');
  b.fill('ground', 2, 2, W - 4, H - 4, (x, y) =>
    r() < 0.25 ? 'grass-alt' : (x + y) % 17 === 0 ? 'dirt' : 'grass',
  );
  // Rooms: nave, crypt, cloister, cemetery; the courtyard is the open middle.
  room(20, 4, 38, 24, 'flagstone'); // nave
  room(4, 6, 15, 22, 'flagstone'); // crypt
  room(43, 8, 56, 40, 'flagstone'); // cloister
  room(3, 27, 15, 45, 'grass'); // monks' cemetery
  b.fill('ground', 18, 27, 23, 18, (x, y) => ((x + y) % 5 === 0 ? 'path' : 'cobble'));

  // Doorways (each is a path area; closed ones fill with rubble).
  door(28, H - 2, 4, 1, 'path'); // gate to the village
  b.fill('ground', 28, 44, 4, 4, 'path');
  pathArea(b, 'e-gate-court', 30, H - 3, 4, RUBBLE);
  door(28, 24, 3, 1, 'flagstone'); // court → nave
  pathArea(b, 'e-court-nave', 29.5, 25, 3, RUBBLE);
  door(43, 32, 1, 3, 'flagstone'); // court → cloister (south door)
  pathArea(b, 'e-court-cloister', 43.5, 33.5, 3, RUBBLE);
  for (let x = 39; x <= 42; x++) {
    wall(x, 13);
    wall(x, 17);
  }
  for (let x = 16; x <= 19; x++) {
    wall(x, 12);
    wall(x, 16);
  }
  for (let y = 23; y <= 26; y++) {
    wall(7, y);
    wall(11, y);
  }
  door(38, 14, 6, 3, 'flagstone'); // nave → cloister (passage)
  b.fill('ground', 39, 14, 4, 3, 'flagstone');
  pathArea(b, 'e-nave-cloister', 41, 15.5, 4, RUBBLE);
  door(15, 13, 6, 3, 'flagstone'); // nave → crypt
  pathArea(b, 'e-nave-crypt', 17.5, 14.5, 4, RUBBLE);
  door(15, 34, 1, 3, 'grass'); // court → cemetery
  pathArea(b, 'e-court-cemetery', 15.5, 35.5, 3, RUBBLE);
  door(8, 22, 3, 6, 'stairs'); // crypt ↔ cemetery ossuary passage (night)
  pathArea(b, 'e-crypt-cemetery', 9.5, 24.5, 4, RUBBLE);
  door(4, H - 2, 4, 1, 'dirt'); // breach in the outer wall (corruption)
  b.fill('ground', 4, 44, 4, 4, 'dirt');
  door(4, 45, 4, 2, 'dirt');
  pathArea(b, 'e-breach', 6, H - 3, 4, RUBBLE);

  // Furnishing: altar, columns, candles; crypt stairs; graves.
  b.set('decor', 29, 6, 'altar');
  b.solid(29, 6);
  b.set('decor', 28, 6, 'candle-stand');
  b.set('decor', 30, 6, 'candle-stand');
  for (let y = 9; y <= 21; y += 4)
    for (const x of [23, 35]) {
      b.set('decor', x, y, 'column');
      b.solid(x, y);
    }
  b.obj('poi', 'altar', 29.5, 8);
  b.obj('light', '', 28.5, 6.5, { kind: 'candle' });
  b.obj('light', '', 30.5, 6.5, { kind: 'candle' });
  for (const [x, y] of [
    [24, 12],
    [34, 12],
    [24, 20],
    [34, 20],
  ] as const) {
    b.set('decor', x, y, 'candle-stand');
    b.obj('light', '', x + 0.5, y + 0.5, { kind: 'candle', variants: 'consecrated' });
  }
  b.fill('ground', 8, 9, 4, 2, 'stairs');
  b.obj('poi', 'crypt', 9.5, 12);
  b.obj('light', '', 9.5, 10.5, { kind: 'spirit' });
  for (let y = 29; y <= 43; y += 3)
    for (let x = 5; x <= 13; x += 3) {
      b.set('decor', x, y, 'cross');
      b.solid(x, y);
    }
  b.obj('poi', 'monks-graves', 9.5, 37.5);
  b.set('decor', 50, 12, 'bell');
  b.solid(50, 12);
  b.obj('poi', 'bell', 50.5, 13.6);
  b.set('decor', 52, 36, 'barrel');
  b.solid(52, 36);
  b.obj('poi', 'oil-cellar', 52.5, 37.6);
  b.set('decor', 30, 34, 'well');
  b.solid(30, 34);
  b.obj('poi', 'well', 30.5, 35.6);
  b.obj('light', '', 30, 46, { kind: 'lamp-post', night: true, variants: 'consecrated' });

  // Ruined: rubble heaps in the rooms (never in doorways).
  const areas = b.objects.filter((o) => o.type === 'path');
  const inArea = (x: number, y: number): boolean =>
    areas.some((a) => x >= a.x - 1 && x < a.x + a.w + 1 && y >= a.y - 1 && y < a.y + a.h + 1);
  for (let k = 0; k < 60; k++) {
    const x = 3 + Math.floor(r() * (W - 6));
    const y = 3 + Math.floor(r() * (H - 6));
    if (
      b.isSolid(x, y) ||
      inArea(x, y) ||
      b.objects.some((o) => Math.abs(o.x - x) < 2 && Math.abs(o.y - y) < 2)
    )
      continue;
    b.set('decor-ruined', x, y, 'rubble');
    b.solid(x, y, true, 'collision-ruined');
  }
  b.tag('decor-ruined', 'ruined');
  b.tag('collision-ruined', 'ruined');

  b.obj('spawn', 'default', 30, 45.5);
  b.obj('spawn', 'from-village', 30, 45.5);
  b.obj('exit', '', 28, H - 1, { to: 'village', spawn: 'from-monastery' }, 4, 1);
  b.obj('exit', '', 4, H - 1, { to: 'village', spawn: 'from-monastery' }, 4, 1);
  b.sealBorder();
  return b;
}

// ------------------------------------------------------------------ main

function write(file: string, content: Buffer | string): void {
  if (existsSync(file) && !force) {
    console.log(`• keep ${file.slice(ROOT.length + 1)} (exists; --force to overwrite)`);
    return;
  }
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, content);
  console.log(`✔ ${file.slice(ROOT.length + 1)}`);
}

const zones: [string, string, () => MapBuilder][] = [
  ['village', 'village', village],
  ['samodivi-forest', 'forest', forest],
  ['monastery', 'monastery', monastery],
];
zones.forEach(([zone, tileset, build], i) => {
  const palette = PALETTES[tileset];
  if (!palette) throw new Error(`no palette ${tileset}`);
  write(join(MAPS, 'tilesets', `${tileset}.png`), encodePng(paintTileset(palette, 100 + i * 1000)));
  write(join(MAPS, `${zone}.tmj`), `${JSON.stringify(build().toTmj(tileset))}\n`);
});
