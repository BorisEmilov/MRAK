# Omens (check resolution)

Status: v1 (implemented, see [progression](progression.md)) · MVP: ✅ · Package: `packages/core/checks` · Back to [GDD](../GDD.md) · [index](README.md)

## Purpose

Every key check (rituals, exorcisms, investigation, persuasion, combat manoeuvres, alchemy)
resolves on **two axes**: **success/failure** and **good/bad omen**. A success can carry a bad
omen; a failure can leave a useful clue. Inspired by narrative dice in tabletop RPGs — adapted
into an original d6 system.

## Data

**Fate die (d6)** — added by attribute, skill, gear, help:

| Face   | 1   | 2   | 3       | 4   | 5   | 6     |
| ------ | --- | --- | ------- | --- | --- | ----- |
| Result | —   | —   | ☼ omen+ | ✔   | ✔   | ✔ + ☼ |

**Shadow die (d6)** — added by difficulty, darkness, fear, demon rank:

| Face   | 1   | 2   | 3       | 4   | 5   | 6     |
| ------ | --- | --- | ------- | --- | --- | ----- |
| Result | —   | —   | ☾ omen− | ✘   | ✘   | ✘ + ☾ |

Check request: `{ attribute, skill, difficulty, modifiers[], context }`.
Result: `{ net, success, omen: good|none|bad, faces[], explanation[] }`.

## Rules

1. **Pool:** Fate dice = attribute + skill rank (+ modifiers), **cap 8**.
   Shadow dice = difficulty (Easy 1, Average 2, Hard 3, Daunting 4, Dire 5) + modifiers.
2. **Success** if `count(✔) − count(✘) ≥ 1`.
3. **Omen** = `count(☼) − count(☾)`: > 0 good, < 0 bad, 0 none.
4. Standard modifiers: Sanity < 50 → +1 Shadow; < 25 → +2 Shadow. In darkness without light → +1
   Shadow. Blessed gear relevant to the check → +1 Fate. Demon rank → + rank Shadow on exorcisms.
5. Faith ≥ 60 cancels one ☾; Corruption ≥ 50 turns one ☼ into ☾ ("the Horned One watches").
6. **Interpretation tables** per check type map (success × omen) to outcomes. Examples:
   - Investigation: failure + good omen → a clue to _another_ mystery.
   - Exorcism: success + bad omen → demon expelled but one symptom remains or Notice +10.
   - Persuasion: success + bad omen → they agree but tell someone else.
7. UI shows the dice faces and the plain-language reason for every modifier (pillar 6).
8. All rolls use the `checks` RNG stream.

## Initial formulas

Baseline: 3 Fate vs 2 Shadow ⇒ success ≈ 50%. Expected omen per die ≈ +0.33 (Fate) / −0.33 (Shadow).

## Events

- **Emits:** `check/resolved { checkId, skill, success, omen, net }`.
- **Consumes:** none (pure function called by systems).

## Edge cases

- Pool 0 Fate dice (attribute 0 impossible, but heavy injuries) → minimum 1 Fate die.
- Rerolls (Devil's Luck) reroll all dice, keep the second result; omen also rerolled.
- Conversions apply after rolling, in order: talents → Faith → Corruption.

## Test ideas

- Exact probability tests via enumeration for small pools (3F vs 2S = 50%).
- Monte Carlo (seeded) for pool 8F vs 5S matches enumerated value ±1%.
- Faith ≥ 60 converts at most one ☾; Corruption ≥ 50 converts at most one ☼.
- Fate dice never exceed 8 regardless of modifiers.
- Same seed ⇒ same faces.
