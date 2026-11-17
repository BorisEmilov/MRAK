# Sacrifices

Status: Draft v0.1 · MVP: partial (crypt altar offerings, blood offering) · Package: `packages/core/occult/sacrifices` · Back to [GDD](../GDD.md) · [index](README.md)

## Purpose

What the guardian is willing to give. Three families of offering, from devout to monstrous, each
grounded in real practice or legend **[F]** and given mechanical weight **[I]**.

## Data

Content `sacrifices/*.json`: `{ id, family, place, requirements, cost, effects, corruption, faith, debt }`.
State: `sacrifices[]` made, with timestamps and targets.

## Families

| Family                              | Place                             | Examples                                                                            | Effects                                                                                                                                                                         | Folk basis                                                     |
| ----------------------------------- | --------------------------------- | ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| **Crypt altar offerings**           | Church crypt altar                | Candles of beeswax, a relic, a fast of 3 days, a vow                                | Faith +, a blessing for the village (−1S on rites for a night), protects one house                                                                                              | Offerings, fasting, vows [F]                                   |
| **Vgradena senka** (immured shadow) | Foundation of a building          | Measure a living person's shadow with a thread and build the thread into the wall   | Building gains a **talasam** guardian: immune to fire and demons for a generation. The person sickens and dies within 40 days. Village corruption +25, guardian corruption +20. | Bulgarian building legend and ballads of the immured bride [F] |
| **Blood offerings**                 | Crossroads, forest well, the mine | Own blood, an animal (kurban-like), a lock of hair, a memory (to the forest spirit) | Favour from a creditor: Debt −, forest standing +, a clue, a night of safe passage                                                                                              | [F] blood motifs; specific bargains [I]                        |

## Rules

1. Crypt offerings are always **voluntary and costly** (materials, days of fasting = Vigor −1 temporary).
2. The immured shadow must target a **specific person** (in game: never a child — content rule);
   the target can be **the guardian themself** (a death that saves the village: heir takes over in
   40 days, the building keeps the guardian's spirit, who may appear to the heir).
3. Blood offerings to opposing powers anger the others (forest vs Horned One).
4. Every sacrifice is recorded and remembered by the village if witnessed.

## Initial formulas

- Shadow-measured target: death in `30 + seeded(0..10)` days; the Gravedigger/Folk Healer cannot prevent it.
- Blood offering Debt reduction: own blood −3 (Vigor −1 for a day), animal −5, memory −8.

## Implementation (v1)

Code: `packages/core/src/occult/pacts.ts` (`makeSacrifice` command); families in
`fear-rules.sacrifices`. Offerings grow: item qty × (1 + `escalation` × times made). A targeted
sacrifice (the immured shadow; never a child) dooms its target after `doomDays` (claimed at
dawn, cause `shadow-claimed`). A witness (`witnessChance`) spreads a rumour: hysteria and the
guardian's suspicion rise.

## Events

- **Emits:** `sacrifice/made { family, targetId }`, `sacrifice/talasamCreated`, `sacrifice/shadowClaimed`.
- **Consumes:** `time/*`, `world/enteredZone`.

## Edge cases

- Immuring a shadow of an already possessed host → the demon is walled in with the shadow: the
  building is haunted instead of protected.
- Building with a talasam is later demolished → the talasam becomes a hostile spirit.

## Test ideas

- Content validation forbids child targets for `vgradena-senka`.
- Shadow death occurs within 30–40 days for all seeds.
- Witnessed sacrifices change villager affinity; unwitnessed ones do not.
- Possessed-host immurement produces the haunted variant.
