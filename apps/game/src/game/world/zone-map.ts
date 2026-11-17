/**
 * Reads a zone's Tiled map for one variant (docs/systems/maps.md). Pure: no Phaser, so the
 * rules about layers, objects and variants are unit-tested.
 */
import {
  inVariant,
  MAP_TERRAINS,
  objectsOf,
  objectType,
  prop,
  TILE_SIZE,
  type LightKind,
  type MapTerrain,
  type TiledMap,
  type TiledObject,
} from '@mrak/content-schema';

export interface LightDef {
  x: number;
  y: number;
  kind: LightKind;
  /** Radius in pixels. */
  radius: number;
  color: number;
  intensity: number;
  /** Lit only at dusk and night. */
  night: boolean;
}

export interface ExitDef {
  rect: Rect;
  to: string;
  spawn: string;
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface MapSketch {
  zone: string;
  cols: number;
  rows: number;
  /** Per tile: index into MAP_TERRAINS + 1 (0 = nothing drawn). */
  terrain: Uint8Array;
  /** POIs in tile coordinates. */
  pois: readonly { id: string; x: number; y: number }[];
}

/** Light presets by kind: radius (tiles), colour, intensity, night-only. */
export const LIGHT_PRESETS: Readonly<
  Record<LightKind, { radius: number; color: number; intensity: number; night: boolean }>
> = {
  hearth: { radius: 4, color: 0xffa24a, intensity: 1.3, night: false },
  bonfire: { radius: 5, color: 0xff8a3a, intensity: 1.6, night: false },
  candle: { radius: 2.5, color: 0xffcf7a, intensity: 1.1, night: false },
  window: { radius: 3, color: 0xffc46a, intensity: 0.9, night: true },
  'lamp-post': { radius: 4, color: 0xffd58a, intensity: 1.1, night: true },
  spirit: { radius: 3.5, color: 0x9fd8ff, intensity: 1.2, night: true },
};

function rectOf(o: TiledObject): Rect {
  return { x: o.x, y: o.y, width: o.width, height: o.height };
}

function parseColor(value: unknown, fallback: number): number {
  if (typeof value !== 'string') return fallback;
  // Tiled writes colours as #aarrggbb (or #rrggbb).
  const hex = value.replace('#', '');
  const rgb = hex.length === 8 ? hex.slice(2) : hex;
  const n = Number.parseInt(rgb, 16);
  return Number.isFinite(n) && rgb.length === 6 ? n : fallback;
}

export class ZoneMap {
  readonly cols: number;
  readonly rows: number;
  private readonly objects: TiledObject[];

  constructor(
    readonly zone: string,
    readonly map: TiledMap,
    readonly variant: string,
  ) {
    this.cols = map.width;
    this.rows = map.height;
    this.objects = objectsOf(map).filter((o) => inVariant(o.properties, variant));
  }

  /** Tile layers shown in this variant, in map order (collision layers excluded). */
  visibleTileLayers(): string[] {
    return this.map.layers
      .filter(
        (l) =>
          l.type === 'tilelayer' &&
          !l.name.startsWith('collision') &&
          inVariant(l.properties, this.variant),
      )
      .map((l) => l.name);
  }

  /** Collision layers active in this variant. */
  collisionLayers(): string[] {
    return this.map.layers
      .filter(
        (l) =>
          l.type === 'tilelayer' &&
          l.name.startsWith('collision') &&
          inVariant(l.properties, this.variant),
      )
      .map((l) => l.name);
  }

  /** Solid tiles of this variant (1 = blocked), row-major: what NPC pathfinding walks around. */
  solidGrid(): Uint8Array {
    const grid = new Uint8Array(this.cols * this.rows);
    const names = new Set(this.collisionLayers());
    for (const layer of this.map.layers) {
      if (layer.type !== 'tilelayer' || !names.has(layer.name)) continue;
      layer.data.forEach((gid, i) => {
        if (gid !== 0 && i < grid.length) grid[i] = 1;
      });
    }
    return grid;
  }

  /** Whether a tile layer draws above the guardian (`overhead*`). */
  static isOverhead(name: string): boolean {
    return name.startsWith('overhead');
  }

  private ofType(type: string): TiledObject[] {
    return this.objects.filter((o) => objectType(o) === type);
  }

  /** Spawn point in pixels (falls back to `default`, then to the map centre). */
  spawn(name: string): { x: number; y: number } {
    const spawns = this.ofType('spawn');
    const s = spawns.find((o) => o.name === name) ?? spawns.find((o) => o.name === 'default');
    return s
      ? { x: s.x, y: s.y }
      : { x: (this.cols * TILE_SIZE) / 2, y: (this.rows * TILE_SIZE) / 2 };
  }

