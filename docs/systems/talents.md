# Talents

Status: v1 (implemented, see [progression](progression.md)) · MVP: ✅ (4 trees + 1 dark) · Package: `packages/core/guardian/talents` · Back to [GDD](../GDD.md) · [index](README.md) · content: [talent-trees](../lore/talent-trees.md)

## Purpose

Specialization trees: grids of connected talents bought with Revelation. They define a guardian's
build and are **lost on death** — only the journal carries knowledge forward.

## Data

- Content `talents/trees/*.json`: `{ treeId, callingId | "dark", unlockCondition, cells: [{ cell: "A1",
talentId, tier, prereqs: ["A1"|"B2"…], corruption? }] }`.
- Content `talents/*.json`: `{ id, tier, nameKey, descKey, effects: Effect[], ranked }`.
- State: `guardian.talents: { treeId, cell }[]`, `guardian.talentRanks: Record<talentId, n>`.

Effects use the [condition & effect language](conditions-effects.md) (e.g.
`{ "modifier": { "fateDice": 1, "context": "exorcism-confront" } }`), interpreted by core — no
effect is hardcoded per talent.

## Rules

1. Buying requires: tree owned, all prereqs (any of an "or" list) owned, enough Revelation.
2. Costs: T1 5 · T2 10 · T3 15 · T4 20; foreign trees +5 per talent.
3. **Ranked talents** (e.g. Grit) stack across trees.
4. **Dark trees** unlock only via `unlockCondition` (pact signed / betrothal). Each purchase adds
   the cell's Corruption; Bride of the Forest also requires erasing a journal entry.
5. No refunds, except the "Cycle" reset ([lineage](lineage.md)) and content migrations.
6. Usage-limited talents ("once per night/chapter/generation") track charges in state.

## Initial formulas

Costs above; dark Corruption: T1 +4, T2 +6, T3 +9, T4 +12. Debt scaling: `bonus = floor(debt / 10)`
unless a talent says otherwise.

## Events

- **Emits:** `talent/bought { treeId, cell }`, `talent/chargeUsed`, `talent/chargesReset`.
- **Consumes:** `revelation/*`, `pact/signed`, `time/nightStarted` (reset per-night charges),
  `time/chapterStarted`, `lineage/generationEnded` (clear talents).

## Edge cases

- Prereq "C2 or B2" when both are owned → fine; removing neither is possible (no refunds).
- Effect stacking order: additive dice first, then conversions (bad omen → neutral), then rerolls.
- A talent referencing a system absent from the demo build → hidden in demo.

## Test ideas

- Content validation: every tree is 4×3, tiers match rows, every prereq references an existing
  cell in a lower or same row, no cycles.
- Buying B3 without B2 is rejected; with "C2 or B2" either suffices.
- Dark talent purchase adds exact Corruption; Bride talent erases one journal entry.
- Talents are cleared on `lineage/generationEnded`, Bloodline nodes remain.
- Effect application order produces deterministic results for a fixed seed.
