/**
 * Placeholder tileset art, painted procedurally (folk-engraving palette: earth, soot, candle).
 * Every zone uses the same tile catalogue (same indices) with its own palette. Replace the
 * generated PNGs in packages/content/maps/tilesets/ with real art; keep the tile order.
 */
import { createImage, type Rgba } from './png';

export const TILE = 16;
export const COLUMNS = 16;

/** Tile catalogue: index in the tileset = position here. */
export const TILES = [
  // ground 0–11
  'grass',
  'grass-alt',
  'grass-dark',
  'dirt',
  'path',
  'cobble',
  'water',
  'flagstone',
  'moss',
  'scorched',
  'floor-wood',
  'mud',
  // buildings 12–19
  'wall',
  'wall-window',
  'door',
  'wall-stone',
  'roof',
  'roof-ridge',
  'roof-slate',
  'tower',
  // props 20–23
  'fence-h',
  'fence-v',
  'rock',
  'bush',
  // trees 24–31
  'trunk',
  'canopy-tl',
  'canopy-tr',
  'canopy-bl',
  'canopy-br',
  'dead-tree',
  'stump-burned',
  'thicket',
  // village / sacred 32–47
  'grave',
  'cross',
  'well',
  'fire-pit',
  'mill-wheel',
  'rubble',
  'column',
  'altar',
  'lamp-post',
  'barrel',
  'herbs',
  'mushroom',
  'mourning-cloth',
  'candle-stand',
  'bell',
  'ash',
  // misc 48–51
  'flower',
  'reeds',
  'bridge',
  'stairs',
] as const;
export type TileName = (typeof TILES)[number];

export function tileIndex(name: TileName): number {
  return TILES.indexOf(name);
}

/** Player-map terrain per tile (Tiled tile property `map`); unlisted tiles are `ground`. */
export const TILE_TERRAIN: Partial<Record<TileName, string>> = {
  path: 'path',
  cobble: 'path',
  bridge: 'path',
  stairs: 'path',
  'floor-wood': 'path',
  flagstone: 'path',
  water: 'water',
  wall: 'building',
  'wall-window': 'building',
  door: 'building',
  'wall-stone': 'wall',
  roof: 'building',
  'roof-ridge': 'building',
  'roof-slate': 'building',
  tower: 'building',
  trunk: 'tree',
  'canopy-tl': 'tree',
  'canopy-tr': 'tree',
  'canopy-bl': 'tree',
  'canopy-br': 'tree',
  'dead-tree': 'tree',
  'stump-burned': 'tree',
  thicket: 'tree',
  bush: 'tree',
  grave: 'grave',
  cross: 'grave',
  'fence-h': 'wall',
  'fence-v': 'wall',
  rock: 'wall',
  rubble: 'wall',
  column: 'wall',
  well: 'wall',
  'mill-wheel': 'wall',
  altar: 'wall',
  barrel: 'wall',
};

type Hex = string;
export interface Palette {
  grass: [Hex, Hex, Hex];
  dirt: [Hex, Hex];
  path: [Hex, Hex];
  stone: [Hex, Hex, Hex];
  wood: [Hex, Hex];
  plaster: [Hex, Hex];
  roof: [Hex, Hex];
  slate: [Hex, Hex];
  water: [Hex, Hex];
  leaf: [Hex, Hex, Hex];
  bark: [Hex, Hex];
  moss: [Hex, Hex];
}

