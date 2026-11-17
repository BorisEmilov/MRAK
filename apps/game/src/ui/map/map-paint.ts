/** Player-map drawing helpers (docs/systems/night-exploration.md → Player map). */
import type { PoiKind } from '@mrak/content-schema';
import { decodeBase64, EXPLORE_CELL_TILES, isRevealed } from '@mrak/core';
import type { IconName } from '@mrak/ui-kit';
import type { MapSketch } from '../../game/world/zone-map';

/** Pixels per tile on the map canvas. */
export const SCALE = 3;

/** Ink colour per terrain (MAP_TERRAINS order, index + 1); 0 = unexplored parchment. */
export const TERRAIN_INK: readonly string[] = [
  '#e9dcbc', // unexplored (parchment)
  '#cdb98f', // ground
  '#8a6a44', // path
  '#5f7f95', // water
  '#3a2a1e', // wall
  '#4d5e3a', // tree
  '#2a1c14', // building
  '#6b6258', // grave
];

export const POI_ICONS: Readonly<Record<PoiKind, IconName>> = {
  woodpile: 'task.firewood',
  church: 'poi.church',
  tavern: 'poi.tavern',
  house: 'poi.house',
  mill: 'poi.mill',
  cemetery: 'poi.cemetery',
  grave: 'poi.grave',
  well: 'poi.well',
  shrine: 'poi.shrine',
  bonfire: 'poi.bonfire',
  'oil-store': 'poi.oil-store',
  herbs: 'poi.herbs',
  ruin: 'poi.ruin',
  'samodiva-circle': 'poi.samodiva-circle',
  crossroads: 'poi.crossroads',
  gate: 'poi.gate',
};

/** Paints the explored part of a sketch into RGBA pixels (exported for tests). */
export function paintMap(sketch: MapSketch, explored: string, scale = SCALE): ImageData | null {
  if (typeof ImageData === 'undefined') return null;
  const width = sketch.cols * scale;
  const height = sketch.rows * scale;
  const image = new ImageData(width, height);
  const bits = decodeBase64(explored);
  const cellCols = Math.ceil(sketch.cols / EXPLORE_CELL_TILES);
  const rgb = TERRAIN_INK.map((hex) => {
    const n = Number.parseInt(hex.slice(1), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255] as const;
  });
  for (let ty = 0; ty < sketch.rows; ty++)
    for (let tx = 0; tx < sketch.cols; tx++) {
      const cell =
        Math.floor(ty / EXPLORE_CELL_TILES) * cellCols + Math.floor(tx / EXPLORE_CELL_TILES);
      const seen = isRevealed(bits, cell);
      const [r, g, b] = rgb[seen ? (sketch.terrain[ty * sketch.cols + tx] ?? 0) : 0] ?? [0, 0, 0];
      for (let y = 0; y < scale; y++)
        for (let x = 0; x < scale; x++) {
          const o = ((ty * scale + y) * width + tx * scale + x) * 4;
          // A faint engraved grain on explored ground.
          const grain = seen && (tx * 7 + ty * 13 + x + y) % 11 === 0 ? -12 : 0;
          image.data[o] = r + grain;
          image.data[o + 1] = g + grain;
          image.data[o + 2] = b + grain;
          image.data[o + 3] = 255;
        }
    }
  return image;
}
