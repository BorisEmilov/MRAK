# Mysteries & the deduction board

Status: Draft v0.1 · MVP: ✅ (M1) · Package: `packages/core/mysteries` · Back to [GDD](../GDD.md) · [index](README.md) · content: [mysteries lore](../lore/mysteries.md)

## Purpose

Long investigations solved by reasoning, not by quest markers. The village acts on the
guardian's conclusion — **a wrong conclusion condemns an innocent**.

## Data

Content `mysteries/*.json`:
`{ id, question, deadline, suspects[], causes[], remedies[], clues[]: { id, sources[], supports: [propositionId], refutes: [propositionId], reliability (solid|doubtful), forbidden? }, solution: { culprit, cause, remedy }, outcomes: { [suspectId]: effects } }`.
State: `{ mysteryId, cluesFound[], links[] (clue→proposition), notes, status, conclusion? }`.

**Propositions** are typed: `culprit:<id>`, `cause:<id>`, `remedy:<id>`, `motive:<id>`, `opportunity:<id>`.

## Rules

1. Clues are found through investigation checks, dialogue, night events and collectibles.
2. On the **board**, the player links clues to propositions. Linking is free; the board shows
   **support strength** (count of solid supports − refutations), not truth.
3. **Committing a conclusion** requires choosing one culprit, one cause and one remedy. The
   game warns if support is weak but never forbids it.
4. Outcomes are content-defined per suspect (see M1). The village **acts** — via
   [hysteria](hysteria.md) — and the world reacts (aga, factions).
5. **Doubtful** clues (possibly hallucinations) can never be the _only_ support of the true culprit
   in content (validated).
6. A mystery can be **unsolved** at its deadline → its "unsolved" outcome.
7. Partial truth: correct culprit + wrong remedy → partial success outcome.

## Initial formulas

- Revelation: proposition fully supported +3 (once each), correct conclusion 15/30/50, wrong 10.
- Hysteria: correct −20; wrong + lynching +0 (the mob is satisfied — the horror is that it works,
  for a while), then +15 when the evil continues.

## Implementation (v1)

Code: `packages/core/src/mysteries.ts`; UI `apps/game/src/ui/journal/DeductionBoard.tsx`.

- **Clues are found at their sources** for open cases: `zone` (+ optional `poi`) on interacting
  with a POI (with the source `check` when the guardian can roll), `villager` on talking,
  `event` when the director event fires, `collectible` when granted; `when` must hold.
- **Lying witnesses:** a clue with `liar { villager, secret }` is retracted (and its threads cut)
  when that secret is revealed (`mystery/clueRetracted`).
- **Board:** `linkClue` and `moveBoardCard` store threads and card positions in the save. The
  board shows a thread count per proposition — never truth.
- **Final act:** `concludeMystery { culprit, cause, remedy }` runs the remedy's `action`
  (accuse, exorcise, burn, exhume, confront): right on all three → the culprit's outcome; right
  culprit only → `partial`; wrong culprit → that suspect's outcome. `abandonMystery` or the
  deadline (night index past `deadlineNight`, or the chapter ending) → `unsolved`.

## Events

- **Emits:** `mystery/started`, `mystery/clueFound`, `mystery/linked`, `mystery/concluded { correct,
culpritId }`, `mystery/unsolved`.
- **Consumes:** `check/resolved`, `dialogue/*`, `director/eventFired`, `time/dawn` (deadline).

## Edge cases

- A suspect dies before the conclusion → can still be named (posthumous accusation: family suffers).
- Clue erased from the journal → "half-remembered": stays on the board, cannot be the sole support.
- Endless mode procedural mysteries use the same structure with templates ([endless-chronicle](endless-chronicle.md)).

## Test ideas

- Content validation: the true culprit has ≥ 2 solid clues, every false suspect has ≥ 1 exonerating clue.
- No mystery solution chain depends only on `doubtful` clues.
- Committing each suspect in M1 yields its exact content outcome effects.
- Deadline passes ⇒ `mystery/unsolved` and its outcome.
