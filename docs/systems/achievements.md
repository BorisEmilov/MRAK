# Achievements

Status: Draft v0.1 · MVP: ✅ (15) · Package: `packages/core/achievements` + `services/online-api` · Back to [GDD](../GDD.md) · [index](README.md)

## Purpose

Recognise meaningful play — knowledge, mercy, terrible choices — and feed Legacy. Stored in the
Profile; synced for accounts.

## Data

Content `achievements/*.json`: `{ id, tier: demo | full, nameKey, descKey, iconId?, hidden, condition }`.
The condition uses the core condition language over the WorldState (events reach it as flags and
stats). A top-level numeric condition (`stat` or `collection` with `>=`) shows progress ("3/10").
Profile (account level, `mrak.bloodline.v1`, never in a save): `achievements: { id, at }[]`,
`stats: { nights, exorcisms, routes[], endings[] }`.

## MVP list (15)

| ID                    | Name                    | Condition                                    | Hidden |
| --------------------- | ----------------------- | -------------------------------------------- | ------ |
| `ach.prologue`        | The Smoke at Enyovden   | Finish the prologue                          | no     |
| `ach.first-night`     | First Watch             | Survive night 1                              | no     |
| `ach.koledari`        | Carols Against the Dark | Escort the koledari on Christmas night       | no     |
| `ach.lead`            | What the Lead Showed    | Use lead pouring on a villager               | no     |
| `ach.first-exorcism`  | Kyrie Eleison           | Complete an exorcism                         | no     |
| `ach.true-name`       | A Name Spoken           | Learn a demon's true name                    | no     |
| `ach.board`           | Threads on the Wall     | Fully support 5 propositions on the board    | no     |
| `ach.m1-right`        | The Bride Wakes         | Solve M1 correctly and save Velika           | no     |
| `ach.m1-wrong`        | As It Was in 1779       | Let an innocent be killed by the mob         | yes    |
| `ach.no-dawn-penalty` | Home Before the Cock    | Finish the chapter without a dawn penalty    | no     |
| `ach.pact`            | Ink of Blood            | Sign a pact at the crossroads                | yes    |
| `ach.debt-paid`       | Settled                 | Pay off a debt entry completely              | no     |
| `ach.full-tree-t2`    | Calling Answered        | Buy all T1–T2 talents of a tree              | no     |
| `ach.no-lantern`      | Moonless                | Survive a night without lighting the lantern | yes    |
| `ach.theophany`       | The Waters Are Blessed  | Reach Theophany dawn                         | no     |

Collection achievements (fed by [collection](collection.md) progress through the `collection`
condition):

| ID                       | Name                     | Condition                               | Hidden |
| ------------------------ | ------------------------ | --------------------------------------- | ------ |
| `herbalist`              | Every Herb in Its Season | `{"collection": "herbs", ">=": "all"}`  | no     |
| `songs-of-mrak`          | Songs of Mrak            | `{"collection": "songs", ">=": 3}`      | no     |
| `cabinet-of-curiosities` | Under Glass              | `{"collection": "cursed", ">=": "all"}` | no     |

## Rules

1. Conditions are event predicates evaluated in core; unlocking is idempotent.
2. Hidden achievements show "???" until unlocked; descriptions never spoil route truths.
3. Cloud sync: the server records unlocks it receives; achievements are **not** a security
   boundary (single-player data can be tampered with) — they never grant paid content.
4. Each **new** achievement gives +2 Legacy at generation end.
5. Demo builds unlock only `demo: true` achievements; they carry over to the full game.

## Account progress

1. **AchievementSystem** (`packages/core/src/chronicle/achievements.ts`): the host feeds it every
   batch of core events; it evaluates each condition (`Game.check`) and unlocks it once,
   emitting `achievement/unlocked { id }` (HUD notice with icon). `recordProfileStats` keeps the
   global stats; `cycleUnlocks` opens The Cycle once a route was completed in any chronicle.
2. **Never lost:** guests keep it in the local profile; deleting a save never touches it.
3. **Sync** (`apps/game/src/storage/account-sync.ts`): achievements, Bloodline nodes, Legacy
   awards, stats, routes and endings are queued in an IndexedDB outbox and sent in batches of
   ≤ 50 to `POST /v1/progress` with exponential backoff (2 s … 5 min), on `online` and at startup.
   The server is idempotent per (account, kind, key); counters keep the highest value. After
   signing in, `GET /v1/progress` is merged into the local profile (`mergeProfiles`).
4. **Server** (`services/online-api`, table `account_progress`): `POST /v1/achievements/unlock`,
   `GET /v1/achievements`, `POST|GET /v1/progress`. Unknown ids and `full`-tier ids without the
   `full-game` entitlement are refused. Needs an account (401 until accounts exist). No public
   rankings. Risks: [threat model](../security/threat-model.md).

## Initial formulas

None beyond Legacy +2 per new achievement.

## Events

- **Emits:** `achievement/unlocked { id }`.
- **Consumes:** any domain event.

## Edge cases

- Same achievement unlocked offline on two devices → merge keeps earliest `unlockedAt`.
- Content removes an achievement → stays in profile as legacy, hidden from lists.

## Test ideas

- Each MVP achievement has a scripted scenario test that unlocks it.
- Idempotency: triggering twice records once.
- Demo build cannot unlock non-demo achievements.
- Merge keeps earliest timestamp.
