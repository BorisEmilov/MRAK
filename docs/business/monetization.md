# Monetization — fair premium

Back to [business](README.md) · Product split: [GDD §12](../GDD.md#12-product-demo-vs-full-game) ·
Implementation: [store](../systems/store.md) · Provider decision: [ADR 0010](../adr/0010-payments-provider.md)

## Model

| Product                  | What it is                                                                              | Indicative price (EUR, VAT incl.) |
| ------------------------ | --------------------------------------------------------------------------------------- | --------------------------------- |
| **Free demo**            | Prologue + Unclean Days nights 1–4 in the browser, no account needed; saves carry over  | 0                                 |
| **Full game**            | One-time purchase: all callings, trees, zones, festivals, demons, the Endless Chronicle | 19.99 (launch −15 %)              |
| **Collector's edition**  | Full game + soundtrack + digital artbook + a named villager in the credits (moderated)  | 29.99                             |
| **Expansions (DLC)**     | Content only: new callings with their trees, regions, festivals, generations of story   | 6.99–12.99 each                   |
| **Cosmetics (optional)** | Portraits, frames, lantern styles — no gameplay effect                                  | 1.99–3.99                         |

Prices are a working hypothesis for comparable narrative indie RPGs (EUR 15–25); they are fixed in
the provider dashboard, never in code or on the client, and confirmed before launch.

### Golden rule (pillar 3)

**Progression is never sold**: no Revelation, talents, Legacy, attributes, boosts, skips, loot or
any advantage — not in the full game, not in DLC, not as cosmetics. Paid expansions add _content_
(callings and their trees, regions, festivals, story generations). Cosmetics are acceptable only
when they change nothing in play. No loot boxes, no premium currency, no ads, no energy timers.

## Plans

- **Early access (web).** The full game sells at the early-access price while chapters ship; every
  buyer gets every chapter and the 1.0 release at no extra cost. The demo stays free. Roadmap and
  "what is missing" are stated on the store page before purchase.
- **Steam.** A desktop build (`MRAK_FULL_BUILD=1`: Steam is the storefront and the entitlement)
  with Steam's own demo. Linking a MRAK account records a `source: steam` entitlement from a
  verified Steam ownership check, so cloud saves and the web version work for Steam buyers.
  Steam takes 30 % (25 % after USD 10 M) and handles VAT and refunds (2 h / 14 days).
- **Mobile.** Free download with the demo; the full game as one non-consumable in-app purchase
  (Apple/Google are mandatory for digital content: 15 % small-business rate). Receipts are verified
  server-side and recorded as `source: ios|android` entitlements. Same golden rule: no
  consumables that touch progression.

## Provider comparison (web)

| Criterion           | **Paddle (merchant of record)**                                                   | **Stripe + Stripe Tax**                                                                  |
| ------------------- | --------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| Fees                | 5 % + USD 0.50 per transaction, all-in (tax, fraud, chargeback handling included) | ~1.5 % + EUR 0.25 (EEA cards) to 3.25 % (intl.) + 0.5 % Stripe Tax + EUR 15/dispute      |
| EU VAT              | Paddle is the seller: it registers, collects, files and remits VAT/OSS worldwide  | We are the seller: Stripe Tax calculates, **we** register (OSS + non-EU), file and remit |
| Invoices            | Issued by Paddle to the buyer                                                     | Ours to issue                                                                            |
| Refunds             | Buyer-facing refund handling, refund link in receipts; webhooks on approval       | Our process; API/webhooks                                                                |
| Fraud / chargebacks | Paddle screens fraud and fights/absorbs chargebacks as the seller                 | Radar (extra for advanced rules); we fight disputes and pay dispute fees                 |
| Compliance burden   | Minimal (SAQ A, no tax registrations)                                             | High for a small studio (multi-jurisdiction tax, bookkeeping)                            |
| Checkout            | Hosted overlay (Paddle.js) on our page; 3-D Secure                                | Hosted Checkout page; 3-D Secure                                                         |

On a EUR 19.99 sale Paddle keeps about EUR 1.46; Stripe about EUR 0.55–0.90 plus the cost of tax
compliance (accountant, OSS filings, non-EU registrations) and dispute work.

**Recommendation: Paddle.** For a small studio selling a single low-price product worldwide, the
merchant of record removes the most expensive risks — tax registrations and filings in every
market, invoicing, chargebacks and fraud liability — for roughly one euro per sale. Stripe becomes
attractive only at volumes where the fee difference pays for a finance function; the integration
is isolated behind `PaymentProvider` (`services/online-api/src/store/`) so switching later is a
provider class, not a redesign.

## Revenue guardrails

- Kill switch `purchases` stops new checkouts without a deploy; webhooks keep working so refunds
  are always honoured.
- Conversion demo → purchase, sales and refunds are visible in the studio sales panel
  (`services/studio-api`, `/sales`).
