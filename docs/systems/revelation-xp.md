# Revelation (XP)

Status: v1 (implemented, see [progression](progression.md)) · MVP: ✅ · Package: `packages/core/guardian/revelation` · Back to [GDD](../GDD.md) · [index](README.md) · numbers: [progression-economy](progression-economy.md)

## Purpose

The currency of understanding. Earned from **milestones** — mysteries solved, exorcisms, festivals
survived, truths discovered — **never from killing**. Spent on talents, attributes and skill caps.

## Data

`guardian.revelation: { available, lifetime }`; `revelationLedger[]` (source, amount, minute) for
UI history and balancing telemetry; content `milestones/*.json` (id, amount, repeatable?, conditions).

## Rules

1. Awards are **declared in content** as milestones and granted by core when their conditions
   are met (events), never by scenes directly.
2. Each non-repeatable milestone is granted once per guardian (or once per playthrough when marked).
3. Awards appear at the next calm moment (dawn report), never mid-scare (pillar 1).
4. Spending is allowed only in the day phase (at the journal/house).
5. On guardian death, unspent Revelation is lost; `lifetime` feeds Legacy ([bloodline-tree](bloodline-tree.md)).
6. Soft cap: lifetime > 600 → all talent costs +25% ([progression-economy](progression-economy.md#8-endless-chronicle--growth-without-power-creep)).

## Initial formulas

See the award table in [progression-economy §3](progression-economy.md#3-revelation-xp-sources).

## Events

- **Emits:** `revelation/awarded { milestoneId, amount }`, `revelation/spent { target, amount }`.
- **Consumes:** `mystery/concluded`, `exorcism/succeeded`, `time/chapterEnded`, `journal/truthAdded`,
  `quest/completed`, `world/zoneDiscovered`, `time/dawn`.

## Edge cases

- A milestone fires twice due to replay/migration → idempotency key `(milestoneId, guardianId)`.
- Spending at night attempted through UI → rejected.
- Negative balances impossible; costs computed with the soft-cap multiplier at purchase time.

## Test ideas

- Static check: no milestone content references combat kill events.
- Idempotency: firing the same milestone event twice awards once.
- Awards made at night are displayed at dawn but credited immediately in state.
- Soft cap: at lifetime 601, a T2 talent costs 13 (10 × 1.25, rounded up).
