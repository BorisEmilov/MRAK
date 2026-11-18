# Store — purchases, entitlements and paid content

Business model: [monetization](../business/monetization.md) · Provider: [ADR 0010](../adr/0010-payments-provider.md) ·
Threat model controls C-27…C-31 ([threat model](../security/threat-model.md)).

## Rules

1. **Entitlements are the only source of truth** for "who owns what" (`entitlements` table:
   `userId, sku, source web|steam|ios|android, status active|revoked, orderId, purchasedAt,
refundedAt`). `collector` implies `full-game`.
2. **Access is granted only by a verified webhook**: Paddle signature (HMAC-SHA256 over
   `"<ts>:<raw body>"`, constant-time) with ±5 min timestamp, de-duplicated by event id
   (`payment_events` primary key, same transaction as the grant), then the transaction is
   **re-read from the Paddle API** (status `completed`, `custom_data.user_id`, price ids → skus).
   The browser's return from the checkout never grants anything.
3. **Refund** (approved full refund adjustment) revokes the order's entitlements. **Chargeback**
   revokes and blocks new purchases (`purchase_blocks`) until reviewed. Every grant, revoke,
   blocked checkout and checkout consent is written to the audit log (no PII).
4. **Paid content never ships in the public build** (below). The full pack is downloaded only with
   the `full-game` entitlement through a presigned R2 URL valid for 300 s.
5. **Progression is never sold** (CLAUDE.md pillar 3): skus are editions and content only.

## Flow

```
/buy/ (consent checkbox) ─POST /v1/store/checkout {sku, consent:true}─▶ API: verified account,
  not blocked, not owned, server price id → Paddle transaction (custom_data.user_id)
◀─ {url: https://mrak.game/buy/checkout/?_ptxn=txn_…}
/buy/checkout/ loads Paddle.js → overlay → successUrl /buy/thanks/ (polls GET /v1/store/entitlements)
Paddle ─POST /v1/store/webhook─▶ verify → dedupe → GET /transactions/:id → grant
Game: demo-end card → "I own it — download" → POST /v1/content/full → signed URL → fetch,
  size + SHA-256 + schema check → IndexedDB → checkpoint → reload → Continue (same save)
```

## API

| Route                           | Auth   | Limits                                           | Notes                                                                             |
| ------------------------------- | ------ | ------------------------------------------------ | --------------------------------------------------------------------------------- |
| `GET /v1/store/entitlements`    | bearer | authed-user                                      | the account's rows                                                                |
| `POST /v1/store/checkout`       | bearer | authed-user, checkout-user 5/h, checkout-ip 10/h | verified email; `consent: true` required; switch `purchases`                      |
| `POST /v1/store/webhook`        | —      | webhook-ip 300/min, body 64 KB, raw body         | always on (refunds must work when sales are off)                                  |
| `POST /v1/content/full`         | bearer | authed-user, content-url-user 30/day             | 403 `entitlement_required` without full-game                                      |
| `GET /v1/content/files/:name`   | signed | public-ip                                        | development/E2E stand-in for R2 (`FULL_PACK_LOCAL_DIR`, refused in production)    |
| `POST /v1/store/collector-name` | bearer | authed-user, collector-name-user 5/day           | collector only; format + word filter → `pending`; a person approves in the studio |

## Paid content

- Content entries carry `tier: demo|full`. `splitByTier` (`@mrak/content-schema`) moves full-tier
  array entries, single-entity files, full-tier nodes of demo trees and locale keys used only by
  full content into the `FullContentPack` (`packId: mrak-full`); the demo half validates on its own
  (validator: demo never depends on full).
- `apps/game/build/demo-plugin.ts` serves the demo half to every production build;
  `MRAK_FULL_BUILD=1` keeps everything (storefront builds such as Steam).
- **CI gate** `pnpm --filter @mrak/game check:demo` (part of `build`) fails when `dist/` contains the
  full-tier marker or any full-only locale key.
- `pnpm --filter @mrak/content-schema full-pack <dir>` writes `mrak-full-<version>.json` and prints
  its SHA-256 and size → upload to the private R2 bucket → set `FULL_PACK_PATH/VERSION/SHA256/BYTES`.
- The game merges the cached pack at boot (`mergeFullPack` + full validation; a pack that does not
  match the build is ignored and the demo runs). When the signed-in account no longer holds the
  entitlement, the cached pack is deleted (effective next start).
- Ink stories and maps have no tier today; when a full-only zone or story is added it gets the
  same treatment (zone `tier` → its map, stories referenced only by full content).

## Demo end

`progression-rules.demo.nights` (4): when `nights-survived` reaches it without the full pack, the
game autosaves and shows the demo-end card (value of the full game, buy on the website, download
when owned, keep playing). Nothing is lost: the download reloads the page and Continue resumes the
same save with the full content.

## Collector's edition

`collector` entitlement: soundtrack and artbook downloads (same signed-URL mechanism, to be
uploaded with the assets), villager name in the credits (`collector_names`, `pending` →
approved/rejected in the studio).

## Studio

`services/studio-api` `/sales` (HTML) and `/v1/sales/summary`: verified accounts, buyers, demo →
purchase conversion, sales by sku/source, refunds, pending collector names; `POST
/v1/collector-names/:userId` moderates. Reads the online database through `SALES_DATABASE_URL`
(restricted role). Internal only.

## Test mode

Paddle sandbox: `PADDLE_API_URL=https://sandbox-api.paddle.com`, sandbox API key, webhook secret
and price ids; landing `PUBLIC_PADDLE_CLIENT_TOKEN` (sandbox token) and `PUBLIC_PADDLE_ENV=sandbox`;
webhook destination `https://<api>/v1/store/webhook` with events `transaction.completed`,
`adjustment.created`, `adjustment.updated`. Test card 4242 4242 4242 4242.
