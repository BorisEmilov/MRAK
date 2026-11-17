# ADR 0004 — Pure TypeScript core for all game rules

- Status: accepted
- Date: 2026-11-15
- Back to [GDD](../GDD.md) · spec: [world-state](../systems/world-state.md)

## Context

MRAK's rules are deep and interconnected (fear contagion, omens, debt, possession, hysteria,
generations). They must be testable, reproducible and independent of rendering, and later reusable
by the server (validation, simulation) and tools (studio balancing).

## Decision

- All rules live in `packages/core`: **pure TypeScript, no Phaser, no React, no DOM** (enforced by ESLint).
- State changes are pure functions `apply(state, command) → { state, events }`.
- All randomness goes through **seeded `IRandom` streams**; seed + command log replays a game.
- WorldState is plain serializable JSON.
- Unit tests with Vitest; simulation and property-based tests for balance and invariants.

## Consequences

- ✔ Deterministic tests and replays; bugs reproducible from a seed and log.
- ✔ Same rules usable in services (e.g. validating cloud saves) and the studio (balancing sims).
- ✘ More discipline: scenes must send commands rather than mutate; adapters needed for Phaser
  physics results (collisions become commands/events).
- ✘ Performance must be watched for per-tick simulation (village while away); budgets in tests.
