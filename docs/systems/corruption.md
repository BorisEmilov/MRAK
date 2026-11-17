# Faith & Corruption

Status: Draft v0.1 · MVP: ✅ · Package: `packages/core/guardian/corruption` · Back to [GDD](../GDD.md) · [index](README.md)

## Purpose

Two tracks that measure what the guardian is becoming. Faith protects and limits; Corruption
empowers and consumes. They are separate: a guardian can be devout **and** corrupted — the most
dangerous state.

## Data

`guardian.faith` 0–100, `guardian.corruption` 0–100, `village.corruption` 0–100 (collective
stain: lynchings, desecrations, sacrifices), `corruptionSources[]` ledger.

## Rules

1. **Faith +:** services, vigils, virtue acts, successful exorcisms, honest confessions, festivals observed.
2. **Faith −:** sacrilege, ignoring the dying, sin acts, broken vows, failed public rites.
3. **Corruption +:** dark talents (+4…+12), pacts, sin acts (+2), dark recipes, sacrifices,
   lynchings witnessed and not opposed, Bind the Lesser, Turning Charm.
4. **Corruption −:** Absolution (−25), penance quests, Theophany immersion (−5 per year), relics
   (one-time −10). Never decays naturally.
5. **Thresholds (Corruption):** 25 — animals shy away, children stare; 50 — omens skew
   ([omens](omens.md) rule 5), the church bell sounds wrong to you; 75 — holy items burn (−1 Fate
   with holy blessings), samodivi and demons treat you as kin; **100 — the Fall**: the guardian is
   lost (becomes an NPC servant of their creditor; the heir takes over).
6. **Dominance:** `Corruption > Faith` → sin takeovers ([virtue-sin](virtue-sin.md)).
7. Inheritance: heir starts with `Faith = 30 + bonuses`, `Corruption = 10% of predecessor's` (the stain of the house).

## Initial formulas

- Starting values: Faith 40 (Acolyte 55), Corruption 0.
- Village corruption effects: each 20 points → +1 Shadow die on village-wide rites, +5% possession advance chance.

## Implementation (v1)

`corruptionAspect = clamp((Corruption − Faith) / 100, 0, 1)` (`occult/pacts.ts`) drives the
guardian sprite tint (`apps/game/src/game/world/perception.ts`), villager trust (affinity gains ×
`1 − aspect/2`), and the director's hallucination share (+ `perCorruption` × aspect). Hidden
paths keep using `corruption` conditions in zone data.

## Events

- **Emits:** `faith/changed`, `corruption/changed`, `corruption/thresholdCrossed { level }`, `corruption/fell`.
- **Consumes:** `talent/bought`, `pact/signed`, `sacrifice/made`, `hysteria/lynching`, `virtue/acted`, `sin/acted`.

## Edge cases

- Fall during a night → the night ends immediately in a scripted scene; the heir starts at dawn.
- Corruption at 100 via the Bride's "Becoming" is not a Fall but the forest ending branch.

## Test ideas

- Thresholds fire once each when crossed upward, and re-fire after dropping below and crossing again.
- Corruption never decays without an explicit source.
- Heir inheritance: predecessor 60 ⇒ heir 6.
- Faith 70 & Corruption 75 ⇒ no dominance, but threshold-75 effects active.
