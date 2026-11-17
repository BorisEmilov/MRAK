# Onboarding: tutorial hints and glossary

Status: Draft v0.1 · MVP: ✅ · Package: `packages/content-schema` (Hint, GlossaryEntry) +
`apps/game/src/onboarding/` · Back to [GDD](../GDD.md) · [index](README.md)

## Purpose

Teach a complex game without a separate tutorial: the **prologue** (Stana, 1779) and the **first
night** carry the lessons, delivered as short contextual hints when they become relevant. A glossary
of folklore, history and game terms is one key away from any screen.

## Data

- **Hint** (`data/hints/*.json`): `{ id, tier, titleKey, textKey, icon?, phase: prologue |
first-night | contextual, on: trigger, when?: Condition, priority, glossary?: term ids }`.
  Triggers (`on`): `game-started`, `zone-entered`, `night-started`, `dawn`, `decision-recorded`,
  `item-added`, `stat-changed`, `interaction-available`, `low-sanity`.
- **GlossaryEntry** (`data/glossary/*.json`): `{ id, tier, termKey, descKey, category: folklore |
history | game, origin }` (mirrors [docs/lore/glossary](../lore/glossary.md)).
- **Progress** (device-level, not game state): seen hint ids and the hints on/off switch in the
  options storage (`mrak.options.v1`). Starting a new game from the menu never resets it; the
  option "Reset hints" does.

## Rules

1. A hint shows when its trigger fires, its `when` condition holds (core condition language,
   evaluated by the host against the current snapshot) and it has not been seen.
2. At most **one hint at a time**; others queue by `priority` (higher first), max 3 queued. A hint
   stays until dismissed or until 20 s pass without the HUD being faded (then it is marked seen).
3. Hints never pause the game, never cover the centre of the screen, and are announced politely
   (`aria-live="polite"`). Each has "Got it" and "Turn hints off".
4. Prologue and first-night hints are the tutorial; contextual hints cover later systems.
5. Terms linked in a hint open the glossary at that entry.
6. **Glossary:** `F2` or the `?` button from any screen (menu, HUD, pause); searchable, tabs by
   category; terms keep the transliterated name with an English explanation (CLAUDE.md).

## Events

- Consumes core: `world/zoneEntered`, `time/nightStarted`, `time/dawn`, `state/decisionRecorded`,
  `inventory/itemAdded`, `state/statChanged`; UI bus: `world:interaction`.

## Edge cases

- Hints off → nothing is queued; turning them on again does not replay seen hints.
- Loading a save mid-game does not replay prologue hints already seen.

## Test ideas

- First night start shows the first-night hint once; second night does not.
- `when` false → not shown; queue ordering by priority.
- Glossary search finds "karakondzhul"; every glossary/hint locale key exists (content:validate).
