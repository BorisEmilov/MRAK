# Night exploration

Status: v1 · MVP: ✅ (Village, Samodivi Forest, Monastery) · Package: `packages/core/src/world/` + `apps/game/src/game/` · Maps: [maps](maps.md) · Back to [GDD](../GDD.md) · [index](README.md)

## Purpose

The roguelite half: walk out into the same map you manage by day, transformed — fog, shifting
paths, creatures, procedural events — and come back before dawn with what you learned.

## Data

- **Zones** (handcrafted Tiled maps): `village`, `samodivi-forest`, `crossroads`, `monastery`,
  `mine`, `lake-of-the-drowned`, `zlatno`, `thracian-fortress`.
- **Variants** per zone: `normal`, `night`, plus state variants (`allied`, `hostile`, `burned`,
  `flooded`, `consecrated`…) chosen from WorldState flags.
- **Path graph** per zone: nodes (clearings, POIs) and edges (paths), some edges marked `shifting`.
- POIs: clue spots, herb spots, shrines, graves, wells, ruins, haidut caches.

## Rules

1. The guardian leaves at dusk with a chosen pack; night time runs in real time
   ([time-calendar](time-calendar.md)).
2. **Fog** reduces visibility to the light radius ([light](light.md)).
3. **Shifting paths:** each hour, `shifting` edges re-wire within their allowed set (seeded) — the
   forest "moves". Landmarks (the well, the oak) never move.
4. **Procedural layer:** POI contents, creature spawns and minor events are generated from tables
   per zone variant and chapter, seeded by `(seed, night)`.
5. **The village keeps living** in real time: tasks progress, director events fire, attacks
   happen; the guardian hears the bell from afar (audio cue).
6. **Return** before dawn to avoid the dawn penalty; returning early is always allowed.
7. Zone states change permanently with choices (burned forest, flooded mine, consecrated monastery).
8. MVP: Village, Samodivi Forest (with the crossroads at its edge), Monastery ruins.

## Initial formulas

- Shifting: each `shifting` edge has a 30% chance per hour to swap with an alternative.
- Creature spawn budget per hour: `2 + chapterIntensity + darknessLevel/2`.

## Implementation (v1)

Code: `packages/core/src/night/` (`ai.ts` pure state machine, `night.ts` expedition), scene
`apps/game/src/game/night/NightCreatures.ts`, HUD `ui/hud/NightPanel.tsx`; numbers in
`fear-rules.night` and each creature's `ai`.

- **Objective:** at nightfall one of `originCandidates` is tonight's origin; interacting with the
  candidates finds it (`night/originFound`), entering `homeZone` afterwards completes the night.
- **Encounters:** on each director tick, with `spawnChance[phase]`, a creature of the zone (its
  `activeWhen` holding; weighted by threat × tension) appears at a spawn POI of the guardian's zone.
- **AI:** patrol → suspicious (hears noise: distance ≤ noise × `hearing`) → hunt (sees: `sight`,
  - light radius when lit, halved in the dark) → loses it after `memory` s; `fleeLight` creatures
    flee the lantern radius and the flash. The scene reports contact as `creatureStrikes`.
- **Actions** (`nightAction`): flash (lantern oil), ritual with a weakness item, strike, dodge,
  flee, sneak — checks with attributes, skills, talents, blessed gear and omens (context
  `vs-creature`). At 0 health: Last Breath check → wake at home, or death → `lineage`
  (`awaitingHeir`, `lineage/heirNeeded`) instead of a game over.
- **The village calls:** while away at night, deaths, mobs, village director events and attacks
  emit `village/alert`, shown as a notice and a directional caption toward the road home.

## Events

- **Emits:** `world/enteredZone`, `world/zoneDiscovered`, `world/poiInteracted`, `world/pathsShifted`,
  `world/zoneVariantChanged`.
- **Consumes:** `time/*`, `director/eventFired`, `light/*`.

## Edge cases

