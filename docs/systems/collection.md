# Collection (collectibles, cursed objects, cabinet)

Status: v1 · MVP: ✅ · Package: `packages/core/src/items` · Back to [GDD](../GDD.md) · [index](README.md) · see also [journal](journal.md), [inventory](inventory.md), [photography](photography.md), [achievements](achievements.md)

## Purpose

Things worth keeping: grimoire pages, relics, folk tales and songs heard from villagers, cursed
objects with memories, photographs. The collection rewards curiosity and talk (pillar 5) and
gives achievements something to count.

## Data

- `collectibles/*.json`: `kind` = `grimoire-page | relic | folk-tale | song | daguerreotype |
letter`; optional **`source: { talk: villager, when?, minAffinity? }`** — told by that villager.
- `cursed-objects/*.json`: `whisper`, `memoryKey`, optional **`memoryScene`** (the playable
  memory of phase 19), **`memoryEffects`** (first recall), **`carried`** and **`displayed`**
  modifiers, `effects` (once, when first found). The object is carried as the item whose
  `cursed` points to it (unique, slot size 1+).
- `cabinet-sets/*.json`: `{ objects: [cursed-object ≥ 2], modifiers: [≥ 1] }`.
- State `collection`: `cabinet` (displayed item ids), `memories` (recalled objects), `found`
  (items ever obtained), `talked` (villager → last day), `layers` (photo layers revealed),
  `album` (see [photography](photography.md)).

## Rules

1. **Talking:** `talkTo { villager }` — alive, not returned, in the home zone and not asleep,
   hiding or away. The first talk of a day gives `talk.affinityPerDay` (+2) affinity toward the
   guardian. The villager tells the first collectible (content order) whose `source.talk` is
   them, whose `when` holds and whose `minAffinity` is met, and that the guardian does not have
   (`grantCollectible`). Otherwise small talk by their fear (`villager/talked { tale: null }`).
2. **Cursed objects:** while the item is in the pack, its `carried` modifiers are active and it
   whispers ([inventory](inventory.md) rule 9). In the cabinet its `displayed` modifiers are
   active and it is silent. In the house store it does nothing.
3. **Cabinet** (cellar of the guardian's house): `displayObject { item }` moves a cursed item
   from the pack or store to the cabinet (home zone only, `cabinet.slots` = 6);
   `removeObject { item }` returns it to the store. A **set** is active while all its objects
   are displayed: `cabinet/setCompleted`, `cabinet/setBroken`.
4. Active modifiers = permanent ones (`state.modifiers`) + carried cursed objects + displayed
   cursed objects + complete sets. `effectiveStat` uses all of them.
5. **Memories:** `recallMemory { object }` (object owned: pack, store or cabinet) shows its
   memory. The first recall applies `memoryEffects` and records it. `collection/memoryRecalled
{ object, scene }` is what phase 19 will turn into a playable scene; until then the UI shows
   the memory as text.
6. **Collection progress** by category: `herbs` (herb items ever found / all herbs), `recipes`
   (learned / visible), `grimoire`, `relics`, `tales`, `songs` (owned collectibles of that
   kind), `cursed` (cursed items found), `photos` (photo layers revealed / all layers),
   `memories`. Exposed as `collectionProgress()`.
7. **Achievements** count it through the condition `{ "collection": "<category>", ">=": n }`
   (`n` may be `"all"`: complete). `collection/progressed { category, have, total }` is emitted
   when a count grows; `collection/completed { category }` when it reaches the total.

## Events

Emits `villager/talked`, `collection/found { item }`, `collection/memoryRecalled`,
`collection/progressed`, `collection/completed`, `cabinet/displayed`, `cabinet/removed`,
`cabinet/setCompleted`, `cabinet/setBroken`.

## Edge cases

- A cursed item given twice (content error) still exists once (unique).
- Removing a displayed object when the store is the only place: always allowed (no slots).
- A villager dies before telling their tale → the tale is lost for this chronicle (pillar 2).

## Tests

`packages/core/src/items/collection.test.ts`: talking grants the eligible tale once and respects
`minAffinity`/`when`; daily affinity once per day; asleep villagers do not talk; carried vs
displayed modifiers change `effectiveStat`; sets complete and break; memory effects apply once;
progress counts per category and the `collection` condition.
