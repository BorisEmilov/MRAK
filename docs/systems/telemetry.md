# Telemetry — gameplay analytics

Measures how people play, to balance the game and improve demo conversion. **Opt-in only**: off by
default, nothing is queued or sent without consent. Security control: threat model C-26; data:
[data inventory](../security/data-inventory.md) (90-day retention).

## Consent (game)

- Option `telemetry` (Options → Privacy), default **off**, with a plain explanation of what is
  sent. Turning it on creates a random install id (UUID v4, `localStorage`
  `mrak.telemetry.install.v1`). The install id is never linked to an account.
- Turning it off drops the queue and deletes the install id; turning it on again starts a new one.
- Without consent `TelemetryService.track()` does nothing and `flush()` sends nothing (tested).

## Client (`apps/game/src/telemetry/telemetry.ts`)

- `TelemetryService`: events are queued in memory (≤ 200; the oldest are dropped), sent in batches
  of ≤ 50 every 30 s, when 20 are waiting and on `pagehide` (`fetch` `keepalive`). Failures drop
  the batch (no retries: analytics are not worth a backlog).
- Sampling: `VITE_TELEMETRY_SAMPLE` (0–1, default 1) decides per install, from the install id, so
  a sampled install sends whole sessions. Without `VITE_API_URL` the service is not created.
- Batch: `{ install, session, build, demo, events: [{ e, t, zone?, key?, cause?, value?, n? }] }`.
  `t` = ms since session start. String fields are content ids (kebab-case), never free text,
  except the scrubbed `text` of a JavaScript error.

| Event           | When                                           | Fields                                    |
| --------------- | ---------------------------------------------- | ----------------------------------------- |
| `session-start` | service started with consent                   | —                                         |
| `session-end`   | `pagehide`                                     | `value` = session seconds                 |
| `game-start`    | new game                                       | —                                         |
| `decision`      | `state/decisionRecorded`, `pact/signed`        | `key` decision/pact, `cause` choice       |
| `death`         | `guardian/died`                                | `zone`, `cause`, `n` night                |
| `mystery-start` | `mystery/started`                              | `key`                                     |
| `mystery-end`   | `mystery/concluded`, `mystery/unsolved`        | `key`, `cause` action or `unsolved`       |
| `zone`          | `world/zoneEntered` (route)                    | `zone`, `n` night                         |
| `sample`        | every 60 s of play                             | `zone`, `value` sanity, `n` tension       |
| `night-start`   | `night/started`                                | `n` night                                 |
| `night-end`     | `night/completed`                              | `n` night, `value` real seconds           |
| `chapter-end`   | calendar chapter changes                       | `key` chapter, `value` real seconds       |
| `prologue-end`  | flag `prologue-complete`                       | `value` session seconds                   |
| `demo-end`      | demo-end card                                  | —                                         |
| `buy-click`     | "Buy" on the demo-end card                     | —                                         |
| `purchase`      | the full game becomes available on this device | —                                         |
| `js-error`      | `error` / `unhandledrejection`                 | `key` error name, `text` scrubbed (≤ 120) |

`text` loses URLs, e-mail addresses, numbers and quoted strings before it is queued.

## Ingestion (online-api `POST /v1/telemetry`)

- Body ≤ 8 kB; envelope strict (`install` UUID, `session` UUID, `build` ≤ 32, `demo`), ≤ 50 events
  (51 → 400). Each event is parsed on its own: unknown names, extra fields, non-id strings or a
  `text` with `@` or `//` are **dropped**, not stored.
- Rate limits `telemetry-install` (60/h per install, header `X-MRAK-Install`) and `telemetry-ip`
  (600/h); edge limit 30/min per IP (C-03).
- Kill switch `telemetry`: answers **202** and stores nothing. Server sampling
  `TELEMETRY_SAMPLE` (0–1, per install). Storage errors also answer 202 (drop on overload).
- Stored with the **server** day. Nothing else from the request (IP, user agent, account) is kept.

## Storage

PostgreSQL schema `telemetry` (outside Prisma's model; written with raw SQL), table
`telemetry.events` **partitioned by day** (`PARTITION BY RANGE (day)`). `telemetry.maintain(days)`
creates the partitions of today + 7 days and drops partitions older than the retention (90 days);
online-api calls it at start and hourly. Rows that arrive without a partition are dropped (202).

## Studio panel (studio-api `GET /v1/telemetry?days=`)

studio-api reads `telemetry.events` through the restricted online-database connection
(`SALES_DATABASE_URL`, needs `SELECT` on `telemetry.events`), at most the last 90 days and 200 000 rows, and aggregates in `aggregate()` (pure, tested):

- **Demo funnel:** installs with `session-start` → `prologue-end` → `demo-end` → `buy-click` →
  `purchase`.
- **Death heatmap:** zone × night, and causes per zone.
- **Routes:** most common zone-to-zone transitions within a session.
- **Night duration:** median and mean real minutes per night.
- **Tension and sanity:** mean tension and sanity per night (from `sample`).
- **Decisions and mysteries:** choice counts; mystery outcomes.
- **Errors:** most frequent `js-error` (name + text).

The Studio-web tab **telemetry** renders it. Without `SALES_DATABASE_URL` the route answers
503 `telemetry_unavailable`.