export const PALETTES: Record<string, Palette> = {
  village: {
    grass: ['#3a5228', '#46622f', '#527238'],
    dirt: ['#58432f', '#6a523a'],
    path: ['#7a6448', '#8c7556'],
    stone: ['#5f5a52', '#77716a', '#8e887f'],
    wood: ['#55361f', '#6e4a2c'],
    plaster: ['#a99d84', '#c2b79c'],
    roof: ['#5a2a20', '#723628'],
    slate: ['#3d3f45', '#52555c'],
    water: ['#1e3344', '#2b475c'],
    leaf: ['#22391e', '#2d4a25', '#3a5c2e'],
    bark: ['#3e2c1f', '#57402c'],
    moss: ['#3b5226', '#4d6a30'],
  },
  forest: {
    grass: ['#22331c', '#2a3e21', '#334a28'],
    dirt: ['#3f3123', '#4d3c2b'],
    path: ['#5a4a36', '#6b5940'],
    stone: ['#4f4d48', '#64615a', '#7a766d'],
    wood: ['#4a301c', '#5f4026'],
    plaster: ['#8e8670', '#a59c84'],
    roof: ['#4b2a20', '#5e3628'],
    slate: ['#34363b', '#45484e'],
    water: ['#18303a', '#23434f'],
    leaf: ['#15291a', '#1d3621', '#28462a'],
    bark: ['#35271c', '#4a3828'],
    moss: ['#2c4520', '#3a5a29'],
  },
  monastery: {
    grass: ['#33432a', '#3d5031', '#475c38'],
    dirt: ['#4e4234', '#5e5040'],
    path: ['#6a6052', '#7a7062'],
    stone: ['#5a5650', '#716c64', '#89847a'],
    wood: ['#4a3322', '#60442e'],
    plaster: ['#9d9482', '#b5ac98'],
    roof: ['#46302a', '#5a3e34'],
    slate: ['#393b40', '#4c4f55'],
    water: ['#1c2f3c', '#294355'],
    leaf: ['#20331e', '#2a4226', '#355230'],
    bark: ['#3a2c20', '#52402e'],
    moss: ['#36502a', '#486634'],
  },
};

