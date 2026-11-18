# Studio — visual content editor

Internal tool that edits `packages/content` without hand-editing JSON. Schemas:
[content-model](content-model.md), [conditions & effects](conditions-effects.md). The Studio is
**never public**: it runs behind Cloudflare Access or a VPN, and locally it accepts loopback only.

## Parts

- **services/studio-api** (Express + Prisma + its own PostgreSQL `studio` database). It imports and
  exports content, stores entries with their history, and runs the validator and the analysis.
- **apps/studio-web** (React + Vite). It has forms generated from the JSON Schemas, a visual
  condition and effect editor with id autocomplete, React Flow graphs, villager and mystery views,
  the analysis panel and the "Export to game" button.

## Data

| Table               | What                                                                                                                                                                                                                                                                                                                     |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `content_entries`   | One row per entity `(collection, entityId)`. `collection` is a content collection, `registry` (the single `flags` entry = `flags.json`) or `locales` (one row per key). Columns: `file` + `position` (where it is exported), `body` (working copy, JSONB), `publishedBody`, `status`, `version`, `updatedBy`, `deleted`. |
| `content_revisions` | Every saved version: body, status, author, note and time. Diffs are computed between any two versions.                                                                                                                                                                                                                   |

Workflow: saving a body creates a new version with status `draft` and validates the body with
the collection's Zod schema (422 with the issues otherwise). `reviewed` must be set by someone
other than the last editor; the local user `local` is exempt. `published` needs `reviewed` and
copies the body to `publishedBody`. **Only published bodies are exported.** Deleting marks the
entry `deleted` as a draft; publishing it removes the entry from exports.

## Import / export

- **Import** (`POST /v1/import`) reads `CONTENT_ROOT` (default `packages/content`) with the same
  loader as `pnpm content:validate`. Each data file entity, the registry and each locale key
  becomes a published entry; unchanged ones are skipped. Ink stories and maps stay files: they are
  read for the analysis, not edited.
- **Export** (`POST /v1/export`) rebuilds the files from published bodies. An entity goes back to
  its file and position; new entities go to their collection's array file (or
  `data/<collection>/<id>.json` when there is none). The whole pack must pass `validatePack`, or
  the export answers 422 with the errors. Then it:
  - writes the changed data and locale files to `CONTENT_ROOT`, formatted with Prettier
    ("Export to game", development only),
  - bumps the manifest patch version and writes `manifest.json` (file hashes and pack hash),
  - writes the **demo** and **full** packs separately to `EXPORT_DIR/<version>/` (`splitByTier`):
    `demo.json` (the demo half) and `mrak-full-<version>.json`, each with its SHA-256 and size in
    the response.

The game picks up the export on the next `pnpm dev` reload or build.

## Analysis (`GET /v1/analysis`)

- **Validation:** every issue of `validatePack` (schemas, references, demo → full, trees,
  mysteries, locale keys).
- **Flags:**
  - `flag-never-set`: read by a condition, but no `setFlag` in content and no `set_flag` in an Ink
    story sets it. Flags set by the engine show up here too; they are listed with their readers.
  - `flag-never-read`: set, but no condition reads it.
  - `flag-unused`: declared, but neither set nor read.
- **Unreachable:** an entity whose conditions require (not under `not`) a flag that is never set.
- **Graph:** quests, events, mysteries and pacts as nodes. Edges are "sets a flag that the other
  reads" (labelled with the flag) and direct references (`startQuest`, `triggerEvent`,
  `startMystery`, `quest`/`mysteryConcluded`/`pactSigned` conditions…).
- **Villagers:** each villager with their relationships (affinity), home, work and secrets.
- **Mysteries:** suspects, clues with their sources, and which clues support or refute which
  suspect.

## API

All routes are under `/v1`, carry a rate limit (`defineRoute`) and accept bodies up to 1 MB.

- `GET /schemas`
- `GET /ids`
- `GET /entries?collection=`
- `GET|PUT|DELETE /entries/:collection/:id`
- `POST /entries/:collection/:id/status`
- `GET /entries/:collection/:id/history`
- `GET /entries/:collection/:id/diff?from=&to=`
- `GET /analysis`
- `POST /import`
- `POST /export`

## Access

- **Production:** `ACCESS_TEAM_DOMAIN` + `ACCESS_AUD` are required. Every request must carry a
  valid Cloudflare Access JWT (`Cf-Access-Jwt-Assertion`, RS256, team JWKS, audience, expiry). Its
  email becomes the author of revisions. Without that configuration the server refuses to start in
  production.
- **Development:** without Access configuration only loopback clients are served (127.0.0.1,
  ::1), and the author is `local`.
- The studio-api port is published on `127.0.0.1` only (docker-compose) and is never on a public
  hostname. Run it behind Cloudflare Access + Tunnel, or a VPN.

## Tests

- **studio-api:**
  - import → create event → publish → export → the exported pack has the event and validates;
  - demo/full packs with hashes;
  - a flag read but never set is reported;
  - invalid body → 422;
  - reviewer ≠ editor;
  - diff;
  - non-loopback → 403;
  - Access JWT required in production mode.
- **studio-web:** typecheck and lint. Form generation and the condition editor are covered by the
  API contract.
