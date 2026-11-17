# ADR 0010 — Payments through a Merchant of Record

- Status: proposed (provider to be chosen against the criteria below)
- Date: 2026-11-17
- Back to [threat model](../security/threat-model.md) · controls C-27, C-28, C-29, C-30

## Context

The full game and paid content are sold worldwide to individuals. EU VAT (OSS), sales taxes,
invoicing, card fraud and chargebacks are costly for a small studio. Card data must never touch
our systems.

## Decision

- Use a **Merchant of Record** with hosted checkout (e.g. Paddle or Lemon Squeezy; Stripe Checkout
  with Stripe Tax is the fallback if MoR is not viable). Selection criteria: MoR for EU VAT,
  hosted checkout + 3-D Secure, fraud screening, signed webhooks with timestamps and event ids,
  an API to fetch orders, refund/dispute webhooks, DPA available.
- **Checkout:** the API creates a checkout session for a server-side product id (price never
  from the client), tied to the verified account id; velocity limits 5/h per account, 10/h per IP.
- **Fulfilment only via webhooks:** verify signature over the raw body (constant time), timestamp
  ±5 min, dedupe by event id (unique row), then **fetch the order from the provider API** and
  grant the entitlement in one transaction. The client's success redirect only shows status.
- **Refunds and chargebacks:** revoke the entitlement, flag the account, block new purchases until
  reviewed; paid downloads stop (presign refused).
- We store provider ids and order metadata only (see [data inventory](../security/data-inventory.md));
  PCI scope is SAQ A (hosted page).
- Progression is never sold (CLAUDE.md pillar 3): products are the full game and content packs
  only.

## Consequences

- ✔ No card data, VAT handled by the provider, built-in fraud tools.
- ✔ Forged or replayed webhooks cannot grant content.
- ✘ Higher fee per transaction than a pure processor.
- ✘ Entitlement delay of seconds after payment (UI polls the entitlement status).

## Alternatives considered

- Raw payment processor + own tax handling: cheapest fees, highest compliance burden; rejected for v1.
- Selling only through storefronts (Steam/itch): kept for desktop builds; the browser game needs
  its own checkout.
