# ADR 0002 — Content as data, validated by schemas

- Status: accepted
- Date: 2026-11-15
- Back to [GDD](../GDD.md)

## Context

MRAK has a large, growing body of content: villagers, demons, talents, recipes, events,
mysteries, festivals, achievements, seasonal packs. Content must be editable by writers and an
internal studio tool, deliverable without client updates (seasonal packs), and safe to load.

## Decision

- All content lives as **data** in `packages/content` (JSON, compiled Ink, Tiled maps, atlases).
- Every content type has a **Zod schema** in `packages/content-schema`; CI validates all content.
- Effects are **declarative specs** interpreted by core (e.g. `{ type: "fateDie", … }`) — no
  per-item code.
- Player-facing text is referenced by **localization keys** (`locales/en.json`).
- Cross-reference validators (e.g. talent prereqs exist, mystery culprits have ≥ 2 solid clues,
  no child targets for immured shadows) run in CI.
- Downloaded packs are data only, signed, and validated by the same schemas.

## Consequences

- ✔ Designers and the studio tool change content without code; seasonal packs ship live.
- ✔ Content bugs are caught by validators instead of at runtime.
- ✘ The effect interpreter must be expressive enough; new effect types require code + schema
  change (reviewed).
- ✘ Schema migrations for content and saves must be maintained.
