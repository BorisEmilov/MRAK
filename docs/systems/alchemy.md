# Alchemy (herbs, tinctures, charms)

Status: v1 · MVP: ✅ (basic recipes) · Package: `packages/core/src/items/alchemy.ts` · Back to [GDD](../GDD.md) · [index](README.md)

## Purpose

Turn gathered herbs and materials into remedies, wards and ritual consumables. Grounded in real
folk medicine and ritual practice (marked [F]); effects are game abstractions [I].

## Data

- **Ingredients** (content): id, potency 1–3, tags (`calming`, `fever`, `warding`, `holy`, `dark`),
  season, best gathering time (dawn, Enyovden).
- **Recipes** (content): inputs, station (`hearth`, `herbalist-hut`, `chapel`, `crypt-altar`),
  skill (Herbalism / Craft / Liturgy / Occultism), difficulty, outputs.

Example MVP recipes:

| Recipe                           | Inputs               | Station       | Skill              | Output                                        |
| -------------------------------- | -------------------- | ------------- | ------------------ | --------------------------------------------- |
| Calming tea (St John's wort [F]) | 2 herbs `calming`    | hearth        | Herbalism, Easy    | Sanity +15 or villager Fear −20               |
| Fever brew (yarrow, elder [F])   | 2 `fever`            | herbalist hut | Herbalism, Average | cures treskavitsi                             |
| Garlic braid [F]                 | 3 garlic + thread    | hearth        | Craft, Easy        | amulet: −1S vs vampires & besove              |
| Consecrated oil                  | 2 oil + holy water   | chapel        | Liturgy, Average   | lantern blessing (light burst ×1.5 vs demons) |
| Incense (tamyan [F])             | resin + herbs `holy` | chapel        | Liturgy, Easy      | 3 incense                                     |
| Salt of Theophany                | salt + holy water    | chapel        | Liturgy, Easy      | thresholds (wards)                            |

## Rules

1. Brewing is a check ([omens](omens.md)): success → output; failure → half output or nothing;
   good omen → +1 dose or +1 potency; bad omen → a side effect (e.g. tea also causes vivid dreams).
2. Potency of inputs adds Fate dice: `+1F per potency above 1` (max +2F).
3. Herbs gathered **at dawn** +1 potency (talent), **on Enyovden morning** ×2 potency [F-inspired].
4. Dark recipes (blood, grave soil) add Corruption and are only visible with Occultism ≥ 2.

## Initial formulas

- Brew time: 30 min (hearth) to 2 h (chapel) in-world.
- Spoilage: herbal remedies lose 1 dose per 7 days unless dried (herbalist hut lvl 2).

## Events

- **Emits:** `alchemy/brewed { recipeId, doses, omen }`, `alchemy/failed`, `alchemy/sideEffect`.
- **Consumes:** `inventory/*`, `time/*`, `calendar` (Enyovden).

## Edge cases

- Missing station (chapel burned) → recipe hidden but known recipes stay in journal.
- Enyovden ×2 and dawn talent stack additively (+1 then ×2), documented order.

## Test ideas

- Recipe with all inputs succeeds deterministically for a fixed seed; output matches table.
- Potency 3 ingredients give exactly +2F (cap).
- Enyovden + dawn ordering: potency 1 herb ⇒ (1 + 1) × 2 = 4, capped at 3 → test cap.
- Dark recipe adds the declared Corruption and is hidden below Occultism 2.

## Implementation (v1): the mortar

Recipes are **discovered by experimenting** in the mortar of the guardian's house. Numbers in
`data/item-rules/default.json` (`alchemy`).

1. `grind { ingredients: [{ item, qty, potency? }] }` — 1–4 different items, 1–5 each. Only in
   the home zone. Ingredients come from the house store first, then the pack; missing →
   rejected, nothing consumed.
2. **Match:** the ingredients equal a recipe's `inputs` exactly (same items and quantities, any
   order). Recipes whose `visibleWhen` does not hold never match.
3. **Success:** the recipe is learned (`alchemy/discovered` the first time, also added to
   `guardian.unlockedRecipes`), the outputs are given **to the store**, `onBrew` effects apply
   and `minutes` of in-world time pass (as `advanceTime`: villagers live on, the lantern burns).
   - Potency = rounded mean of the ingredients' potencies (items without one count 1).
   - Extra doses = `potency − 1` (max +2), added to the first output.
   - Brews (outputs whose item has `useEffects`) carry that potency.
4. **Failure:** the ingredients are lost, `failMinutes` (15) pass, and the attempt is written in
   the **journal of experiments** (`alchemy.attempts`, newest last, at most 100) with a hint
   computed against every visible recipe:
   - `excess` — some recipe's inputs are all inside the attempt ("too much of something");
   - `missing` — the attempt is inside some recipe ("something is missing");
   - `kindred` — it shares an item with some recipe ("a familiar smell");
   - `nothing` — none of the above.
     Hints never name the recipe.
5. Known recipes are listed in the mortar with what they need; trying a combination already
   written in the journal asks for confirmation in the UI (the core allows it).
6. v1 has no check roll yet ([omens](omens.md) are not implemented): a match always succeeds.
   `station` is shown but not enforced until [village-growth](village-growth.md) gives
   buildings a state.

Events: `alchemy/brewed { recipe, doses, potency }`, `alchemy/discovered { recipe }`,
`alchemy/failed { hint }`.

Tests (`packages/core/src/items/alchemy.test.ts`): every content recipe is discoverable by
grinding its inputs; order does not matter; a wrong combination fails, consumes and logs the
right hint; potency raises doses with the +2 cap; store-first consumption; hidden recipes do not
match; only at home.
