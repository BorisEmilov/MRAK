# Content model & validation pipeline

Status: v1 · MVP: ✅ · Packages: `packages/content-schema` (model, validator, CLI) ·
`packages/content` (data) · Back to [GDD](../GDD.md) · [index](README.md) · decision:
[ADR 0002](../adr/0002-content-as-data.md) · language: [conditions-effects](conditions-effects.md)

## Purpose

All game content is data, described by **Zod schemas** (the source of truth), exported as **JSON
Schema** for the editor and the API, and checked by one CLI before it can ship.

## Data

### Layout of `packages/content`

```
data/
  flags.json                 registry: flags, stats, rules, check contexts
  <collection>/*.json        one entity or an array of entities per file
locales/en.json              every player-facing string (flat key → text)
manifest.json                generated: version + per-file hashes + pack hash
```

### Collections

| Folder                                  | Schema             | Notes                                                                                      |
| --------------------------------------- | ------------------ | ------------------------------------------------------------------------------------------ |
| `attributes`, `skills`                  | Attribute, Skill   | skill → attribute                                                                          |
| `virtues`, `sins`                       | Virtue, Sin        |                                                                                            |
| `callings`                              | Calling            | 2 attributes, 6 skills, 3 starting ranks ⊂ calling skills, trees, ability                  |
| `trees`                                 | SpecializationTree | grid `columns × rowCosts.length`, nodes `{cell, talent, requires[], cost?, tier?}`         |
| `talents`                               | Talent             | effects in the [effect language](conditions-effects.md)                                    |
| `villagers`                             | Villager           | fears, relationships, secrets with `revealWhen`                                            |
| `demons`, `creatures`                   | Demon, Creature    | true name, seal, symptoms by stage, weaknesses, desires                                    |
| `items`, `gear`, `blessings`, `recipes` | …                  | blessing durations: uses / nights / permanent                                              |
| `collectibles`, `cursed-objects`        | …                  | `minYear` for anachronism control (daguerreotypes ≥ 1858)                                  |
| `events`                                | DirectorEvent      | noise / seed / hallucination / set-piece                                                   |
| `quests`                                | Quest              | stages → objectives (conditions)                                                           |
| `mysteries`                             | Mystery            | suspects, causes, remedies, clues (propositions), solution, outcomes per suspect, unsolved |
| `pacts`, `debt-sources`                 | Pact, DebtSource   | hidden clauses with `delayNights` or `when` triggers                                       |
| `festivals`, `zones`                    | Festival, Zone     | Julian fixed date or Easter offset; zone state variants                                    |
| `omen-tables`                           | OmenTable          | 6 outcomes (success/failure × good/none/bad) per check context                             |
| `buildings`                             | VillageBuilding    | levels 1..n with costs and effects                                                         |
| `bloodline-nodes`, `darkness-levels`    | …                  |                                                                                            |
| `seasonal-events`                       | SeasonalEvent      | real-world `MM-DD` window, `free` or `sku-…`                                               |
| `achievements`                          | Achievement        | condition                                                                                  |

### Conventions

- **Ids:** stable kebab-case (`baba-neda`), unique per collection; clue ids unique across mysteries.
  Never rename a shipped id (saves reference it) — add a migration instead.
- **Text:** every player-facing string is a localization key `area.id.field`
  (`villager.baba-neda.bio`), present in `locales/en.json`.
- **Tier:** every entity has `tier: "demo" | "full"`. Tree nodes may override (`tier`) so a demo
  tree can contain full-game rows 3–4.
- **Origin:** lore entities state `origin: folklore | history | invented`.

## Rules (what `pnpm content:validate` checks)

1. **Schema:** every file parses with its schema (strict: unknown fields are errors).
2. **Unique ids** per collection.
3. **References:** every id points at an existing entity of the right kind — found automatically
   from the schemas (`ref(kind)` fields), including inside nested conditions and effects.
4. **Registry:** flags, stats, rules (and their params) and contexts are declared in `flags.json`;
   villager-scoped stats name a villager, others don't.
5. **Localization:** every key exists in `en.json`.
6. **Demo never depends on full:** a demo entity (or demo tree node) may not reference full content;
   a demo node must be reachable through demo nodes.
7. **Trees:** cells inside the grid; no duplicates; prerequisites exist and sit in the same or an
   earlier row; row 1 has none and later rows have some; **no cycles**; **no unreachable nodes**;
   **costs strictly increase by row** (including overrides); dark trees declare `unlock` and
   `rowCorruption`; calling trees name their calling and the calling lists them.
8. **Mysteries:** propositions name real suspects/causes/remedies; the true culprit has ≥ 2 solid
   clues and the true cause ≥ 1; every false suspect has an exonerating clue and an innocence text;
   an outcome exists for every suspect.
9. **Misc:** building levels 1..n in order; one symptom per stage ≤ `maxStage`; named demons have a
   seal; zone default variant exists; pact delay `min ≤ max`; seasonal dates exist; no
   self-relationships.
10. **Manifest:** present and up to date (see below).

## Initial formulas

- **File hash:** SHA-256 of the file's canonical JSON (`JSON.stringify(JSON.parse(file))`), so
  reformatting does not change it.
- **Pack hash:** SHA-256 of the sorted lines `<path>:<fileHash>\n`.
- Per-file size limit 2 MB (asset rule in CLAUDE.md).

## Commands

| Command                 | Does                                                             |
| ----------------------- | ---------------------------------------------------------------- |
| `pnpm content:validate` | all checks above; exit 1 on any error (runs in CI)               |
| `pnpm content:manifest` | rewrites `packages/content/manifest.json` (keeps packId/version) |
| `pnpm content:schema`   | exports JSON Schemas to `packages/content-schema/json-schema/`   |

The JSON Schemas (draft 2020-12, generated with Zod 4's native `z.toJSONSchema`) cover structure;
cross-field rules (exactly one comparator, references, trees, mysteries) are only enforced by the
validator, which the editor and the API should call as well.

## Events

None at runtime. The studio editor consumes `Issue { severity, code, message, file, entity, path }`.

## Edge cases

- A file that fails JSON parsing is reported (`invalid-json`) and skipped; other files still validate.
- An invalid locale key does not hide the valid ones (no cascade of missing-key errors).
- A folder under `data/` that is not a known collection is an error (typo protection).

## Test ideas

Implemented in `packages/content-schema/src/**/*.test.ts`: the sample pack is valid and has the
requested MVP contents; and **broken cases fail** — non-kebab ids, invalid talent effects, missing
comparators, hallucinations setting flags, duplicate ids, undeclared flags/stats/rule params,
missing entities and locale keys, villager stats without a villager, unknown zone variants, demo →
full dependencies (entity and tree node), tree cycles, unreachable nodes, non-increasing costs,
prerequisites in lower rows, incomplete dark trees, unprovable culprits, unexonerable suspects,
missing outcomes, stale manifest — while pure reformatting keeps the manifest valid.
