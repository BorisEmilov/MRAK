# ADR 0006 — Tiled (JSON `.tmj`) for zone maps

- Status: accepted
- Date: 2026-11-16
- Back to [GDD](../GDD.md) · specs: [maps](../systems/maps.md),
  [night-exploration](../systems/night-exploration.md), [light](../systems/light.md)

## Context

The MVP needs three handcrafted zones (Village, Samodivi Forest, Monastery) with ground,
decoration, collision, interactive objects, spawn points, light sources, exits, shifting paths and
state variants (allied, hostile, burned…). The two realistic editors are **Tiled** and **LDtk**.

| Criterion                        | Tiled                                               | LDtk                                                      |
| -------------------------------- | --------------------------------------------------- | --------------------------------------------------------- |
| Phaser 4 support                 | **Native**: `load.tilemapTiledJSON`, `make.tilemap` | None: needs our own parser/converter                      |
| Lighting / normal maps on layers | Tilemap layers have the `Lighting` component        | Same, but only after converting to a Phaser tilemap       |
| Object data                      | Free-form objects with typed custom properties      | Strongly typed entities (nicer), own JSON shape           |
| Format stability                 | JSON format stable since 1.0; diffs well            | Stable, but one big project file for all levels           |
| Per-zone lazy loading            | One file per map                                    | One project file (or "separate level files" option)       |
| Tooling cost for us              | A schema for the subset we use + validation         | A converter + its tests + keeping up with format versions |

## Decision

- Zones are **Tiled maps saved as JSON (`.tmj`)** in `packages/content/maps/`, one per zone (a
  variant may point to its own map, but variants are normally layers inside the same map).
- Tilesets are **embedded** in the map and point to PNGs in `packages/content/maps/tilesets/`
  (one per zone, 16 px tiles), so a map opens in Tiled without extra files.
- Fixed layer names and object types (`docs/systems/maps.md`) are the contract between designers
  and code; `pnpm content:validate` checks every map against its zone data.
- Normal maps are generated from the tileset/atlas art by the asset pipeline; a hand-painted
  `<name>_n.png` next to the source wins when present.
- Maps go through the asset pipeline (hashed, lazy-loaded per zone), not the content bundle.

## Consequences

- ✔ No converter: Phaser parses the maps; less code to maintain and test.
- ✔ Designers can use any Tiled ≥ 1.10; custom properties carry variants, lights and POIs.
- ✘ Tiled's untyped custom properties need validation (done by the content validator).
- ✘ Map JSON lives outside the Zod-typed collections: the validator reads it as a separate input.
- The first maps were scaffolded by `apps/game/scripts/scaffold-maps.ts` (placeholder art). From
  now on the `.tmj` files are the source of truth; the scaffolder refuses to overwrite them
  without `--force`.