type Rgb = [number, number, number];
function hex(h: Hex): Rgb {
  const n = Number.parseInt(h.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** Deterministic per-pixel noise. */
function noise(x: number, y: number, seed: number): number {
  let h = (x * 374761393 + y * 668265263 + seed * 2147483647) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 0xffffffff;
}

class Painter {
  constructor(
    private readonly img: Rgba,
    private readonly ox: number,
    private readonly oy: number,
    readonly seed: number,
  ) {}

  px(px: number, py: number, c: Hex | Rgb, alpha = 255): void {
    const x = Math.floor(px);
    const y = Math.floor(py);
    if (x < 0 || y < 0 || x >= TILE || y >= TILE) return;
    const [r, g, b] = typeof c === 'string' ? hex(c) : c;
    const o = ((this.oy + y) * this.img.width + this.ox + x) * 4;
    this.img.data[o] = r;
    this.img.data[o + 1] = g;
    this.img.data[o + 2] = b;
    this.img.data[o + 3] = alpha;
  }

  rect(x: number, y: number, w: number, h: number, c: Hex): void {
    for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) this.px(i, j, c);
  }

  /** Noisy fill from a list of shades (dither-like). */
  speckle(colors: readonly Hex[], x = 0, y = 0, w = TILE, h = TILE): void {
    for (let j = y; j < y + h; j++)
      for (let i = x; i < x + w; i++) {
        const n = noise(i, j, this.seed);
        this.px(i, j, colors[Math.min(colors.length - 1, Math.floor(n * colors.length))] ?? '#000');
      }
  }

  disc(cx: number, cy: number, r: number, c: Hex): void {
    for (let j = Math.floor(cy - r); j <= Math.ceil(cy + r); j++)
      for (let i = Math.floor(cx - r); i <= Math.ceil(cx + r); i++)
        if ((i + 0.5 - cx) ** 2 + (j + 0.5 - cy) ** 2 <= r * r) this.px(i, j, c);
  }

  /** A leafy blob: noisy disc with darker lower edge. */
  foliage(cx: number, cy: number, r: number, leaf: readonly Hex[]): void {
    for (let j = 0; j < TILE; j++)
      for (let i = 0; i < TILE; i++) {
        const d = Math.hypot(i + 0.5 - cx, j + 0.5 - cy);
        const edge = r + (noise(i, j, this.seed + 7) - 0.5) * 3;
        if (d > edge) continue;
        const shade = j > cy + r * 0.3 ? 0 : noise(i, j, this.seed) > 0.6 ? 2 : 1;
        this.px(i, j, leaf[shade] ?? '#000');
      }
  }
}

function paint(p: Painter, name: TileName, pal: Palette): void {
  switch (name) {
    case 'grass':
      p.speckle([pal.grass[0], pal.grass[1], pal.grass[1], pal.grass[2]]);
      break;
    case 'grass-alt':
      p.speckle([pal.grass[1], pal.grass[1], pal.grass[2], pal.moss[1]]);
      for (let i = 0; i < 4; i++) p.px(2 + i * 4, 10 - (i % 2) * 5, pal.grass[2]);
      break;
    case 'grass-dark':
      p.speckle([pal.grass[0], pal.grass[0], pal.grass[1]]);
      break;
    case 'dirt':
      p.speckle([pal.dirt[0], pal.dirt[1], pal.dirt[1]]);
      break;
    case 'path':
      p.speckle([pal.path[0], pal.path[1], pal.path[1], pal.dirt[1]]);
      break;
    case 'cobble':
      p.speckle([pal.stone[0]]);
      for (let j = 0; j < 4; j++)
        for (let i = 0; i < 4; i++)
          p.rect(i * 4 + (j % 2) * 2, j * 4, 3, 3, i % 3 === j % 2 ? pal.stone[1] : pal.stone[2]);
      break;
    case 'water':
      p.speckle([pal.water[0], pal.water[0], pal.water[1]]);
      for (let i = 0; i < 3; i++) p.rect(2 + i * 5, 4 + i * 4, 4, 1, pal.water[1]);
      break;
    case 'flagstone':
      p.speckle([pal.stone[1], pal.stone[1], pal.stone[2]]);
      p.rect(0, 0, 16, 1, pal.stone[0]);
      p.rect(0, 8, 16, 1, pal.stone[0]);
      p.rect(0, 0, 1, 8, pal.stone[0]);
      p.rect(8, 8, 1, 8, pal.stone[0]);
      break;
    case 'moss':
      p.speckle([pal.moss[0], pal.moss[1], pal.grass[0]]);
      break;
    case 'scorched':
      p.speckle(['#1d1915', '#2a241e', '#3a3028', '#1d1915']);
      break;
    case 'floor-wood':
      p.speckle([pal.wood[1]]);
      for (let j = 0; j < 4; j++) p.rect(0, j * 4 + 3, 16, 1, pal.wood[0]);
      break;
    case 'mud':
      p.speckle([pal.dirt[0], pal.dirt[0], pal.water[0]]);
      break;
    case 'wall':
    case 'wall-window':
    case 'door':
      p.speckle([pal.plaster[0], pal.plaster[1], pal.plaster[1]]);
      p.rect(0, 0, 16, 2, pal.wood[0]);
      p.rect(0, 14, 16, 2, pal.stone[0]);
      p.rect(0, 0, 1, 16, pal.wood[0]);
      if (name === 'wall-window') {
        p.rect(4, 4, 8, 7, pal.wood[0]);
        p.rect(5, 5, 6, 5, '#e0a94a');
        p.rect(7, 5, 1, 5, pal.wood[0]);
        p.rect(5, 7, 6, 1, pal.wood[0]);
      }
      if (name === 'door') {
        p.rect(3, 3, 10, 13, pal.wood[0]);
        p.rect(4, 4, 8, 12, pal.wood[1]);
        p.px(10, 10, '#c9a34a');
      }
      break;
    case 'wall-stone':
      p.speckle([pal.stone[1], pal.stone[2]]);
      for (let j = 0; j < 4; j++) {
        p.rect(0, j * 4 + 3, 16, 1, pal.stone[0]);
        p.rect(((j % 2) * 8 + 4) % 16, j * 4, 1, 3, pal.stone[0]);
      }
      break;
    case 'roof':
    case 'roof-ridge':
      p.speckle([pal.roof[0], pal.roof[1]]);
      for (let j = 0; j < 4; j++) p.rect(0, j * 4 + 3, 16, 1, '#2a120e');
      for (let j = 0; j < 4; j++)
        for (let i = 0; i < 4; i++) p.px(i * 4 + (j % 2) * 2, j * 4 + 1, '#8a4433');
      if (name === 'roof-ridge') p.rect(0, 0, 16, 3, '#2a120e');
      break;
    case 'roof-slate':
      p.speckle([pal.slate[0], pal.slate[1]]);
      for (let j = 0; j < 4; j++) p.rect(0, j * 4 + 3, 16, 1, '#202126');
      break;
    case 'tower':
      p.speckle([pal.stone[1], pal.stone[2]]);
      p.rect(5, 2, 6, 9, '#14100c');
      p.disc(8, 4, 3, '#14100c');
      p.rect(0, 13, 16, 3, pal.stone[0]);
      break;
    case 'fence-h':
      p.rect(0, 6, 16, 2, pal.wood[1]);
      p.rect(0, 11, 16, 2, pal.wood[0]);
      for (const x of [1, 8, 14]) p.rect(x, 3, 2, 12, pal.wood[0]);
      break;
    case 'fence-v':
      for (const y of [1, 8, 14]) p.rect(6, y, 4, 2, pal.wood[1]);
      p.rect(7, 0, 2, 16, pal.wood[0]);
      break;
    case 'rock':
      p.disc(8, 9, 6, pal.stone[0]);
      p.disc(7, 8, 5, pal.stone[1]);
      p.disc(6, 6, 2.5, pal.stone[2]);
      break;
    case 'bush':
      p.foliage(8, 9, 6.5, pal.leaf);
      break;
    case 'trunk':
      p.rect(11, 0, 5, 14, pal.bark[0]);
      p.rect(12, 0, 2, 14, pal.bark[1]);
      p.rect(9, 13, 7, 3, pal.bark[0]);
      break;
    case 'canopy-tl':
      p.foliage(16, 16, 15, pal.leaf);
      break;
    case 'canopy-tr':
      p.foliage(0, 16, 15, pal.leaf);
      break;
    case 'canopy-bl':
      p.foliage(16, 0, 15, pal.leaf);
      break;
    case 'canopy-br':
      p.foliage(0, 0, 15, pal.leaf);
      break;
    case 'dead-tree':
      p.rect(7, 2, 3, 14, pal.bark[0]);
      p.rect(3, 4, 5, 1, pal.bark[0]);
      p.rect(9, 6, 5, 1, pal.bark[0]);
      p.rect(3, 2, 1, 3, pal.bark[0]);
      p.rect(13, 3, 1, 4, pal.bark[0]);
      break;
    case 'stump-burned':
      p.rect(4, 8, 8, 8, '#16120f');
      p.rect(5, 6, 6, 3, '#231b15');
      p.px(7, 10, '#6b2a12');
      break;
    case 'thicket':
      p.speckle([pal.leaf[0], pal.leaf[0], pal.bark[0], pal.leaf[1]]);
      for (let i = 0; i < 6; i++) p.rect((i * 5) % 15, (i * 7) % 15, 2, 1, '#100c08');
      break;
    case 'grave':
      p.rect(4, 10, 8, 4, pal.dirt[0]);
      p.rect(5, 2, 6, 9, pal.stone[1]);
      p.rect(5, 2, 6, 1, pal.stone[2]);
      p.rect(7, 4, 2, 4, pal.stone[0]);
      break;
    case 'cross':
      p.rect(7, 1, 2, 14, pal.wood[0]);
      p.rect(4, 4, 8, 2, pal.wood[0]);
      p.rect(5, 13, 6, 2, pal.dirt[0]);
      break;
    case 'well':
      p.disc(8, 9, 7, pal.stone[1]);
      p.disc(8, 9, 4.5, '#0a0a0c');
      p.rect(2, 1, 2, 9, pal.wood[0]);
      p.rect(12, 1, 2, 9, pal.wood[0]);
      p.rect(2, 1, 12, 2, pal.wood[1]);
      break;
    case 'fire-pit':
      p.disc(8, 9, 6, pal.stone[0]);
      p.disc(8, 9, 4, '#1a120c');
      p.rect(5, 8, 6, 2, pal.wood[0]);
      p.px(8, 7, '#e0a94a');
      p.px(7, 8, '#d4574d');
      break;
    case 'mill-wheel':
      p.disc(8, 8, 7.5, pal.wood[0]);
      p.disc(8, 8, 5.5, pal.water[0]);
      p.rect(7, 0, 2, 16, pal.wood[1]);
      p.rect(0, 7, 16, 2, pal.wood[1]);
      break;
    case 'rubble':
      p.speckle([pal.dirt[0]]);
      for (let i = 0; i < 7; i++)
        p.disc(2 + ((i * 5) % 13), 3 + ((i * 7) % 11), 2 + (i % 2), pal.stone[i % 3] ?? '#555');
      break;
    case 'column':
      p.rect(4, 0, 8, 16, pal.stone[1]);
      p.rect(5, 0, 2, 16, pal.stone[2]);
      p.rect(3, 13, 10, 3, pal.stone[0]);
      break;
    case 'altar':
      p.rect(1, 5, 14, 9, pal.stone[1]);
      p.rect(1, 5, 14, 2, pal.stone[2]);
      p.rect(3, 7, 10, 1, '#f2e8d2');
      p.rect(7, 1, 2, 5, '#c9a34a');
      break;
    case 'lamp-post':
      p.rect(7, 4, 2, 12, pal.wood[0]);
      p.rect(5, 1, 6, 4, '#2a2018');
      p.rect(6, 2, 4, 2, '#e0a94a');
      break;
    case 'barrel':
      p.disc(8, 9, 6, pal.wood[0]);
      p.disc(8, 8, 5, pal.wood[1]);
      p.rect(3, 6, 10, 1, '#2a2018');
      p.rect(3, 11, 10, 1, '#2a2018');
      break;
    case 'herbs':
      p.speckle([pal.grass[1], pal.grass[2]]);
      for (let i = 0; i < 5; i++) {
        p.rect(2 + i * 3, 5 + (i % 2) * 3, 1, 6, pal.moss[1]);
        p.px(2 + i * 3, 4 + (i % 2) * 3, i % 2 ? '#c9b0e0' : '#f3d9a0');
      }
      break;
    case 'mushroom':
      p.speckle([pal.grass[0], pal.grass[1]]);
      for (let i = 0; i < 4; i++) {
        p.rect(3 + i * 3, 9, 1, 3, '#d8cfb8');
        p.rect(2 + i * 3, 8, 3, 1, '#e6e0d0');
      }
      break;
    case 'mourning-cloth':
      p.rect(6, 0, 4, 12, '#0c0a0a');
      p.rect(5, 0, 6, 2, '#1c1616');
      break;
    case 'candle-stand':
      p.rect(7, 6, 2, 9, '#c9a34a');
      p.rect(4, 14, 8, 2, '#8a6a2a');
      p.rect(7, 3, 2, 3, '#f2e8d2');
      p.px(7, 2, '#e0a94a');
      break;
    case 'bell':
      p.disc(8, 8, 6, '#8a6a2a');
      p.rect(2, 9, 12, 4, '#8a6a2a');
      p.rect(7, 13, 2, 2, '#5a4520');
      break;
    case 'ash':
      p.speckle(['#2a2622', '#3a3530', '#4a443d']);
      break;
    case 'flower':
      p.speckle([pal.grass[1], pal.grass[2]]);
      for (let i = 0; i < 4; i++)
        p.px(2 + i * 4, 3 + ((i * 5) % 10), i % 2 ? '#f2e8d2' : '#d4574d');
      break;
    case 'reeds':
      p.speckle([pal.water[0], pal.water[1]]);
      for (let i = 0; i < 6; i++) p.rect(1 + i * 2.5, 3 + (i % 3), 1, 10, pal.moss[1]);
      break;
    case 'bridge':
      p.speckle([pal.water[0]]);
      for (let j = 0; j < 8; j++) p.rect(0, j * 2, 16, 1, j % 2 ? pal.wood[0] : pal.wood[1]);
      p.rect(0, 0, 16, 1, pal.wood[0]);
      break;
    case 'stairs':
      for (let j = 0; j < 4; j++) p.rect(0, j * 4, 16, 4, j % 2 ? pal.stone[0] : pal.stone[1]);
      p.rect(0, 12, 16, 4, '#0c0a08');
      break;
  }
}

/** The tileset image of a zone: COLUMNS × rows tiles. */
export function paintTileset(palette: Palette, seed: number): Rgba {
  const rows = Math.ceil(TILES.length / COLUMNS);
  const img = createImage(COLUMNS * TILE, rows * TILE);
  TILES.forEach((name, i) => {
    paint(
      new Painter(img, (i % COLUMNS) * TILE, Math.floor(i / COLUMNS) * TILE, seed + i),
      name,
      palette,
    );
  });
  return img;
}
