# Event Director

Status: Draft v0.1 · MVP: ✅ · Package: `packages/core/director` · Back to [GDD](../GDD.md) · [index](README.md)

## Purpose

Paces dread. Chooses and fires events — the bell at 3:33, a shared dream, sleepwalkers walking
to the water, a stranger who knows your name — mixing **noise**, **mystery seeds** and
**hallucinations** so that the player never knows which is which (pillar 4), and so that scares
are earned rather than cheap (pillar 1).

## Data

Content `events/*.json`:
`{ id, category (noise|seed|hallucination|set-piece), tags, conditions, weight, cooldown,
tensionCost, effects[], presentation (sound, visual, text keys), realityHint? }`.
State: `{ tension 0–100, budgetThisNight, cooldowns, recent[], pacingPhase }`.

## Rules

1. **Tension curve** per night: _settle_ (first 20%) → _build_ → _peak_ around 03:33 → _release_
   before dawn. The director spends a **budget** of tension cost per phase.
2. Each tick (every 30 in-world minutes, and on special minutes) it may fire one event:
   select category by mix weights → filter by conditions and cooldowns → weighted pick.
3. **Mix:** noise 45%, seed 35%, hallucination 20% at full sanity; hallucination share follows
   [sanity](sanity.md); Notice multiplies guardian-targeted events ([journal](journal.md)).
4. **Seeds** are tied to active mysteries and possessions; every mystery guarantees its seeds
   appear before its deadline.
5. Hallucinations **look identical** to real events; their effects on state are only on the
   guardian (sanity, perception), never on the world — except what the player does in response.
6. After a peak scare, a **mandatory quiet** (no stacked jump scares; see Implementation).
7. Village events continue while the guardian is away (sleepwalkers, attacks) and are reported at dawn.
8. Deterministic with the `director` RNG stream.

## Initial formulas

- Fire probability per tick: `p = clamp(0.15 + tension/200 − recentPenalty, 0.05, 0.6)`.
- Budget per night: 100 × chapter intensity (Unclean Days 1.2).
- `recentPenalty = 0.1 × events fired in the last hour`.

## Implementation (v1)

Code: `packages/core/src/fear/director.ts`. Numbers: `data/fear-rules/default.json` → `director`.
State: `WorldState.director { tension, night, spent, cooldowns, recent, quietUntil, occurrences,
log }`.

1. **Ticks** at every :00 and :30 of the night phase, plus the witching minute (03:33), which
   only considers events with a `window` containing it (scripted moments such as the bell).
   Events with a `window` never fire outside it.
2. **Pacing phase**: `settle` (first `settleShare` of the night) → `build` → `peak`
   (`peakAround` ± `peakHalfWidth` minutes) → `release` (until dawn). Each phase has a **target
   tension** (`targets`; build ramps from `buildFrom` to `buildTo`). Tension decays by
   `decayPerTick[phase]` each tick (slow while building, fast in the release) and rises by the fired event's `tensionCost`.
3. **Fire chance** (replaces the draft formula): `p = clamp(base + (target − tension) /
tensionDivisor − recentPenalty × fired in the last hour, min, max)`. Below target the director
   pushes, above it holds back — which produces the build, the peak and the valley.
4. **Budget**: `perNight × chapterIntensity` split by phase `shares`; an event whose cost exceeds
   what is left of its phase is not a candidate.
5. **Quiet**: an event with `tensionCost ≥ peakCost` starts a quiet of `quiet.min`–`quiet.max`
   minutes (ticks are 30 minutes apart, so the quiet is at least one tick) and emits
   `director/peakReached`.
6. **Weight** of a candidate = `weight` × season (`bias.seasons`) × hour (`bias.hours`) × zone
   (`zoneFactor` in the guardian's zone, `offZoneFactor` elsewhere) × (1 + `bias.corruption` ×
   Corruption/100) × (1 + `bias.hysteria` × Hysteria/100) × (1 + `bias.lowSanity` × (1 −
   Sanity/max)) × Notice weight for `target: "guardian"` events. Categories are chosen first by
   the mix (hallucination share from [sanity](sanity.md)), among categories with candidates.
7. Every tick writes a **decision** to `director.log` (phase, target, tension, p, roll, outcome,
   chosen event and its factors) — read by the debug console's _director_ tab. The log is
   debug data: the UI never shows categories to the player.
8. **Occurrences**: each fired event gets an occurrence id. Within `evidence.windowMinutes` the
   guardian may test it once per method with `examineEvent`: `photograph` (camera + one plate,
   from the item rules), `witness` (a living villager whose affinity to the guardian is at least
   `minAffinity`; a hidden possession host lies) or `relic` (a carried item tagged
   `evidence.relic.tag`, consumed). Each gives **probabilistic** evidence (`presence` true/false),
   never the label.
9. `pnpm --filter @mrak/core simulate:fear [nights] [seed]` runs the real content and writes the
   tension curve to `packages/core/sim-out/fear.csv`.

## Events

- **Emits:** `director/eventFired { event, occurrence, zone }` (no category), `director/peakReached`,
  `director/evidenceFound { occurrence, method, presence }`.
- **Consumes:** `time/*`, `sanity/changed`, `notice/changed`, `mystery/started`, `possession/*`.

## Edge cases

- No eligible event → skip tick (never force).
- Mystery seed deadline with the guardian unreachable (in a far zone) → seed relocates to the
  guardian's zone variant.
- Accessibility "reduced scares" setting: lower peak intensity, same information content.

## Test ideas

- Over 1,000 seeded nights, category frequencies match the configured mix ±3%.
- Quiet period: no two `peak` events within `quiet.min` in-world minutes.
- 12 seeded nights: every night has a tension peak at or after the build phase and a valley after it.
- Every active mystery's required seeds fire before its deadline in 100% of seeded runs.
- Hallucination events never modify world state slices other than `guardian.*`.
- Same seed + same inputs ⇒ same event sequence.
