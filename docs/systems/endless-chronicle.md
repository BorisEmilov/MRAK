# Endless Chronicle

Status: Draft v0.1 · MVP: ❌ · Package: `packages/core/endless` · Back to [GDD](../GDD.md) · [index](README.md)

## Purpose

After the main story, the years and generations continue: procedural mysteries, possessions and
festivals with rising **Darkness levels** and rare late-game rewards — growth that stays
meaningful without infinite power creep ([progression-economy §8](progression-economy.md#8-endless-chronicle--growth-without-power-creep)).

## Data

- `meta.mode = "endless"`, `meta.darknessLevel` 1–10.
- Templates: `endless/mysteries/*.json` (roles: victim, culprit, false suspects; motive set; clue
  templates bound to villagers by traits), `endless/possessions/*.json`, `endless/festivals/*.json`.

## Rules

1. Unlocked after any route ending; starts the year after the ending with the current family.
2. Each in-world year = 6 festival chapters with procedurally assembled content:
   1 procedural mystery, 1–2 possessions, 1 villager arc, festival variant.
3. **Procedural mysteries** bind template roles to real villagers by traits (e.g. "debtor",
   "outsider") and ensure validator rules (≥ 2 solid clues for the culprit, exonerating clues for each false suspect).
4. **Darkness levels:** chosen at year start (up to highest unlocked + 1). Effects in progression-economy §8.
5. **Relic talents** unlock at Darkness 3/5/7/10: alternative versions of existing talents (horizontal).
6. Historical references after 1878 are light-touch: the world changes (borders, new state), never re-enacted.
7. Seasonal live events ([seasonal-events](seasonal-events.md)) plug into the year when their real date arrives.

## Initial formulas

- Darkness: creature strength ×(1 + 0.1 × level); debt chance +5% × level; rituals +1S at 3/6/9.
- Legacy multiplier ×(1 + 0.1 × level).

## Events

- **Emits:** `endless/yearStarted { darknessLevel }`, `endless/mysteryGenerated`, `endless/relicTalentUnlocked`.
- **Consumes:** `time/*`, `lineage/*`.

## Edge cases

- Template binding fails (not enough villagers with required traits) → choose another template; if none, a village-growth event (new family) is injected first.
- Village population 0 → chronicle ends.

## Test ideas

- 10,000 generated mysteries pass the same validator as handcrafted ones.
- Same seed ⇒ same generated year.
- Darkness 10 values match formulas; Legacy multiplier 2.0.
- Relic talents replace (never add) a talent in a tree.

## Implementation (v1)

- Core: `packages/core/src/chronicle/endless.ts`; rules in `fear-rules.endless` (mystery
  templates, possessions, harvests/disasters, Chronicle goals, relic talents); `darkness-levels` 1–10.
- Unlocked by any completed `route` quest (`endless/unlocked`); `startEndless { darkness }`,
  `setDarkness { level }` (up to the best played + 1, by day; level effects replace the previous
  ones under source `darkness`). Darkness raises creature strength and **cunning** (stat
  `creature-cunning-rate`: sight and hearing), debt and hysteria, Shadow dice at 3/6/9, and the
  Legacy multiplier.
- Each endless year (natural or `skipYears`): last year's open case goes unsolved; newcomer
  families become villagers if too few remain (`endless.villagers`, re-registered on load);
  a mystery is generated from a template (roles bound to living villagers, culprit preferred by
  traits; ≥ 2 solid culprit clues, one exonerating clue per false suspect, a lying witness when a
  suspect has a secret) and must parse with the Mystery schema; 0–2 lesser possessions (two
  demons in one host from `combineFrom`); one weighted harvest or disaster.
- Relic talents (`chooseRelic`): replace a tree cell's talent for the line, never add one.
  Soft caps stay as in progression §8.
- Chronicle board (`chronicleGoals`): village, lineage and collection goals; a reached goal pays
  its Legacy once to the profile. UI: Village panel → Chronicle tab.
- Tests: `chronicle/endless.test.ts` (100-year bot), `apps/game/src/host/chronicle.test.ts`
  (100 years with the real content; every generated mystery passes the full content validator).
