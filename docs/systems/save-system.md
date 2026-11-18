# Save system

Status: Draft v0.2 · MVP: ✅ (local + cloud) · Package: `packages/core/save` + `services/online-api` · Back to [GDD](../GDD.md) · [index](README.md)

## Purpose

Persist WorldState and the Profile safely: local saves for guests (demo), cloud saves for
accounts, versioned and migratable.

## Data

- **Save file:** `{ schemaVersion, contentVersion, createdAt, slotId, checksum, state: WorldState }` (JSON, compressed).
- **Profile:** Bloodline Tree, achievements, settings, Cycle count.
- Local storage: **IndexedDB** (not localStorage — size and structure). Never tokens in storage.
- Cloud: `online-api` `GET /v1/saves`, `GET|PUT|DELETE /v1/saves/:slot` (table `cloud_saves`);
  account progress `/v1/progress`.

## Rules

1. **Autosave** (see _Local saves_ below) at dawn, dusk, zone change, after recorded decisions,
   before rituals/exorcisms and every 5 minutes of playtime. Manual and quick saves only during
   the day (dawn/day phases — no save-scumming nights, roguelite tension). 3 manual slots, 1 quick
   slot, a rotation of the 3 latest autosaves.
2. **Migrations:** `migrate(vN → vN+1)` pure functions, chained; a save is never loaded without
   passing schema validation (Zod) after migration.
3. **Cloud (local-first):** every save commits to IndexedDB first. Manual slots and autosaves
   (never quick saves) are queued in a persistent outbox (`mrak-cloud` DB) and uploaded in the
   background with exponential backoff + jitter (2 s … 5 min), honouring 429 `Retry-After`;
   flushes on save, sign-in, reconnect and startup. Every upload names the cloud version it
   replaces (`If-Match: "v<n>"`, or `If-None-Match: *` for a new slot); the server answers 412 with
   its `current` version on divergence. A conflict shows both saves (thumbnail, in-game date,
   zone, playtime, real save time) and the player keeps one. The cloud never replaces a local
   save without that choice: downloading into a manual slot holding a different save is also a
   conflict (autosaves rotate, so they download freely). Status icons: synced, pending, offline,
   conflict (plus "this device only" when signed out). Quotas: `slot-1..3` keep 1 version, `auto`
   keeps 3; payload ≤ 1.5 MB, body ≤ 2 MB; SHA-256 checked; `format` must be `mrak-save`.
4. **Security** ([threat model](../security/threat-model.md)): server validates size (≤ 1 MB
   compressed) and schema; saves are untrusted user data — never executed, never used to grant
   entitlements. Endpoints are authenticated, rate-limited and body-size-limited.
5. Guests: local only. After signing in on a device with guest progress the game offers once per
   account to upload it (saves and account progress: achievements, Bloodline, stats); slots the
   account already holds differently become conflicts — nothing is lost. "Upload this device's
   progress" in the account panel repeats it. Invitations to create an account appear at the end
   of the prologue and with the first achievement, on the menu only, with "Don't show again".
6. GDPR: saves and profile included in account export and deleted with the account.

## Initial formulas

- Rate limit: `PUT /saves/:slot` 30 per hour per account.
- Checksum: SHA-256 (hex) of the exact serialized save text, the canonical form produced by
  `serializeSave` (integrity against corruption, **not** anti-cheat).
- Autosave interval: 5 min of playtime; autosave rotation: 3; manual/quick slots keep 1 backup.

## Events

- **Emits:** `save/written`, `save/loaded`, `save/migrated { from, to }`, `save/conflict`, `save/failed`.
- **Consumes:** `time/dawn`, `time/duskReached`, `ui/manualSave`.

## Edge cases

- IndexedDB unavailable (private mode) → warn; keep an in-memory save and offer file export.
- Corrupt save (checksum mismatch, invalid JSON, invalid schema) → never crash; the player is
  offered the newest intact fallback (backup of the same slot, then autosaves, newest first).
- Save from a newer client version → refuse with a clear message.

## Implementation (core v1)

