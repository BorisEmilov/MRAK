# ADR 0003 — Ink for dialogue and narrative

- Status: accepted
- Date: 2026-11-15
- Back to [GDD](../GDD.md) · spec: [dialogue](../systems/dialogue.md)

## Context

The game is dialogue-heavy (confessions, bargains, mysteries, festivals) with branching that
depends on world state. Writers need a readable format with version control and testing.

## Decision

- Use **Ink** (inkle) for all dialogue and narrated scenes; compile `.ink` to JSON at build time;
  run with the inkjs runtime.
- Ink **reads and writes WorldState only through external functions** from a whitelist; core
  validates every call as a command.
- Lines carry localization keys (`#key:…`); English text resolves from `locales/en.json`.
- Choice tags (`#virtue:…`, `#sin:…`, `#check:…`, `#noSinTakeover`) are interpreted by core.
- Saves store the current knot path (not the internal pointer) to survive story updates.

## Consequences

- ✔ Mature, writer-friendly tool; plain text in git; testable with scripted choices.
- ✔ Clear separation: Ink owns flow, core owns rules and state.
- ✘ Localization pipeline must extract keys from Ink (tooling needed).
- ✘ Debugging state across the boundary needs a dev overlay (log external calls).

## Alternatives considered

- Yarn Spinner: good, but weaker JS ecosystem. Custom JSON trees: unreadable for writers at scale.
