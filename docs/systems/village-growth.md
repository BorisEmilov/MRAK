# Village growth

Status: Draft v0.1 · MVP: ✅ (3 buildings, prosperity 1–2) · Package: `packages/core/village/growth` · Back to [GDD](../GDD.md) · [index](README.md) · pacing: [progression-economy §6](progression-economy.md#6-village-pacing)

## Purpose

The village is the second thing that grows: buildings, people, reputation, prosperity. It can
also shrink — every scar is permanent (pillar 2).

## Data

- `buildings[]`: `{ id, level 0–3, condition 0–100, talasam? }`.
- `village.prosperity` 1–5 (derived from a 0–500 score), `village.population`.
- `village.reputation` with factions: `church`, `aga`, `haiduti`, `zlatno`, `forest` (−100..100).

| Building            | Lvl 1                            | Lvl 2                   | Lvl 3                        | MVP |
| ------------------- | -------------------------------- | ----------------------- | ---------------------------- | --- |
| **Chapel**          | services, vigils, holy water     | +oil cap, crypt altar   | relic shrine, Sanity regen + | ✅  |
| **Herbalist's hut** | herb storage, fever cures        | drying (no spoilage)    | Enyovden garden              | ✅  |
| **Watchtower**      | early warning, watch defence +10 | signal fire = safe zone | bell, defence +30            | ✅  |
| School              | Lore/Investigation training      | villagers learn skills  | chitalishte (after 1856)     | —   |
| Workshop            | blessing gear without chapel     | iron & silver working   | heirloom repair              | —   |
| Granary             | food cap +                       | rot protection          | trade with Zlatno            | —   |

## Rules

1. Building costs materials (firewood, iron, wax, silver) + villager labour days (tasks).
2. Prosperity score: `+` buildings, population, festivals observed, trade; `−` deaths, curses,
   debt collections, lynchings, aga fines.
3. Prosperity levels unlock villagers (families arrive), traders and events.
4. Population changes: births, marriages (wedding events), deaths, emigration when prosperity ≤ 1 for a year.
5. The village **ages** over generations: villagers' children grow up and take trades.
6. Destroyed buildings stay as ruins until rebuilt (zone variant).

## Initial formulas

- Prosperity thresholds: 0 / 80 / 180 / 300 / 420 → levels 1–5.
- Chapel lvl 1 cost: 20 firewood, 5 wax, 6 labour-days. Each level ×1.8.

## Events

- **Emits:** `village/buildingBuilt`, `village/buildingUpgraded`, `village/buildingDestroyed`,
  `village/prosperityChanged`, `village/villagerArrived`, `village/villagerLeft`, `village/reputationChanged`.
- **Consumes:** `task/completed`, `debt/collected`, `hysteria/lynching`, `time/chapterEnded`, `time/yearSkipped`.

## Edge cases

- Prosperity drop below a building's unlock level → building keeps working (no take-backs), new ones blocked.
- The last villager of a trade dies → that production stops until a new villager arrives.

## Test ideas

- Prosperity level from score boundaries 79/80, 179/180.
- Building lvl 2 chapel raises oil cap by 10.
- Year skip with prosperity 1 for the whole year triggers emigration of one family.

## Implementation (v1)

- Core: `packages/core/src/chronicle/growth.ts`. Rules: `village-rules.growth` (prosperity
  thresholds and level unlocks, population rates, name/trade/secret pools for newcomers).
- **Buildings:** `build { building, shadow? }` takes materials from the house store, pays a level's
  `blood` price (the `immured-shadow` sacrifice: the chosen villager is doomed) and opens a project.
  Villagers on the `construction` task add labour days (rule `construction-labour`); unfinished
  work is done by the year's end. A finished level applies its effects (`building:<id>`) and its
  `prosperity`. Levels may need a prosperity level (`minProsperity`) or a condition.
- **Prosperity:** the `prosperity-score` stat. `+` levels built, chapters observed, residents
  each year; `−` deaths, lynchings, debt collections and a yearly upkeep. A first-reached level
  applies `levelEffects` once (traders, the fair, newcomers of better standing).
- **Population:** content villagers plus generated `village.people`. Each new year (or
  `skipYears`): the old die (chance per year past `elderAge`, certain at `maxAge`), singles marry,
  couples have children, newcomers arrive with a secret (chance by prosperity level), families of
  newcomers flee at prosperity 1, children of age take a trade. `village.log` keeps one line per year.
- **Festival chapters** (`festivals[]`): `threatKey`, `threats`, `rules` (applied at chapter start,
  their modifiers lifted at the end), `quests` (missions), `rites` (one option per rite per
  chapter, an optional check rolled with omen; `performRite`), `onEnd` (Revelation milestones).
  Kukeri rings out hidden possessions (`surface-possessions`) and has the empty mask; Nestinari is
  the ember dance (a dire Faith check); Zadushnitsa raises every badly buried dead (`restless-dead`).
- UI: Village panel → Buildings tab (costs, labour, blood, benefits, work under way); the map
  shows each building at its POI (`buildings[].poi`); the chapter card shows the threat and rites.
