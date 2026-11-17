# Virtue & Sin

Status: v1 (implemented, see [progression](progression.md)) · MVP: ✅ · Package: `packages/core/guardian/virtue` · Back to [GDD](../GDD.md) · [index](README.md)

## Purpose

Each guardian has **one virtue and one sin**, tied to the Faith ↔ Corruption balance. Acting by
your virtue gives bonuses; when Corruption dominates, the sin starts choosing for you.

## Data

Virtues: Mercy, Compassion, Courage, Truthfulness, Loyalty, Patience, Humility.
Sins: Pride, Wrath, Cruelty, Curiosity, Vengefulness, Greed, Envy.
State: `{ virtueId, sinId, virtueStreak, sinTakeovers }`.
Content tags on dialogue choices and actions: `virtue:mercy`, `sin:wrath`…

## Rules

1. Chosen at creation (calling default suggested). Heirs choose their own.
2. **Acting by virtue** (a tagged choice/action): Faith +2, and the next related check +1 Fate
   (one per day). Three in a chapter → "Virtuous" status for the chapter: Sanity regen +20%.
3. **Sin dominance:** when `Corruption > Faith`, in dialogue the sin-tagged option may be
   **forced** (shown as the guardian "speaking before thinking"); chance below.
4. Acting by sin voluntarily: Corruption +2, immediate tangible benefit (silver, information, intimidation).
5. The UI always tells the player when a choice was taken by the sin (pillar 6) — the drama is in
   the loss of control, not in confusion.

## Initial formulas

- Takeover chance on a dialogue node containing a sin option: `clamp((Corruption − Faith) × 1%, 0, 50%)`.
- Takeover never happens on route-defining choices (content flag `noSinTakeover`).

## Events

- **Emits:** `virtue/acted`, `sin/acted`, `sin/tookOver { nodeId }`.
- **Consumes:** `dialogue/choiceMade`, `action/performed`, `corruption/changed`, `faith/changed`.

## Edge cases

- Same choice tagged both virtue and sin (e.g. Wrath and Courage) → both apply.
- Takeover in a choice where the sin option is unavailable (conditions unmet) → no takeover.

## Test ideas

- Corruption 70, Faith 30 ⇒ takeover chance 40%; Corruption 30, Faith 70 ⇒ 0%.
- `noSinTakeover` nodes never trigger takeover in 10,000 seeded trials.
- Virtue action grants +1 Fate only once per day.
