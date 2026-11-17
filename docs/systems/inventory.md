# Inventory

Status: v1 · MVP: ✅ · Package: `packages/core/src/items` · see also [alchemy](alchemy.md), [collection](collection.md), [photography](photography.md) · Back to [GDD](../GDD.md) · [index](README.md)

## Purpose

What the guardian carries at night and what the village stores. Scarcity forces choices before
going out: oil or holy water, stakes or bread.

## Data

- **Guardian pack:** slot grid, base **10 slots** (+talents). Items: `{ itemId, qty, charges?, blessing? }`.
- **Equipped:** lantern, weapon, amulet ×2, tool — see [gear-blessings](gear-blessings.md).
- **Village stores:** resource counters with caps by building: firewood, food, flour, oil, candles,
  garlic, herbs, salt, iron, wax, silver (grosh).
- **Item content:** `items/*.json` — id, nameKey, iconId, stack size, slot size, tags
  (`light`, `holy`, `herb`, `cursed`, `relic`…), effects.

## Rules

1. Stackable items share a slot up to stack size; some (relics, cursed objects) are unique.
2. **Cursed objects** cannot be dropped at night; they whisper (Sanity −1/10 min) unless sealed.
3. Taking from village stores at dusk is free; returning at dawn is automatic for unused items.
4. Dawn penalty may lose one random non-unique item.
5. Collectibles (grimoire pages, daguerreotypes, folk tales) go to the **journal**, not the pack.

## Initial formulas

- Village caps: firewood 40, food 60, oil 20 (+10 per chapel level), herbs 20 (+10 per hut level).
- Daily consumption: food 1 per villager, firewood 2 per house in winter (1 in summer).

## Events

- **Emits:** `inventory/itemAdded`, `inventory/itemRemoved`, `inventory/full`, `stores/changed`,
  `stores/shortage { resource }`.
- **Consumes:** `task/completed`, `alchemy/brewed`, `time/dawn`, `combat/itemUsed`.

## Edge cases

- Item content removed in a new version → migration converts to a fallback item, never silently drops.
- Pack overflow when picking up → offer swap UI (never auto-drop a relic).
- Negative resource (consumption > stock) → clamps to 0 and emits shortage (affects health/fear).

## Test ideas

- Stack splitting/merging preserves totals.
- Unique items cannot stack; cursed items reject `drop` at night.
- Winter daily consumption with 8 villagers in 6 houses = food 8, firewood 12.
- Shortage of food two days in a row raises all villagers' fear by the configured amount.

## Implementation (v1)

All numbers live in `data/item-rules/default.json` (`inventory`, `gathering` sections).

### State

- `guardian.pack`: stacks `{ item, qty, potency? }` carried by the guardian.
- `guardian.storage`: the **guardian's house store** — stacks with no slot limit and no stack-size
  limit (one stack per item + potency). Village work is delivered here and village upkeep
  (meals, fires, task materials, burial rites) is taken from here.
- `guardian.ground`: per zone, stacks dropped or left over (max 32 per zone). Nothing on the
  ground decays in v1.
- Order of stacks is insertion order; **sorting is presentation** (the UI remembers the chosen
  sort per browser). Commands address stacks by `item` + `potency`, never by index.

### Rules

1. **Slots:** the pack has `packSlots` (10) + `pack-slots` stat slots. A stack uses
   `item.slotSize` slots and holds at most `stackSize` (`unique` items: 1, never merged).
2. **Weight:** every item has a `weight` (0–20, default 1). Load = Σ qty × weight. Over
   `carryWeight` (24) + `carry-weight` stat the guardian is **encumbered**: walks at
   `encumberedSpeed` (0.6×) and cannot run. Never a hard cap.
3. **Potency:** herbs and brews carry a potency 1–3 (absent = the item's content potency, or 1).
   Stacks merge only with the same item and potency. Taking items without a potency takes the
   lowest potency first.
4. **`giveItem`** goes to the pack by default (`"to": "storage"` in content, or the village
   simulation, sends it home). What does not fit goes to the house store when the guardian is in
   the home zone, otherwise to the ground of the current zone (`inventory/full`). Unique items
   that do not fit are **never lost**: they go to the ground and stay there.
5. **`takeItem`** takes from the pack, then the store (`"from": "pack" | "storage"` restricts
   it). **`hasItem`** counts pack + store unless `"in"` says otherwise. The lantern burns oil
   from the **pack** only.
6. **House store access:** `moveItem { item, potency?, qty, to }` works only in the home zone
   (`homeZone`, the village). Pack full → the move is clipped to what fits (`inventory/full`).
7. **Dropping:** `dropItem { item, potency?, qty }` puts pack stacks on the current zone's
   ground; `pickUp { item, potency? }` takes them back (clipped to what fits). Cursed items
   cannot be dropped at night ("it will not leave your hand").
8. **Using:** `useItem { item, potency? }` applies the item's `useEffects` (only items that have
   them); `addStat` values are scaled by `potencyScale[potency − 1]` (1, 1.5, 2). One unit is
   consumed.
9. **Cursed items** (`item.cursed` → a cursed object) whisper while carried: Sanity −`whisper`
   per 10 in-world minutes, applied once per in-world hour (−6 × whisper) so ticking and
   skipping agree. See [collection](collection.md) for their passive effects and the cabinet.
10. A new chronicle's start gives oil and tools to the pack and the household supplies to the
    store (data/starts/default.json).

### Gathering points

A zone POI may declare `gather { item, qty, potency, when?, regrowDays }`:

1. Interacting gathers `qty` of `item` at `potency` × boosts (see 3) if `when` holds and the
   point has regrown (`regrowDays` since the last gathering; 0 = once per day).
2. `when` uses the condition language: **`date`** (Julian month/day range, may wrap the year),
   **`moon`** (list of phases), `phase`, `chapter`, flags… Outside it the point is
   **not there**: the core rejects the gathering (`gather/unavailable`) and the world does not
   draw the plant or offer the prompt.
3. **Boosts** (`gathering.boosts`, in order): each `{ when, add?, factor? }` whose condition
   holds adds, then multiplies. **Enyovden** (the date of Enyovden, June 24 O.S.) doubles the potency of
   every herb. Result capped at 3 (dawn +1 then ×2: 1 → 4 → 3).
4. Events: `gather/gathered { zone, poi, item, qty, potency }`, `gather/unavailable { reason:
season | regrowing }`.

### Events

`inventory/itemAdded { item, qty, to }`, `inventory/itemRemoved { item, qty }`,
`inventory/moved { item, qty, to }`, `inventory/dropped`, `inventory/pickedUp`,
`inventory/full { item, qty, where: storage | ground }`, `inventory/used { item }`,
`inventory/encumbered { encumbered }`.

### Tests

`packages/core/src/items/*.test.ts`: stacking and splitting keep totals; unique items never
merge; slot sizes; overflow to the store at home and to the ground elsewhere; weight and
encumbrance; potency merge rules; store access only at home; cursed items cannot be dropped at
night; whisper per hour equal when ticking or skipping; gathering by date, moon and regrowth;
Enyovden boost and its cap; v5 → v6 save migration.
