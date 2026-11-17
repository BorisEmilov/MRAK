# Pacts

Status: Draft v0.1 · MVP: ✅ (crossroads pacts with the Horned One) · Package: `packages/core/occult/pacts` · Back to [GDD](../GDD.md) · [index](README.md)

## Purpose

Blood pacts at the crossroads at midnight: immediate power, visible terms, and **hidden clauses**
that trigger nights later. The Pact of 1779 is the game's central secret; the player can sign
smaller pacts of their own.

## Data

Content `pacts/*.json`: `{ id, creditor, offer (effects), visibleTerms[], hiddenClauses: [{ id, trigger
(condition or delayNights), effect }], debt, unlocks (dark tree) }`.
State: `pacts[]`: `{ pactId, signedAt, signerGuardianId, clausesTriggered[], broken: bool }`.

## Rules

1. **Where/when:** crossroads at **00:00–01:00** (or anywhere with Midnight Anywhere).
2. **Offers** (examples): save a dying villager; reveal a true name; +1 attribute for a chapter;
   make Zlatno's luck fail for a month; open a path in the mine.
3. **Signing** in blood: Debt +amount, unlocks **Servant of the Horned One** tree (first pact).
4. **Hidden clauses** trigger by delay or condition (e.g. "the first child born in Mrak after this
   night is his"; "when you next enter a church, the bell cracks").
5. Clauses can be discovered before triggering: Contract Reader, the forest spirit, reading the
   pact aloud in a church (removes one hidden clause), certain grimoire pages.
6. **Inheritance:** pacts bind the bloodline; heirs inherit them and their clauses.
7. **Breaking** a pact is a route-level act (relic + place + price); it removes debt from that pact.
8. The 1779 Pact is a special content record (`pact.zlatno-1779`) with route-specific interactions.

## Initial formulas

- Debt per pact: minor 5, medium 10, major 20.
- Clause delay: 2–9 nights (seeded), or condition-based.

## Implementation (v1)

Code: `packages/core/src/occult/pacts.ts`, `guardian/debt.ts` (`signPact`). Signing applies the
`blood` price (Sanity or max Sanity), the offer, Debt to its source and the dark tree; `sin`
is imposed on a guardian without one, or reinforced (`fear-rules.pacts.sinReinforce` Corruption).
Hidden clauses are scheduled at signing (`pacts[id].clauses`: `delayNights` rolled now) and
checked at dawn; firing emits `pact/clauseTriggered` (HUD notice) — the clause is discovered.
The contract UI shows hidden clauses blurred. Route markers are `route-*` stats moved by the
pact's `offerEffects`. **Factions** (`fear-rules.factions`): reputation stats `rep-*`; a gain
with one power lowers its enemies by `hostility` × the gain (`faction/angered`).

## Events

- **Emits:** `pact/offered`, `pact/signed`, `pact/clauseRevealed`, `pact/clauseTriggered`, `pact/broken`.
- **Consumes:** `time/midnight`, `world/enteredZone(crossroads)`, `lineage/heirChosen`, conditions.

## Edge cases

- Clause targets a dead villager → falls to the closest relative, else to the guardian.
- Two clauses trigger the same night → resolve in signing order, one per hour.
- Signing while possessed → the demon co-signs (Debt +50%).

## Test ideas

- Signing outside 00:00–01:00 rejected (unless talent).
- Delay clause signed night 3 with delay 4 triggers exactly at night 7 midnight.
- Reading in church removes exactly one hidden clause.
- Heir inherits pacts and pending clauses.
