# Skills

Status: v1 (implemented, see [progression](progression.md)) · MVP: ✅ · Package: `packages/core/guardian/skills` · Back to [GDD](../GDD.md) · [index](README.md)

## Purpose

Learned competences that **improve by use**. Revelation only raises how far they can improve
(the **rank cap**).

## Data

10 skills (v1, see [progression](progression.md)), ranks **0–5**:

| Attribute | Skills                         |
| --------- | ------------------------------ |
| Vigor     | Combat                         |
| Agility   | Stealth                        |
| Wits      | Investigation, Lore, Herbalism |
| Cunning   | Occultism, Survival            |
| Resolve   | Exorcism, Faith                |
| Presence  | Persuasion                     |

The draft's 17 skills were merged: Athletics → Survival, Marksmanship → Combat, Deception /
Leadership / Intimidation → Persuasion, Craft → Survival, Liturgy / Composure → Faith.

Per skill: `{ rank, cap, usePoints }`.

## Rules

1. **Use points** are awarded whenever the skill is rolled in a meaningful check (not trivial
   checks, not repeated within 10 in-world minutes on the same target).
2. When `usePoints ≥ threshold(rank)` and `rank < cap` → rank +1, points reset.
3. If `rank == cap`, points accumulate up to the threshold and wait (shown as "ready to grow").
4. Cap at creation: **2** for calling skills, **1** for others. Raise cap with Revelation:
   `5 × new cap` (calling) or `5 × new cap + 5` (other). Max cap 5.
5. Starting ranks: three calling skills at 1 ([callings](../lore/callings.md)).
6. Skills are **not inherited** by heirs; heirs start from their own calling. Journal entries can
   give an heir a one-time head start (use points) in the skills they cover.

## Initial formulas

- Use points per check: failure **2** (you learn from failure), success **1**, success with good
  omen **2**, any check at difficulty ≥ Hard **+1**.
- Threshold to next rank: `6 × (rank + 1)²` → 6, 24, 54, 96, 150.

## Events

- **Emits:** `skill/used { skillId, points }`, `skill/rankUp`, `skill/capRaised`, `skill/readyToGrow`.
- **Consumes:** `check/resolved`, `revelation/spent`, `lineage/heirChosen`.

## Edge cases

- Farming: anti-grind rule (same target within 10 minutes gives 0); scripted "training" tasks give
  capped points per day (6).
- Raising the cap when points are already ≥ threshold → rank up immediately.

## Test ideas

- Rank 0 → 1 after exactly 6 points; rank 1 → 2 after 24 more.
- A rank at cap never increases until the cap is raised; then it increases at once if points suffice.
- Repeated checks on the same target within 10 min award 0 points.
- Cap raise costs: calling cap 3 = 15, non-calling cap 3 = 20.
