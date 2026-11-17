# Sanity

Status: Draft v0.1 · MVP: ✅ · Package: `packages/core/guardian/sanity` · Back to [GDD](../GDD.md) · [index](README.md)

## Purpose

The guardian's grip on reality, and the village's collective calm. Low sanity makes the world
lie (hallucinations) — and the player can never be sure which events were real (pillar 4).

## Data

- `guardian.sanity` 0..max (max = 60 + 8 × Resolve + talents).
- `village.sanity` 0–100 = derived: `100 − weightedMean(villager.fear)` (weights: adults 1, children 1.5).
- `guardian.traumas[]` — lasting effects from Sanity breaks.

## Rules

1. **Drains:** darkness without light (−1 per 10 in-world minutes, i.e. ≈ every 10 real seconds at default speed), sightings (−5 to −20), samodivi dances, cursed
   objects, possession witnessed, failed rituals, Notice ≥ 75 dreams.
2. **Restores:** dawn in a house (+20), chapel service (+15), calming tea, Kyrie, companions,
   virtue streak, sleeping well (no Mora).
3. **Thresholds:**
   - < 50: +1 Shadow die on checks; hallucination share in the director rises.
   - < 25: +2 Shadow dice; the guardian's fear spreads to villagers; UI subtly distorts (never
     unreadable — accessibility setting can disable distortion).
   - 0: **Break** — the guardian collapses; wakes at dawn with a **trauma** (e.g. fear of water:
     −1 Fate near water) and the dawn penalty.
4. Hallucinations are never labelled. Tools give **probabilistic** evidence only (holy water
   sizzles 80% for real demons, 20% for hallucinations).
5. Village sanity < 40 → Hysteria gain ×1.5 ([hysteria](hysteria.md)).

## Initial formulas

- Hallucination share of director events: `0.2 + max(0, (50 − sanity)/100)` (max 0.6); 0.2 at full sanity matches the [director](event-director.md) mix.
- Trauma severity: random from table weighted by the cause of the break.

## Implementation (v1)

Code: `packages/core/src/fear/sanity.ts`. Numbers: `data/fear-rules/default.json` → `sanity`.

- **Tiers** (fraction of max Sanity, data `sanity.tiers`): each tier lists perception effects the
  presentation layer applies — `filter` (desaturated, vignetted view), `whispers` (caption lines
  from `whisperKeys`), `moving-objects` (props shift when unobserved), `staring` (villagers turn
  to face the guardian). `perception(state, db)` returns the active tier and its effects; the
  game hides them when the player enables _Reduce distortion_ (accessibility). Crossing a tier
  emits `sanity/tierChanged { tier }` (an index, never the number).
- **Shocks** (data `sanity.shocks`): a demon learned (`journal/learned` kind demon), forbidden
  knowledge (every point of Notice gained × `forbiddenPerNotice`), and the engine rule
  `sanity-shock { cause }` which content uses for sacrifices, demon sightings and rituals.
- **Restores:** dawn in a home zone (`dawnAtHome`) plus `faith / faithDivisor`; each night hour
  with the lantern lit and outside darkness (`lightPerHour`); the `rest` command
  (`restPerHour`, only in a home zone, never at night).
- **Break:** reaching 0 emits `sanity/broken` once (counter `sanity-breaks`) and raises the
  guardian's suspicion (`hysteria.guardianSuspicion.broken`). Traumas are not in v1.

## Events

- **Emits:** `sanity/tierChanged`, `sanity/broken` (and `state/statChanged` for the value).
- **Consumes:** `light/darknessTick`, `director/eventFired`, `time/dawn`, `alchemy/consumed`.

## Edge cases

- Max sanity reduced below current (injury to Resolve) → clamp, no break.
- Multiple breaks in one chapter → traumas stack up to 3, then the guardian may **retire** by choice.

## Test ideas

- A full night (600 in-world minutes) in darkness without light drains exactly 60 Sanity before modifiers.
- Sanity 30 ⇒ hallucination share 0.4; sanity 0 ⇒ 0.6 (cap).
- Break at 0 schedules a trauma and a dawn wake-up.
- Distortion setting off ⇒ UI snapshot has no distortion flags.
