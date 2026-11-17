# Photography (the daguerreotype)

Status: v1 · MVP: — (GDD: daguerreotypes are "full vision"; built early as a system) · Package: `packages/core/src/items/photography.ts` · Back to [GDD](../GDD.md) · [index](README.md)

## Purpose

The camera sees what the eye refuses: presences, the possessed, symbols scratched where nobody
looks. A photograph is slow and costly, and it proves nothing to the village — but it tells the
player something is there (pillar 4: the plate could be flawed).

## Data

- Item `daguerreotype-camera` (tool, unique) and item `photographic-plate` (consumable).
- `item-rules` → `photography { camera, plate, minutes, albumSize, rangeTiles }`.
- `photo-layers/*.json`: `{ id, kind: presence | possessed | symbol, nameKey, descKey, target,
when?, effects }`, `target` = `{ villager: id | "*" , possessed?: true | demon }`,
  `{ zone, poi }` or `{ zone }` (anywhere in the zone).

## Rules

1. `takePhotograph { subject }` with `subject` = `{ villager }`, `{ zone, poi }` or `{ zone }`
   (the place itself). Needs the camera and a plate **in the pack**; the subject must be in the
   current zone. Consumes one plate; `minutes` (10) of in-world time pass (a long exposure).
2. The plate shows every layer whose target matches the subject and whose `when` holds.
   `possessed: true` matches a villager who hosts **any** possession, hidden or not;
   `possessed: "<demon>"` only that demon. Place layers (`{ zone }`) also show on photos of POIs
   and villagers in that zone.
3. A layer revealed for the first time applies its `effects` (e.g. a clue) and counts for the
   collection. Photographing does **not** mark a possession as revealed: only the player knows.
4. The **album** keeps photos `{ id, day, minute, zone, subject, layers }` (`albumSize` = 48);
   full → rejected until one is discarded (`discardPhoto { id }`).
5. Anachronism: the daguerreotype exists from 1839. No content gives the camera before then;
   the 1834 start does not include it (debug console: `give daguerreotype-camera`).

## Events

`photo/taken { id, subject, layers }`, `photo/layerRevealed { layer }`, `photo/discarded`.

## Presentation

The album renders each plate procedurally in sepia: villager portraits from their look, POIs as
their icon on a vignette; each layer is drawn as a faint overlay (a second face for the
possessed, a figure for presences, a mark for symbols) with its caption. A flash and a short
fade in the world when the shutter closes (reduced with "reduce motion").

## Tests

`packages/core/src/items/photography.test.ts`: photographing a possessed villager shows the
possessed layer, an ordinary one does not; demon-specific layers; place layers; plate consumed,
time passes; no camera / no plate / wrong zone rejected; first reveal applies effects once;
album limit and discard.
