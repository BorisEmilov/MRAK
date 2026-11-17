# Possession

Status: Draft v0.1 · MVP: ✅ (Mamnik + lesser besove) · Package: `packages/core/occult/possession` · Back to [GDD](../GDD.md) · [index](README.md) · demons: [demons](../lore/demons.md)

## Purpose

The core horror: someone you know is no longer only themselves. Possession is **hidden**; the
player infers it from progressive symptoms, and may suspect the wrong person.

## Data

`possessions[]`: `{ id, demonId, hostId (villager|guardian), stage 0–5, hiddenSince, revealed: bool,
progressionModifiers[] }`. Demon content: rank, symptoms per stage, weaknesses, desires, seal, true name.

## Rules

1. **Entry:** a demon possesses through a door — a magiya, a pact clause, a failed exorcism jump,
   extreme fear (≥ 80, lesser besove only), or Notice ≥ 75 dreams (guardian).
2. **Progression:** each night at 03:33 the stage may advance.
3. **Symptoms** are content events emitted to the director as seeds; some are visible only to
   certain talents/skills (Sins Laid Bare, Listening to Water).
4. Stage 5 → the demon's **desire** resolves (death, fire, drowning, a mob) unless prevented.
5. **Masking:** demons fake the host's fear and avoid holy places; a possessed host refuses the
   church at stage ≥ 3 (a strong clue).
6. **Guardian possession:** the player keeps control but the sin takes over more often, and the
   demon may act at night through the guardian (lost minutes).
7. Only one named demon per host; lesser besove can stack (max 2).

## Initial formulas

- Advance chance per night: `base 35% + 5% × rank − wards − 10% if host is in chapel vigil`
  (Woven Ward halves it); minimum 5%.
- Lesser besove max stage 3.

## Implementation (v1)

Code: `packages/core/src/occult/possession.ts`; numbers in `data/fear-rules` → `possession`.
`startPossession` without `host` picks a living, unpossessed villager weighted by
`1 + fear·fear/100 + lowFaith·(1 − faith/100)`. At 03:33 each possession advances with
`clamp(base + perRank·rank)` up to the demon's `maxStage`; at dawn each host shows its stage's
symptom (`possession/symptomSeen`), and with `falseSymptomChance` an unpossessed villager shows a
false early symptom. True names: demon `fragments` (grimoire, grave, photograph, confession) are
granted by the `nameFragment` effect into `journal.learned` (`name:<demon>:<fragment>`); the last
one emits `journal/trueNameComposed`.

## Events

- **Emits:** `possession/began` (hidden), `possession/stageAdvanced` (hidden), `possession/symptomSeen`,
  `possession/revealed`, `possession/desireFulfilled`, `possession/ended`.
- **Consumes:** `time/witchingMinute`, `exorcism/*`, `pact/clauseTriggered`, `hysteria/lynching`.

## Edge cases

- Host dies → the demon seeks a new host within 3 nights (nearest by affinity and fear) or the guardian on bad omen.
- Two possessions in one house → symptoms may be misattributed (intended).
- The host leaves the village (exile) → demon follows; the symptom chain moves off-screen but the
  desire still resolves (news arrives).

## Test ideas

- Advance chance formula clamped to [5%, 95%].
- Hidden events never reach the UI snapshot until `revealed`.
- Host death triggers re-hosting within 3 nights in seeded runs.
- Lesser bes never exceeds stage 3.
