# World State

Status: Draft v0.1 · MVP: ✅ · Package: `packages/core/world` · Back to [GDD](../GDD.md) · [index](README.md)

## Purpose

The single, serializable source of truth for a playthrough. Every system reads from and writes to
the WorldState through pure functions in `packages/core`. React and Phaser only see **read-only
snapshots**; Ink only touches it through **external functions** ([dialogue](dialogue.md)).

## Data

| Slice       | Contents                                                                                                             | Owner spec                                                     |
| ----------- | -------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| `meta`      | schemaVersion, seed, createdAt, playtime, contentVersion, mode (story / endless), darknessLevel                      | [save-system](save-system.md)                                  |
| `clock`     | in-world date (Julian), phase, minute, chapterId, nightIndex                                                         | [time-calendar](time-calendar.md)                              |
| `guardian`  | identity, calling, attributes, skills, talents, sanity, faith, corruption, debt, virtue, sin, notice, gear, injuries | many                                                           |
| `village`   | villagers, buildings, resources, hysteria, prosperity, reputation, factions                                          | [villagers](villagers.md), [village-growth](village-growth.md) |
| `world`     | zones and their variants, flags, discovered POIs, moon state                                                         | [night-exploration](night-exploration.md)                      |
| `mysteries` | active mysteries, clues found, board links, conclusions                                                              | [mysteries](mysteries.md)                                      |
| `occult`    | demons (known names, seals), possessions, pacts, sacrifices                                                          | [possession](possession.md), [pacts](pacts.md)                 |
| `journal`   | entries, pages, inherited entries                                                                                    | [journal](journal.md)                                          |
| `quests`    | quest states                                                                                                         | [quests](quests.md)                                            |
| `lineage`   | family members, past guardians, heirlooms                                                                            | [lineage](lineage.md)                                          |
| `eventLog`  | bounded ring buffer (last 500) of domain events for debugging and the director                                       | [event-director](event-director.md)                            |
| `rng`       | named PRNG stream states (`director`, `checks`, `night`, `villagers`, `loot`)                                        | —                                                              |

Account-level data (Bloodline Tree, achievements, Cycle count) is **not** in WorldState: it lives
in the `Profile` ([bloodline-tree](bloodline-tree.md), [achievements](achievements.md)).

## Rules

1. **Pure updates:** `apply(state, command) → { state', events[] }`. No hidden mutation, no I/O.
2. **Commands in, events out:** UI and scenes send commands (`GuardianMove`, `AssignTask`,
   `CommitConclusion`…); core validates them against state and returns domain events.
3. **Event naming:** `<domain>/<pastTense>` — e.g. `time/nightStarted`, `villager/fearChanged`.
4. **Randomness:** only through named seeded streams (`IRandom`), so a seed + command log replays
   a whole playthrough deterministically.
5. **Serializable:** plain JSON (no classes, Maps, Dates — dates as day indices + minute).
6. **Content by reference:** state stores content IDs (`demon.mamnik`), never content copies.
7. **Snapshots:** a frozen projection per frame-independent tick; React re-renders on events, not frames.

## Initial formulas

- Tick: the simulation advances in **in-world minutes**; 1 in-world minute = 1 real second at
  night by default (an in-world night 20:00 → 06:00 ≈ 10 real minutes, tuned per chapter).
- Event log retention: last 500 events or last 3 in-world days, whichever is smaller.

## Events

- **Emits:** `state/loaded`, `state/migrated`, `state/commandRejected { reason }`.
- **Consumes:** every command from UI/scenes.

## Edge cases

- Commands referencing unknown content IDs (outdated save, removed DLC) → rejected with
  `unknownContent`; save migration must have replaced them.
- Two commands in the same tick → processed in arrival order; the order is recorded for replay.
- Very long Endless runs → event log and history are bounded; old journal entries are archived, not deleted.

## Implementation (core v1)

- `packages/core/src/state/world-state.ts`: Zod `WorldStateSchema` is the source of the types
  (`WorldState`, `Snapshot` = deep-readonly). Slices: `clock`, `calendar` (chapter, night index),
  `flags`, `stats` (absent = registry default; clamped to the declared range), `villagerStats`,
  `counters`, `zones` (explicit variant, discovered, visits), `currentZone`, `villagers` (alive,
  affinity), `guardian`, `quests`, `mysteries`, `pacts`, `debt`, `possessions`, `modifiers`,
  `abilities`, `decisions` (id, choice, in-game time, context), `narrations`, `playtimeMs`.
- `WorldStore` commits deep-frozen snapshots and notifies subscribers once per commit with its
  events. Commands work on a deep copy and commit atomically (RNG streams are rolled back too on
  rejection); the tick fast path only replaces `clock` and `playtimeMs` (structural sharing).
- `Game` (constructor injection: content, RNG streams, clock, bus, rule handlers, wall clock)
  exposes `tick(dtMs)`, `dispatch(command)`, `snapshot()`, `subscribe()`, `save()`, `Game.load()`.
- Commands (Zod-validated): `applyEffects`, `advanceTime`, `setPaused`, `setSpeed`, `enterZone`,
  `recordDecision`, `useAbility`, `triggerEvent`.
- RNG streams: `director`, `checks`, `night`, `villagers`, `loot`, each seeded with
  FNV-1a(`seed:name`) so consuming one never shifts another.
- `reconcileWithContent` adds villagers/zones that content defines but a (migrated) state lacks.

## Test ideas

- Replay: same seed + same command log ⇒ byte-identical final state.
- Round-trip: `deserialize(serialize(s))` deep-equals `s` for fuzzed states.
- Every reducer is pure: calling it twice with the same input yields equal output and does not
  mutate the input (frozen-object test).
- Rejected commands leave state unchanged and emit exactly one `state/commandRejected`.
- Size budget: a 100-hour Endless state serializes to < 1 MB.