  exits(): ExitDef[] {
    return this.ofType('exit').map((o) => ({
      rect: rectOf(o),
      to: String(prop(o.properties, 'to') ?? ''),
      spawn: String(prop(o.properties, 'spawn') ?? 'default'),
    }));
  }

  pois(): { id: string; x: number; y: number }[] {
    return this.ofType('poi').map((o) => ({ id: o.name, x: o.x, y: o.y }));
  }

  /** Path areas by edge id (several rectangles may belong to one edge), with their blocker. */
  pathAreas(): Map<string, (Rect & { blocker: string | null })[]> {
    const out = new Map<string, (Rect & { blocker: string | null })[]>();
    for (const o of this.ofType('path')) {
      const blocker = prop(o.properties, 'blocker');
      out.set(o.name, [
        ...(out.get(o.name) ?? []),
        { ...rectOf(o), blocker: typeof blocker === 'string' ? blocker : null },
      ]);
    }
    return out;
  }

  lights(): LightDef[] {
    return this.ofType('light').flatMap((o) => {
      const kind = String(prop(o.properties, 'kind') ?? '') as LightKind;
      const preset = LIGHT_PRESETS[kind];
      if (!(kind in LIGHT_PRESETS)) return [];
      const radius = Number(prop(o.properties, 'radius') ?? preset.radius);
      const intensity = Number(prop(o.properties, 'intensity') ?? preset.intensity);
      const night = prop(o.properties, 'night');
      return [
        {
          x: o.x,
          y: o.y,
          kind,
          radius: radius * TILE_SIZE,
          color: parseColor(prop(o.properties, 'color'), preset.color),
          intensity,
          night: typeof night === 'boolean' ? night : preset.night,
        },
      ];
    });
  }

  /**
   * Global tile id of the blocker tile (`blocker` tile property, e.g. "thicket", "rubble") that
   * covers closed paths; the first blocker tile when `name` is null or unknown.
   */
  blockerGid(name: string | null): number | null {
    const ts = this.map.tilesets[0];
    if (!ts) return null;
    const blockers = (ts.tiles ?? []).filter((t) => prop(t.properties, 'blocker') !== undefined);
    const tile = blockers.find((t) => prop(t.properties, 'blocker') === name) ?? blockers[0];
    return tile ? tile.id + ts.firstgid : null;
  }

  /** Player-map terrain per tile from the visible layers (topmost non-empty wins). */
  sketch(): MapSketch {
    const ts = this.map.tilesets[0];
    const terrainOf = new Map<number, MapTerrain>();
    for (const t of ts?.tiles ?? []) {
      const value = prop(t.properties, 'map');
      if (typeof value === 'string' && (MAP_TERRAINS as readonly string[]).includes(value))
        terrainOf.set(t.id + (ts?.firstgid ?? 1), value as MapTerrain);
    }
    const terrain = new Uint8Array(this.cols * this.rows);
    const layers = this.map.layers.filter(
      (l) =>
        l.type === 'tilelayer' &&
        !l.name.startsWith('collision') &&
        !ZoneMap.isOverhead(l.name) &&
        inVariant(l.properties, this.variant),
    );
    for (const layer of layers) {
      if (layer.type !== 'tilelayer') continue;
      layer.data.forEach((gid, i) => {
        if (gid === 0) return;
        const t = terrainOf.get(gid) ?? 'ground';
        terrain[i] = MAP_TERRAINS.indexOf(t) + 1;
      });
    }
    return {
      zone: this.zone,
      cols: this.cols,
      rows: this.rows,
      terrain,
      pois: this.pois().map((p) => ({ id: p.id, x: p.x / TILE_SIZE, y: p.y / TILE_SIZE })),
    };
  }
}

/** Whether two rectangles overlap. */
export function overlaps(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
}

/** Tiles (column, row) covered by a pixel rectangle. */
export function tilesIn(rect: Rect): { x: number; y: number }[] {
  const out: { x: number; y: number }[] = [];
  for (
    let y = Math.floor(rect.y / TILE_SIZE);
    y < Math.ceil((rect.y + rect.height) / TILE_SIZE);
    y++
  )
    for (
      let x = Math.floor(rect.x / TILE_SIZE);
      x < Math.ceil((rect.x + rect.width) / TILE_SIZE);
      x++
    )
      out.push({ x, y });
  return out;
}
