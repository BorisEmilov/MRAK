# Callings

Status: v1 (implemented, see [progression](progression.md)) · MVP: ✅ (Priest's Acolyte, Znaharka) · Package: `packages/core/guardian/callings` · Back to [GDD](../GDD.md) · [index](README.md) · content: [callings lore](../lore/callings.md)

## Purpose

A guardian's career: which skills are cheap, which talent trees are native, the starting kit and
a signature ability. Each heir has their own calling, so a bloodline plays differently every generation.

## Data

Content `callings/*.json`: `{ id, nameKey, attributeBonuses[2], callingSkills[3–6], startingRanks[3],
trees[2], startingGear[], startingEquipment[], abilityId, defaultVirtue, defaultSin }`.
State: `guardian.callingId`, `guardian.trees[]` (owned trees, first free).

## Rules

1. Calling is fixed for a guardian's life.
2. Calling skills: cap 2 at start and cheaper cap raises ([skills](skills.md)).
3. One native tree is chosen free at creation; the other costs 20 Revelation.
4. Out-of-calling trees: 30 access + 5 per talent ([talents](talents.md)).
5. Calling ability: one per calling, usable per its own limit (usually once per night).
6. Calling affects **social reactions**: a Znaharka gains suspicion faster in hysteria; a Haidut
   draws the aga's attention; a Priest's Acolyte is trusted by the Church faction.

## Initial formulas

- Suspicion gain multiplier in hysteria: Znaharka ×1.5, Scholar ×1.2 (books), others ×1.0.
- Aga attention per chapter for a Haidut: +10.

## Events

- **Emits:** `calling/abilityUsed`, `calling/treeUnlocked`.
- **Consumes:** `lineage/heirChosen`, `revelation/spent`.

## Edge cases

- Content update adds a third tree to a calling → existing saves keep two; the new tree is
  purchasable as "native" at 20.
- Heir with an unavailable calling in a demo build → not offered (demo: only MVP callings).

## Test ideas

- Every calling's content validates: 2 attributes, 3–6 distinct skills, 3 starting ranks ⊂ calling skills, 2 trees.
- Creating an Acolyte yields Resolve 3, Presence 3, Faith/Exorcism/Lore rank 1, caps 2 for calling skills.
- Second native tree costs 20; foreign tree 30 and each talent +5.
- Demo build rejects non-MVP callings.
