# Bloodline Tree

Status: Draft v0.1 · MVP: ✅ (Tier 1) · Package: `packages/core/profile/bloodline` · Back to [GDD](../GDD.md) · [index](README.md) · pacing: [progression-economy §7](progression-economy.md#7-bloodline-tree-pacing)

## Purpose

Permanent, **account-level** progression across generations and playthroughs: family traits,
heirlooms and starting bonuses, so every guardian starts a little stronger — within limits.

## Data

Stored in the **Profile** (not WorldState): `{ legacy: { available, lifetime }, nodes[] }`.
Content `bloodline/*.json`: `{ id, tier, cost, prereqs[], effect, exclusiveWith? }`.

**Tier 1 (MVP):**

| Node                       | Cost | Effect                                                               |
| -------------------------- | ---- | -------------------------------------------------------------------- |
| Light-Keepers              | 5    | Lantern oil lasts +10%.                                              |
| Grandmother's Remedies     | 5    | Start each generation with 2 calming teas.                           |
| The Family Icon (heirloom) | 8    | Heirloom amulet: Faith +5 at start; permanent blessing slot.         |
| Watchful Blood             | 5    | +5 starting max Sanity.                                              |
| House of the Bell          | 6    | Village starts with watchtower lvl 1 already built (new chronicles). |
| Letters Kept               | 8    | Journal capacity +4 pages.                                           |

Tiers 2–5 (full game): attribute starting points (+1, max once), inherited Debt −20%, extra heir
options, family traits (Stana's Eyes, The Torch's Shame), heirloom upgrades; Tier 5 = exclusive
pairs (e.g. _Line of Light_ vs _Line of the Forest_).

## Rules

1. Legacy is awarded at generation end (formula in progression-economy §7).
2. Nodes are bought between generations or from the main menu; they apply to the next guardian/chronicle.
3. Bonuses are **flat and capped**: the Bloodline Tree can never raise an attribute above 4 at creation.
4. Guest players keep the Profile locally; with an account it syncs to the cloud ([save-system](save-system.md)).
5. Never purchasable with money.

## Initial formulas

`Legacy = floor(lifetimeRevelation / 25) + 5 × chaptersSurvived + 2 × newAchievements + journalTruths`.

## Events

- **Emits:** `bloodline/legacyAwarded`, `bloodline/nodeBought`.
- **Consumes:** `lineage/generationEnded`, `achievements/unlocked`.

## Edge cases

- Profile conflict between local guest data and a newly created account → merge by taking the
  union of nodes and the max of legacy (never lose progress).
- Content removing a node → refund its cost in Legacy.

## Test ideas

- MVP reference run (240 Revelation, 1 chapter, 3 new achievements, 3 truths) ⇒ 9 + 5 + 6 + 3 = 23 Legacy (inside the 18–26 target band).
- Exclusive T5 pairs cannot both be owned.
- Attribute bonus never pushes creation above 4.
- Merge function is commutative and idempotent.

## Implementation (v1)

- Core: `packages/core/src/chronicle/profile.ts` (`Profile`, `awardLegacy` once per generation,
  `buyNode`, `nodeBlocked`, `mergeProfiles`: union of nodes and awards, max of Legacy).
- `createGuardian { …, bloodline }` applies the owned nodes (prerequisites and exclusive pairs
  checked; a `calling.bloodline` lock needs its node) with source `bloodline:<id>`, and records them
  in `lineage.bloodline` (the save mirrors the account).
- The game keeps the profile on the device (`localStorage`, `mrak.bloodline.v1`; no personal data,
  no tokens). **Not done:** cloud sync. The online API has no accounts or auth yet; the endpoint must
  come with them (Zod-validated, rate-limited, server-side legacy checks, threat-model update).
- Tier 2 (full) nodes: Stana's Eyes (family trait), Hardy Stock (starting bonus), The Red Thread
  (relic). No content calling is locked behind a node yet.
