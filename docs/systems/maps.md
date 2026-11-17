# Maps

Status: v1 · MVP: ✅ (Village, Samodivi Forest, Monastery) · Files: `packages/content/maps/*.tmj` ·
Back to [GDD](../GDD.md) · [index](README.md) · decision: [ADR 0006](../adr/0006-tiled-maps.md)

## Purpose

The contract between map designers (Tiled) and code: which layers and objects a zone map has,
what their properties mean, and what the validator checks. Rules about light, paths and
exploration live in [light](light.md) and [night-exploration](night-exploration.md).

## Data

```
packages/content/maps/
  village.tmj  samodivi-forest.tmj  monastery.tmj   Tiled JSON, orthogonal, 16 px tiles
  tilesets/<zone>.png                               tileset art (normal map generated at build)
packages/content/data/zones/<zone>.json             zone data: variants, POIs, path graph
```

### Layers (names are fixed)

| Layer       | Type    | Required | Meaning                                                                  |
| ----------- | ------- | -------- | ------------------------------------------------------------------------ |
| `ground`    | tiles   | ✅       | Floor: grass, earth, paths, water, flagstones. Lit, with normal map.     |
| `decor`     | tiles   | ✅       | Walls, fences, trees, graves… drawn below the guardian.                  |
| `overhead`  | tiles   |          | Roofs and canopies drawn above the guardian.                             |
| `collision` | tiles   | ✅       | Any tile = solid. Never drawn.                                           |
| `objects`   | objects | ✅       | Spawns, exits, POIs, lights and path areas (below).                      |
| `*`         | tiles   |          | Extra tile layers are allowed (e.g. `decor-burned`), usually per variant |

Every layer and object may have the custom string property **`variants`** — a comma-separated
list of zone variant ids. It is then shown (and, for `collision`-like layers, solid) only while
the zone shows one of those variants. A tile layer whose name starts with `collision` is a
collision layer.

### Objects (`objects` layer, by Tiled object type/class)

| Type    | Shape     | Name                 | Properties                                                                                                                                   |
| ------- | --------- | -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `spawn` | point     | spawn id             | — (`default` is required: new games and unknown entries use it)                                                                              |
| `exit`  | rectangle | free                 | `to` (zone id), `spawn` (spawn id in that zone)                                                                                              |
| `poi`   | point     | POI id in zone data  | —                                                                                                                                            |
| `light` | point     | free                 | `kind` (`hearth` `bonfire` `candle` `window` `lamp-post` `spirit`), optional `radius` (tiles), `color` (#rrggbb), `intensity`, `night`(bool) |
| `path`  | rectangle | edge id in zone data | — (the area is passable only while the edge is open)                                                                                         |

## Rules

1. Tilesets are embedded in the map, use 16 × 16 tiles, no margin/spacing, and reference
   `tilesets/<name>.png`. Tile custom property `map` (`ground` `path` `water` `wall` `tree`
   `building` `grave`) tells the player map how to draw that tile (default: `ground`).
2. One map per zone; a variant may name its own `map` in zone data, but layers with `variants`
   are preferred (one file to keep in sync).
3. Every POI in zone data is placed exactly once; every path edge has at least one area.
4. Every exit points to an existing zone and to a spawn that exists in that zone's map; the zone
   graph lets the guardian go from any MVP zone to any other and back.
5. `light` objects with `night: true` (windows, lamp posts) are lit only at dusk and night.
6. The asset pipeline copies maps and tilesets with hashed names and generates the normal maps;
   the game loads them per zone ([asset-pipeline](asset-pipeline.md)).

## Initial formulas

- Map sizes (MVP): Village 80 × 60, Samodivi Forest 90 × 70, Monastery 60 × 50 tiles.
- Player-map resolution: one explored cell = 2 × 2 tiles.

## Events

None (data only). Runtime events are in [night-exploration](night-exploration.md).

## Edge cases

- A variant with no layers of its own simply shows the untagged layers.
- An exit whose target zone is locked by a condition is still validated (it exists), the game
  decides at runtime.
- A map edited in Tiled with external tilesets (`.tsx`) fails validation: embed the tileset.

## Test ideas

- Validator: missing `default` spawn, unknown object type, POI placed twice, exit to an unknown
  spawn, `variants` naming a variant the zone does not have → errors.
- Every MVP zone is reachable from every other through exits (graph test on the real content).
- Variant filter: a layer tagged `burned` is hidden in `wild` and shown in `burned`.
