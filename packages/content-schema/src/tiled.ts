/**
 * The subset of the Tiled JSON map format (.tmj) MRAK uses (docs/systems/maps.md, ADR 0006).
 * Unknown fields are kept (Tiled adds editor-only data); what the game relies on is checked.
 */
import { z } from 'zod';

export const TILE_SIZE = 16;

export const TiledProperty = z.looseObject({
  name: z.string().min(1),
  type: z.string().default('string'),
  value: z.union([z.string(), z.number(), z.boolean()]),
});

export const TiledObject = z.looseObject({
  id: z.int().min(0),
  name: z.string().default(''),
  /** Tiled ≥ 1.10 saves the class as `type`; 1.9 saved it as `class`. */
  type: z.string().optional(),
  class: z.string().optional(),
  x: z.number(),
  y: z.number(),
  width: z.number().min(0).default(0),
  height: z.number().min(0).default(0),
  point: z.boolean().optional(),
  properties: z.array(TiledProperty).optional(),
});

const layerBase = {
  id: z.int().min(0).optional(),
  name: z.string().min(1),
  visible: z.boolean().default(true),
  properties: z.array(TiledProperty).optional(),
};

export const TiledTileLayer = z.looseObject({
  ...layerBase,
  type: z.literal('tilelayer'),
  width: z.int().positive(),
  height: z.int().positive(),
  /** Global tile ids (0 = empty), uncompressed CSV-style array. */
  data: z.array(z.int().min(0)),
});

export const TiledObjectLayer = z.looseObject({
  ...layerBase,
  type: z.literal('objectgroup'),
  objects: z.array(TiledObject),
});

export const TiledTileset = z.looseObject({
  firstgid: z.int().min(1),
  name: z.string().min(1),
  image: z.string().min(1),
  imagewidth: z.int().positive(),
  imageheight: z.int().positive(),
  tilewidth: z.literal(TILE_SIZE),
  tileheight: z.literal(TILE_SIZE),
  columns: z.int().positive(),
  tilecount: z.int().positive(),
  margin: z.literal(0).default(0),
  spacing: z.literal(0).default(0),
  tiles: z
    .array(z.looseObject({ id: z.int().min(0), properties: z.array(TiledProperty).optional() }))
    .optional(),
});

export const TiledMap = z.looseObject({
  type: z.literal('map'),
  orientation: z.literal('orthogonal'),
  infinite: z.literal(false),
  width: z.int().positive().max(512),
  height: z.int().positive().max(512),
  tilewidth: z.literal(TILE_SIZE),
  tileheight: z.literal(TILE_SIZE),
  layers: z.array(z.discriminatedUnion('type', [TiledTileLayer, TiledObjectLayer])).min(1),
  tilesets: z.array(TiledTileset).min(1),
});

export type TiledProperty = z.infer<typeof TiledProperty>;
export type TiledObject = z.infer<typeof TiledObject>;
export type TiledTileLayer = z.infer<typeof TiledTileLayer>;
export type TiledObjectLayer = z.infer<typeof TiledObjectLayer>;
export type TiledTileset = z.infer<typeof TiledTileset>;
export type TiledMap = z.infer<typeof TiledMap>;

export const MAP_OBJECT_TYPES = ['spawn', 'exit', 'poi', 'light', 'path'] as const;
export type MapObjectType = (typeof MAP_OBJECT_TYPES)[number];
export const LIGHT_KINDS = [
  'hearth',
  'bonfire',
  'candle',
  'window',
  'lamp-post',
  'spirit',
] as const;
export type LightKind = (typeof LIGHT_KINDS)[number];
export const MAP_TERRAINS = [
  'ground',
  'path',
  'water',
  'wall',
  'tree',
  'building',
  'grave',
] as const;
export type MapTerrain = (typeof MAP_TERRAINS)[number];
export const REQUIRED_LAYERS = ['ground', 'decor', 'collision', 'objects'] as const;

/** The class of an object (`type`, or `class` in maps saved by Tiled 1.9). */
export function objectType(o: Pick<TiledObject, 'type' | 'class'>): string {
  return o.type ?? o.class ?? '';
}

export function prop(
  props: readonly TiledProperty[] | undefined,
  name: string,
): string | number | boolean | undefined {
  return props?.find((p) => p.name === name)?.value;
}

/** Variant ids from a `variants` property ("burned, hostile"); null = shown in every variant. */
export function variantsOf(props: readonly TiledProperty[] | undefined): string[] | null {
  const v = prop(props, 'variants');
  if (typeof v !== 'string' || v.trim() === '') return null;
  return v
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/** Whether a layer/object tagged with `variants` is shown in `variant`. */
export function inVariant(props: readonly TiledProperty[] | undefined, variant: string): boolean {
  const list = variantsOf(props);
  return list === null || list.includes(variant);
}

export function objectsOf(map: TiledMap): TiledObject[] {
  return map.layers.flatMap((l) => (l.type === 'objectgroup' ? l.objects : []));
}
