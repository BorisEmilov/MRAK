# Attributes

Status: v1 (implemented, see [progression](progression.md)) · MVP: ✅ · Package: `packages/core/guardian` · Back to [GDD](../GDD.md) · [index](README.md)

## Purpose

Six innate qualities that form the base of every check and change slowly.

| Attribute    | Governs                                         | Linked skills                  |
| ------------ | ----------------------------------------------- | ------------------------------ |
| **Vigor**    | strength, health, carrying, stamina             | Combat                         |
| **Agility**  | movement, aim, stealth                          | Stealth                        |
| **Wits**     | perception, learning, reasoning                 | Investigation, Lore, Herbalism |
| **Cunning**  | craft, deceit, survival instinct, occult tricks | Occultism, Survival            |
| **Resolve**  | will, faith, resistance to fear                 | Exorcism, Faith                |
| **Presence** | voice, leadership, charm                        | Persuasion                     |

## Data

`attributes: Record<AttributeId, 1..6>`; `attributeSources[]` (base, calling, purchase, heirloom, talent, injury, ageing).

## Rules

1. Creation: all at **2**; calling gives **+1 to two**; player adds **+1** anywhere (max 4 at creation).
2. Raise with Revelation ([progression-economy](progression-economy.md)): cost `10 × new rating`.
3. **Cap 5**; **6** only through one heirloom or a talent marked "(max 6)".
4. Derived values:
   - Max health = 50 + 10 × Vigor · Max stamina = 50 + 10 × Agility.
   - Max Sanity = 60 + 8 × Resolve (+ talents).
   - Pack slots +1 and carry weight +2 per Vigor above 2 ([inventory](inventory.md)).
   - Social standing modifier = Presence − 2 on affinity gains (min 0).
5. Temporary modifiers (injuries, Borrowed Strength) never change the purchase cost.
6. Ageing after 55: −1 Vigor or Agility every 5 in-world years (player chooses), floor 1.

## Initial formulas

See rule 4. Check pools: `Fate dice = attribute + skill rank` (cap 8), see [omens](omens.md).

## Events

- **Emits:** `guardian/attributeRaised`, `guardian/attributeModified { source, delta, until? }`.
- **Consumes:** `revelation/spent`, `time/yearSkipped`, `combat/injured`, `talent/bought`.

## Edge cases

- An injury reducing Vigor below current carried slots → over-encumbered, not item loss.
- Heirloom +1 on an attribute already at 5 → 6 allowed only once per attribute.

## Test ideas

- Creation validation rejects any attribute > 4 or total ≠ 12 + 3.
- Raising 2→3→4→5 costs 30, 40, 50.
- Raising to 6 without heirloom/talent source is rejected.
- Derived max Sanity with Resolve 3 = 84.
- Ageing never reduces below 1.