- Path shift isolates the guardian from all exits → guarantee at least one exit path always exists (validated).
- Guardian inside a POI interior during a shift → shift applies after leaving.
- Zone variant change while the player is in it → applies next night.

## Implementation (v1)

### Zone data (`data/zones/*.json`)

- `pois[]`: `{ id, kind, nameKey, descKey?, action, effects[], once }` — placed in the map by a
  `poi` object. `action` is the interaction verb shown in the HUD prompt.
- `paths`: `{ nodes[{ id, exit }], edges[{ id, from, to, when?, shift? }] }`. An edge is open
  when its `when` condition holds (e.g. `{"phase":"night"}`, `{"stat":"corruption",">=":50}`).
  Edges sharing a `shift` group are alternatives: by day the first is open; at night exactly one
  is open, re-chosen each in-world hour (30 % chance to move, seeded by the chronicle seed, zone,
  group, night and hour — never by the game's RNG streams, so looking does not change the world).
- **Connectivity:** after choosing, if some node cannot reach an `exit` node, shift groups are
  re-chosen (in order, first alternative that reconnects) until every node can. Pure function
  `openPaths(zone, ctx)` in core.
- `fog` (0–1): night fog density of the zone.

### State

`zones[id]` gains `explored` (bitset of 2 × 2-tile cells, base64), `pois` (discovered) and
`used` (POIs whose `once` effects were applied). `explorer.noise` (0–10) is the guardian's noise.

### Commands

`revealCells { zone, cells[] }` (≤ 1024 per command), `discoverPoi { zone, poi }`,
`interactPoi { zone, poi }` (applies the POI's effects; once-POIs only the first time),
`makeNoise { level }`.

### Guardian (presentation)

- 8-direction movement: keyboard (remappable `move-*`), gamepad (left stick, d-pad) and mouse
  (hold the left button: walk towards the pointer). Walk 4 tiles/s; **run** (`run` action, held)
  ×1.6 and makes noise 6 (walking 2); noise decays 2 per in-world minute.
- Arcade physics against the map's collision layers and closed path areas.
- **Contextual interaction:** the nearest POI within 1.5 tiles shows the HUD prompt
  (`world:interaction`); the `interact` action (or a click on it) sends `interactPoi`.
- **Lantern:** `lantern` action lights/puts out; the HUD shows lit/unlit and the oil reserve.

### Zones and transitions

- Walking into an `exit` area: `enterZone`, fade out, the next zone's assets load lazily (the
  simulation pauses meanwhile), assets used only by the previous zone are unloaded, fade in at
  the target spawn, and the zone name is announced.
- The variant (`Game.zoneVariant`) is read when a zone loads; layers and objects tagged with
  `variants` follow it. Variant changes while inside apply on the next load (edge case above).

### Shifting paths (presentation)

Closed path areas are blocked (solid) and covered with thicket/rubble and fog; when the open set
changes the change fades in with a caption ("Branches creak") and a light shake (honours
"reduce shake").

### Camera

Smoothed follow (lerp 0.1, small dead zone), bounded to the map, whole-pixel rendering; shakes
only through `ScreenFx` (respects the accessibility options).

### Player map (`map` action, M)

Drawn from what the guardian has seen: cells within the reveal radius (8 tiles by day, the
lantern radius — min 3 — at night) are revealed; POIs within that radius are discovered and shown
with their icon and name (tooltip), plus a text list for screen readers. The map does not pause
the night.

## Test ideas

- Graph connectivity: after any shift, every node can reach an exit (property-based test).
- Same seed + night ⇒ same POI contents.
- A burned forest flag loads the `burned` variant and removes herb POIs.
- Village simulation produces identical outcomes regardless of the guardian's zone.
- `openPaths`: night-only edges closed by day; corruption edges open at ≥ threshold; same
  seed/night/hour ⇒ same choice; querying never advances the RNG streams.
- `interactPoi` on a once-POI applies its effects once.
- Explored bitset round-trips; revealing is idempotent.
