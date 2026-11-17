# Gear & Blessings

Status: v1 (implemented, see [progression](progression.md)) · MVP: ✅ · Package: `packages/core/inventory/gear` · Back to [GDD](../GDD.md) · [index](README.md)

## Purpose

Equipment with **blessing slots**: the guardian prepares for specific threats rather than
upgrading numbers. A lantern with consecrated oil, a knife of horseshoe iron, a seal engraved on an amulet.

## Data

Equipment slots: **Lantern**, **Weapon**, **Amulet ×2**, **Tool**, **Clothing**.
Gear content: `{ id, slot, baseStats, blessingSlots (0–3), tags }`.
Blessings content: `{ id, nameKey, appliesTo[], effect, duration (uses|nights|permanent), material[] }`.

| Blessing          | Material          | Applies to     | Effect                                        | Folk basis          |
| ----------------- | ----------------- | -------------- | --------------------------------------------- | ------------------- |
| Consecrated oil   | oil + holy water  | Lantern        | Light burst ×1.5 vs demons                    | Church practice [F] |
| Horseshoe iron    | iron              | Weapon, Amulet | +1 damage tier vs creatures; samodivi angered | Iron vs spirits [F] |
| Engraved seal     | seal known + tool | Weapon, Amulet | Bind phase without chalk; −1S vs that demon   | [I]                 |
| Garlic braid      | garlic            | Amulet         | −1S vs vampires, besove                       | [F]                 |
| Red thread        | thread            | Amulet         | −1S vs evil eye (Uroka)                       | [F]                 |
| Hawthorn          | hawthorn          | Weapon         | Can destroy vampires                          | [F]                 |
| Holy water        | holy water        | Weapon         | 3 uses: +1F in combat vs demons               | [F]                 |
| Salt of Theophany | salt              | Tool           | Threshold wards                               | [F]                 |

## Rules

1. Applying a blessing requires its material, the right station (chapel for holy ones) and a
   Survival or Faith check ([omens](omens.md)); good omen → +1 use.
2. Blessings from opposed powers conflict: a dark blessing removes holy ones in the same item.
3. Some blessings anger factions (iron vs samodivi; holy vs forest spirit).
4. Heirlooms keep **one permanent blessing** across generations.

## Initial formulas

- Base lantern: oil 1 unit = 15 in-world minutes; radius 4 tiles; light burst costs 1 unit.
- Damage tiers: 1 (bare) → 4 (blessed silver/hawthorn); creatures have resistance tiers.

## Events

- **Emits:** `gear/equipped`, `gear/blessed { blessingId, uses }`, `gear/blessingExpired`.
- **Consumes:** `combat/hit`, `light/burstUsed`, `time/nightStarted`.

## Edge cases

- Removing an item mid-night is allowed only in safe spots (house, chapel).
- Item with 3 slots and 3 blessings + new blessing → player picks one to replace.

## Test ideas

- Applying holy and dark blessings to one item leaves only the newest + emits conflict event.
- Uses decrement exactly once per qualifying event.
- Heirloom permanent blessing survives `lineage/generationEnded`.
