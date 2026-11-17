# Seasonal events (live content)

Status: Draft v0.1 · MVP: ❌ (infrastructure stub only) · Package: `packages/core/seasonal` + `services/online-api` · Back to [GDD](../GDD.md) · [index](README.md) · festivals: [festivals](../lore/festivals.md)

## Purpose

Real-world festival dates (Kukeri in February, Enyovden on 24 June, Zadushnitsa…) trigger special
events, and new content packs arrive **without a client update**.

## Data

- **Content pack** = versioned bundle of data (JSON, ink JSON, atlases) validated by
  `packages/content-schema`; **no code**.
- `manifest`: `{ packId, version, minClientVersion, window: { start, end } (UTC, Gregorian),
entitlement: free|<sku>, files[]: { path, sha256, size }, signature }`.
- Client state: installed packs, active windows, local cache.

## Rules

1. Packs are data only — the client never executes downloaded code (security).
2. Manifests are **signed** (Ed25519) by the studio; the client verifies signature and file hashes
   before use. Unsigned or mismatched packs are discarded.
3. Paid packs are served only with a valid **entitlement** (server-side check); free seasonal
   events are free for everyone with an account; guests receive only demo-scoped events.
4. Activation: when the real date is inside a window, the next in-game day offers the event
   (never interrupts a night).
5. Offline: packs already cached remain usable within their window; no new downloads.
6. Size limit per pack: 20 MB; per file 2 MB (asset rule).

## Initial formulas

- Poll for manifests at launch and every 6 hours while running (rate-limited server-side).

## Events

- **Emits:** `seasonal/packInstalled`, `seasonal/windowOpened`, `seasonal/eventOffered`, `seasonal/packRejected { reason }`.
- **Consumes:** `time/dayStarted`, network results.

## Edge cases

- Client clock manipulation → the server provides the authoritative date for activation of
  online-only rewards; offline activation uses local time (acceptable: no paid value at stake).
- A pack requires a newer client → hidden with "update to play".

## Test ideas

- Signature verification rejects a pack with one modified byte.
- Schema validation rejects packs containing unknown fields or code-like entries.
- Window boundaries at UTC start/end.
- Paid pack download without entitlement returns 403 (online-api Supertest).

## Implementation (v1)

- Server: `GET /v1/seasonal` → `{ date, active[] }` from the server clock (UTC); calendar in
  `services/online-api/src/routes/seasonal.ts`, OpenAPI generated in `services/online-api/openapi.json`.
- Client: `GameHost.syncSeasons()` once per session (local date when offline); every id is
  re-checked against the content windows (`seasonalActive`) before `activateSeasonal { event,
date }`, which applies its effects once per season (never at night; retried at dawn). Rewards:
  `legacy` to the Bloodline profile and a cosmetic title (`cosmeticKey`), each once.
- Content packs: `ContentPackFile` + `applyContentPacks` in `@mrak/content-schema`;
  `apps/game/src/host/packs.ts` fetches the CDN `index.json`, verifies size, SHA-256 and the
  Ed25519 signature, parses strictly, and `loadContentDatabase(packs)` keeps the packs only if the
  merged content validates. Not done: an offline cache of packs, entitlements for paid packs.
- Cadence: [live-content](../business/live-content.md).