- `packages/core/src/save/save.ts`. Current format **v3** (v2 + `meta.generation`). v2:
  `{ format: "mrak-save", version: 2, savedAt, meta: { gameDate (Julian y/m/d + minute), zone,
playtimeMs, contentVersion, contentHash? }, rng: { seed, streams }, state: WorldState }`.
- **v1** (prototype format): flat `world` object, flags as a list, one RNG state, playtime in
  seconds. `MIGRATIONS[1]` upgrades it to v2 (the single RNG state becomes the `director`
  stream). Migrations run step by step, then the result is validated with Zod; saves from a newer
  version, invalid JSON, invalid data or files over 4 MB are rejected with `SaveError`.
- Loading reconciles the state with current content and reports non-fatal warnings
  (migration performed, content version changed).

## Local saves (app layer, v0.2)

Code: `apps/game/src/storage/` (SaveStore, emergency backup, CloudSync, persistence) and
`packages/core/src/save/` (format, checksum, export envelope, autosave policy).

- **SaveStore** (IndexedDB through `idb`, DB `mrak-saves` v1). Stores: `data` (id → save text),
  `entries` (id → metadata: slot, kind, reason, savedAt, gameDate, zone, generation, playtimeMs,
  contentVersion, checksum, bytes, thumbnail) and `heads` (slot → ordered list of entry ids,
  newest first). Slots: `slot-1..3` (manual), `quick`, `auto`. Retention: auto 3, manual/quick 2
  (current + backup used only for recovery). Without IndexedDB a memory backend is used and the
  UI warns that saves will not survive the page.
- **Atomic write** = `stage` then `commit`. Stage writes data + entry under a fresh id in one
  transaction; commit rewrites the slot's head (new id first) and prunes ids beyond retention in a
  second transaction. A crash between the two leaves the head on the previous version; staged
  entries that no head references are orphans and are deleted when the store opens.
- **Reading** verifies the checksum before handing the text to `deserializeSave`.
- **Autosave policy** (core, pure): consumes core events after every tick/command — `time/dawn`,
  `time/duskReached`, `world/zoneEntered`, `state/decisionRecorded` — plus explicit checkpoints
  (`ritual`, requested by the host before a ritual/exorcism) and the 5-minute playtime interval.
  Several triggers in one tick produce one save; writes are single-flight (a request during a
  write runs once after it).
- **Closing the page:** on `visibilitychange → hidden` and `pagehide` the host starts an async
  autosave (`suspend`) and writes a synchronous **emergency backup** to `localStorage`
  (`mrak.emergency.v1`: entry + text + checksum). On boot the backup is verified and, if newer than
  the newest autosave, committed into the autosave rotation, then removed. Quota errors are ignored
  (the async autosave is the primary path).
- **Persistent storage:** on the first new/continued game the app calls
  `navigator.storage.persist()`; when denied (or unsupported) the load screen recommends exporting
  a backup file.
- **Export/import:** `.mrak` file = JSON envelope `{ format: "mrak-export", version: 1,
exportedAt, checksum, save }` where `save` is the serialized save text. Import verifies size
  (≤ 4 MB), envelope, checksum, migration and schema before storing it in the chosen manual slot.
- **Load screen:** thumbnail (JPEG ≈ 192×108 captured from the renderer), in-game date and time,
  zone, generation, playtime, real save time, slot/autosave reason.
- **CloudSync** (`push`, `status`): `NullCloudSync` offline builds, `HttpCloudSync`
  (`storage/cloud-sync.ts`) online: queue, retries, conflicts (`resolve`), `download`,
  `uploadLocal`. SaveStore calls `push` after each commit, fire-and-forget; failures never affect
  local saves. HTTP: `packages/api-client` (one refresh in flight, one retry on 401, clean
  sign-out when the refresh fails).
- **Save format v3:** adds `meta.generation` (world stat `generation`, default 1). `MIGRATIONS[2]`
  derives it from the saved stats.

## Test ideas

- Migration chain from v1 to latest on fixture saves; result validates.
- Round-trip compress/decompress equals original.
- API: oversized body ⇒ 413; wrong schema ⇒ 400; no auth ⇒ 401; rate limit ⇒ 429.
- Conflict detection when `baseRevision` is stale.
- Manual save at night is rejected.
- Atomic write: staged-but-uncommitted version is invisible and cleaned up; previous stays loadable.
- Corrupt data (checksum mismatch) → fallback offered; autosave rotation keeps 3.
- Emergency backup newer than the newest autosave is absorbed on boot.
