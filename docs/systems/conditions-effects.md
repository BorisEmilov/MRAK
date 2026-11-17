# Conditions & Effects (content mini-language)

Status: v1 · MVP: ✅ · Package: `packages/content-schema/src/lang.ts` (schema) ·
`packages/core/src/conditions.ts` (evaluator) · Back to [GDD](../GDD.md) · [index](README.md) ·
data model: [content-model](content-model.md)

## Purpose

One small JSON language for every "when" and every "what happens" in content: quest objectives,
achievement conditions, talent effects, pact clauses, director events, mystery outcomes. Content
never contains code; core interprets this language.

## Data

An expression is a JSON object identified by its **operator key**. Ids are kebab-case and every
flag, stat, engine rule and check context must be declared in
`packages/content/data/flags.json` ([registry](#registry-flagsjson)).

### Conditions

| Operator             | Shape                                                                                  | True when                                                                                                       |
| -------------------- | -------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `all`                | `{"all": [cond, …]}` (≥ 1)                                                             | every sub-condition holds                                                                                       |
| `any`                | `{"any": [cond, …]}` (≥ 1)                                                             | at least one holds                                                                                              |
| `not`                | `{"not": cond}`                                                                        | the sub-condition does not hold                                                                                 |
| `flag`               | `{"flag": "witch-allied"}`                                                             | the flag is set                                                                                                 |
| `stat`               | `{"stat": "corruption", ">=": 40}` · `{"stat": "fear", "villager": "velika", ">": 50}` | the comparison holds; **exactly one** of `>= > <= < == !=`; `villager` required iff the stat is villager-scoped |
| `hasItem`            | `{"hasItem": "garlic", "qty": 2, "in"?: "pack"}`                                       | quantity in pack + house store (or only `in`: `pack` \| `storage`) ≥ `qty` (default 1)                          |
| `clue`               | `{"clue": "m1-ledger"}`                                                                | the clue was found                                                                                              |
| `talent`             | `{"talent": "litany"}`                                                                 | the guardian owns the talent                                                                                    |
| `calling`            | `{"calling": "znaharka"}`                                                              | the guardian has the calling                                                                                    |
| `pactSigned`         | `{"pactSigned": "crossroads-bargain"}`                                                 | the bloodline has signed the pact                                                                               |
| `chapter`            | `{"chapter": "unclean-days"}`                                                          | current chapter (festival)                                                                                      |
| `phase`              | `{"phase": "night"}`                                                                   | `dawn` \| `day` \| `dusk` \| `night`                                                                            |
| `villagerAlive`      | `{"villagerAlive": "velika"}`                                                          | the villager lives                                                                                              |
| `possessionRevealed` | `{"possessionRevealed": "velika"}`                                                     | a possession of that villager is known to the player (never the hidden truth)                                   |
| `quest`              | `{"quest": "unclean-days-chapter", "status": "active", "stage": "keep-watch"}`         | status/stage match (both optional)                                                                              |
| `mysteryConcluded`   | `{"mysteryConcluded": "wasting-bride", "correct": true, "culprit": "chorbadzhi-dimo"}` | concluded, and `correct`/`culprit` match if given                                                               |
| `chance`             | `{"chance": 0.25}`                                                                     | seeded roll on the `director` RNG stream                                                                        |
| `date`               | `{"date": {"from": "12-01", "to": "02-28"}}`                                           | today (Julian) is in the range, inclusive; may wrap the new year                                                |
| `moon`               | `{"moon": ["full", "waning-gibbous"]}`                                                 | tonight's moon phase is one of the list                                                                         |
| `festivalDay`        | `{"festivalDay": "enyovden"}`                                                          | today is the first day of that festival                                                                         |
| `collection`         | `{"collection": "songs", ">=": 3}` · `{"collection": "herbs", ">=": "all"}`            | collection progress of a category ([collection](collection.md)); `"all"` = complete                             |

### Effects

| Operator                      | Shape                                                                        | Does                                                                                          |
| ----------------------------- | ---------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `setFlag` / `clearFlag`       | `{"setFlag": "bridge-burned"}`                                               | sets / clears a flag                                                                          |
| `addStat` / `setStat`         | `{"addStat": "hysteria", "value": 10}` (+`villager` for villager stats)      | changes a stat, clamped to its declared `[min, max]`                                          |
| `giveItem` / `takeItem`       | `{"giveItem": "calming-tea", "qty": 2, "to"?: "storage"}`                    | pack by default ([inventory](inventory.md) rules 4–5); `takeItem` `from`: `pack` \| `storage` |
| `addClue`                     | `{"addClue": "m1-name"}`                                                     | adds a clue to its mystery's board                                                            |
| `grantCollectible`            | `{"grantCollectible": "grimoire-page-mamnik"}`                               | adds to the journal (drafts)                                                                  |
| `startQuest` / `failQuest`    | `{"startQuest": "…"}`                                                        | quest state                                                                                   |
| `startMystery`                | `{"startMystery": "wasting-bride"}`                                          | opens a mystery                                                                               |
| `addDebt`                     | `{"addDebt": "devils-luck"}`                                                 | adds a declared debt source (amount + creditor live there)                                    |
| `changeAffinity`              | `{"changeAffinity": "velika", "with": "todor", "value": -10}`                | omit `with` = toward the guardian                                                             |
| `startPossession`             | `{"startPossession": "mamnik", "host": "velika"}`                            | hidden possession begins                                                                      |
| `killVillager`                | `{"killVillager": "petko", "cause": "violence"}`                             | the villager dies ([villagers](villagers.md) rules 10–11: burial, return)                     |
| `triggerEvent`                | `{"triggerEvent": "bell-at-333"}`                                            | fires a director event now                                                                    |
| `unlockTree` / `unlockRecipe` | `{"unlockRecipe": "red-thread-amulet"}`                                      | unlocks                                                                                       |
| `setZoneVariant`              | `{"setZoneVariant": "samodivi-forest", "variant": "hostile"}`                | permanent zone state change                                                                   |
| `narrate`                     | `{"narrate": "narrate.some-key"}`                                            | a line in the journal / dawn report                                                           |
| `if`                          | `{"if": cond, "then": [eff…], "else": [eff…]}`                               | branch (`else` optional)                                                                      |
| `modifier`                    | `{"modifier": modifier}`                                                     | **passive** while the source is active (talent owned, gear equipped, node bought…)            |
| `ability`                     | `{"ability": {"uses": 1, "per": "night", "check"?: {…}, "effects": [eff…]}}` | activated ability with limited uses (`day` \| `night` \| `chapter` \| `year` \| `generation`) |
| `rule`                        | `{"rule": "mark-lies", "params": {"baseChance": 0.5}}`                       | named engine hook implemented in core (escape hatch for behaviour that is not a number)       |

### Modifiers (passive)

| Modifier      | Shape                                                                       | Meaning                                            |
| ------------- | --------------------------------------------------------------------------- | -------------------------------------------------- |
| `fateDice`    | `{"fateDice": 1, "skill"?: "persuasion", "context"?: "persuasion-private"}` | ± Fate dice on matching checks ([omens](omens.md)) |
| `shadowDice`  | `{"shadowDice": -1, "context": "vs-demon"}`                                 | ± Shadow dice                                      |
| `statBonus`   | `{"statBonus": "sanity-max", "value": 5}`                                   | flat bonus to a stat                               |
| `multiply`    | `{"multiply": "hysteria-gain-rate", "factor": 0.7}`                         | multiplier on a **rate** stat                      |
| `convertOmen` | `{"convertOmen": "bad-to-none", "context"?: "exorcism-cast-out"}`           | omen conversion                                    |

A modifier without `skill`/`context` applies to every check.

## Rules

1. **Parse first:** content is parsed with the Zod schema; core evaluates only parsed values. Types
   come from `z.infer` in `@mrak/content-schema` (never redefined in core).
2. **Pure:** evaluation never mutates state; effects are applied by core as commands and emit
   domain events ([world-state](world-state.md)).
3. **Order:** effects in a list apply in order. `if` evaluates its condition once, before its branch.
4. **Stats clamp** to their declared range; rates (`*-rate`) are multiplied, never added to.
5. **Stacking:** dice modifiers add up; conversions apply after rolling (talents → Faith →
   Corruption, see [omens](omens.md)); `multiply` modifiers multiply together.
6. **Hallucination events must not set flags** (enforced by the schema) — they only touch the guardian.
7. **`rule` hooks** are the exception, not the norm: prefer a modifier or a plain effect. Each rule
   is declared in the registry with its parameter names; unknown params are rejected.

### Registry (`flags.json`)

```json
{
  "flags": [{ "id": "bell-rang-333", "description": "…" }],
  "stats": [
    { "id": "fear", "scope": "villager", "min": 0, "max": 100, "default": 10, "description": "…" }
  ],
  "rules": [{ "id": "mark-lies", "description": "…", "params": ["baseChance", "perWits"] }],
  "contexts": [{ "id": "vs-demon", "description": "…" }]
}
```

Stat scopes: `guardian`, `village`, `villager`, `world`, `profile`. No flag, stat, rule or context
may appear in content without being declared here.

## Initial formulas

None (language). Comparators use exact numeric comparison; `chance` uses `random.next() < p`.

## Events

- **Emits** (when effects are applied by core): the events of the systems they touch
  (`flag/set`, `stat/changed`, `inventory/itemAdded`, `quest/started`, `debt/added`…).
- **Consumes:** none.

## Edge cases

- `stat` on a villager who died → value of a dead villager is frozen; use `villagerAlive` to guard.
- `chance` inside `all` is evaluated only if earlier operands held (short-circuit; RNG consumption
  depends on order — keep `chance` last for stable seeds).
- `ability` inside `ability` is rejected by convention (validator warning planned).

## Test ideas

- Every operator parses its documented example; unknown keys, empty `all`, snake_case ids,
  `chance > 1`, two comparators are rejected (`lang.test.ts`).
- Evaluator truth table for every condition operator (`packages/core/src/conditions.test.ts`).
- Reference walker finds refs nested in `if`/`then`/`ability` with exact JSON paths.
- `chance` is reproducible with the same seed.
- Registry: an undeclared flag/stat/rule/context and an undeclared rule param are errors.
