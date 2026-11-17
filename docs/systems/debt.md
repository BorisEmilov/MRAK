# Debt

Status: v1 (implemented, see [progression](progression.md)) · MVP: ✅ · Package: `packages/core/occult/debt` · Back to [GDD](../GDD.md) · [index](README.md)

## Purpose

MRAK's version of an "obligation" mechanic: dark favours have a running price. Debt makes dark
power stronger and the nights more dangerous. It is **inherited** by heirs.

## Data

`debt: { total, entries: [{ id, source (pact/favour/sacrifice), amount, creditor, createdAt }] }`,
`collectionHistory[]`.

Creditors: `horned-one`, `forest-spirit`, `aga` (loans), `village` (broken promises); later `named-demon:<id>`.
Source kinds: pact, favour, loan, promise, talent. Collections and remedies are data (`debt-collections`, `debt-remedies`).

## Rules

1. Sources: signing a pact (+5 to +20), dark talent Devil's Luck (+2), Borrowed Strength (+3),
   asking the forest spirit for favours (+3 to +10), blood offerings.
2. **Collection roll** each night at dusk (v1, [progression](progression.md) D2).
3. Collection severity tiers by roll: **Minor** (sickness, lost item, bad dream), **Major**
   (a villager falls ill, a building damaged, a creditor appears at the door), **Grave** (a
   hidden clause triggers, a death, possession).
4. Paying: completing a creditor's demand reduces the specific entry; some debts can only be
   cleared by route events (breaking the pact).
5. **Inheritance:** an heir inherits all debt. The Bloodline Tree can reduce inherited debt by a percentage.
6. More debt = stronger dark talents (`floor(debt/10)` scaling).

## Initial formulas

- Collection chance per night: `min(60%, 3% × total/5)` → 10 debt = 6%, 50 debt = 30%, 100+ = 60%.
  +5% per Darkness level in the Endless Chronicle.
- Severity: roll d100 + total debt: < 70 Minor, 70–119 Major, ≥ 120 Grave.
- "Friend of the Collector" talent shifts one tier down.

## Events

- **Emits:** `debt/added`, `debt/collected { tier, effectId }`, `debt/paid`, `debt/inherited`.
- **Consumes:** `pact/signed`, `talent/chargeUsed` (dark), `time/midnight`, `lineage/heirChosen`.

## Edge cases

- Two collections cannot happen in one night.
- Grave collection with no eligible target (everyone protected) → converts to Major + Notice +10.
- Debt reduced below 0 by Bloodline perks → clamp to 0.

## Test ideas

- Chance table: total 0 ⇒ 0%; 10 ⇒ 6%; 200 ⇒ 60% cap.
- Seeded run: 100 nights with debt 50 ⇒ collection count within the binomial 95% interval.
- Heir inherits exact total and entries.
- Severity boundaries at 69/70 and 119/120.
