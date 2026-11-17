# Lineage (generations and heirs)

Status: Draft v0.1 · MVP: partial (death ends the generation; heir screen shows Legacy) · Package: `packages/core/lineage` · Back to [GDD](../GDD.md) · [index](README.md) · lore: [guardian-bloodline](../lore/guardian-bloodline.md)

## Purpose

When the guardian dies, falls, or retires, an heir continues. Death is a transition, not a reset.

## Data

- `family[]`: `{ id, nameKey, sex, birthYear, callingId, relation (child|sibling|spouse|apprentice|cousin),
traits[], alive }`.
- `pastGuardians[]`: `{ id, years, cause, lifetimeRevelation, epitaphKey }`.
- `heirlooms[]`: `{ itemId, permanentBlessing?, history[] }`.

## Rules

1. **End of a generation:** death (combat, Last Breath failed), the Fall (Corruption 100),
   immured shadow on oneself, retirement (age ≥ 50 or 3 traumas, at a chapter boundary).
2. **Heir selection:** from living family/apprentices aged ≥ 16 with a calling. If nobody is
   eligible, the village chooses an apprentice (new calling, lower starting Faith).
3. **Inherited:** pacts, Debt, curses, heirlooms, written journal entries, house reputation,
   Bloodline Tree (account level), rival relationship.
   **Not inherited:** talents, skill ranks, Revelation, Sanity state, personal relationships
   (villagers start at house reputation ÷ 2).
4. Generation-end ceremony: epitaph, Legacy award ([bloodline-tree](bloodline-tree.md)), heir choice.
5. **Family events:** marriages, births (heirs for later generations), deaths of relatives.
6. **The Cycle (NG+):** after an ending, start again in 1834 with the Bloodline Tree, achievements
   and "echoes" (some characters remember). Talents and village reset.
7. MVP: one generation; if the guardian dies the chronicle ends, Legacy is awarded, a new
   chronicle can start with Bloodline T1 bonuses.

## Initial formulas

- Family generation: 1–3 children per married guardian, seeded; callings weighted by parent's
  calling (40% same) and village buildings (school → Scholar).
- Retirement allowed at age ≥ 50; forced suggestion at 65.

## Events

- **Emits:** `lineage/generationEnded { cause }`, `lineage/heirChosen`, `lineage/familyChanged`,
  `lineage/cycleStarted`.
- **Consumes:** `combat/lastBreath`, `corruption/fell`, `sacrifice/shadowClaimed`, `time/yearSkipped`.

## Edge cases

- No eligible heir and no apprentice possible (village empty) → "the line ends": chronicle over.
- Heir is possessed at handover → inherited possession; the first night starts with symptoms.

## Test ideas

- Inherited vs non-inherited fields after handover match the table exactly.
- Heir with age 15 is not eligible; 16 is.
- MVP mode: death ⇒ chronicle end + Legacy award, no heir selection.
- Cycle start keeps profile data and resets WorldState.

## Implementation (v1)

- Core: `packages/core/src/chronicle/lineage.ts`; rules `progression-rules.lineage`.
- The guardian is a person in `village.people` (created with the first guardian). Commands:
  `marry`, `takeApprentice`, `retire` (from `retireAge`), `chooseHeir`, `skipYears` (1–10: the
  time-skip between generations, e.g. until a child heir comes of age).
- A generation ends on `guardian/died`, retirement or old age: the record goes to `lineage.past`
  with its Legacy and `awaitingHeir` is set. Candidates: house children and apprentices of
  `heirAge`, else any adult the village chooses; none and no child left ⇒ `lineage.ended`.
- **Handover:** each pact in force adds `inheritedPactDebt` (the forebear's pact is collected from
  the heir); debt, curses, possessions, belongings and gear stay; journal entries survive only if
  marked for the heir. Talents, trees, skills, attributes, Revelation, Sanity and personal
  modifiers/abilities are cleared; the heir then picks a calling (`createGuardian`, with the
  account's Bloodline nodes). `lineage.summary` compares the world at both ends of the generation.
- Legacy = ⌊lifetime Revelation ÷ perRevelation⌋ + weights × (chapters, correct mysteries, building
  levels, completed routes, years served).
- UI: Village panel → Lineage tab (family tree with portraits, marriage, apprentices, retirement,
  Bloodline Tree); the heir dialog; the generation summary on the heir's creation screen.
