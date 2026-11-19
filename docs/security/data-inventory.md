# Personal data inventory (GDPR record of processing)

Controller: the MRAK studio. This is the engineering basis for the Article 30 record and the
privacy notice; legal review is required before launch. Principles: data minimisation (collect
nothing a feature does not need), guests send nothing personal to the server
([ADR 0009](../adr/0009-guest-and-account.md)), export and deletion for every account.

Legal bases (Art. 6(1)): **(b)** contract (providing the account and purchases), **(c)** legal
obligation (tax/accounting), **(f)** legitimate interest (security, fraud prevention), **(a)**
consent (optional telemetry).

| Data                                                                                            | Where                                          | Purpose                                          | Basis                | Retention                                                           | Access                                      | Export              | Deleted with account                   |
| ----------------------------------------------------------------------------------------------- | ---------------------------------------------- | ------------------------------------------------ | -------------------- | ------------------------------------------------------------------- | ------------------------------------------- | ------------------- | -------------------------------------- |
| Email address (normalized)                                                                      | Postgres `users`                               | Login identifier, verification, security notices | b                    | Life of account; unverified accounts 7 days                         | API; support via audited query              | Yes                 | Yes (hard delete after 7-day grace)    |
| Password hash (Argon2id)                                                                        | Postgres `users`                               | Authentication                                   | b                    | Life of account                                                     | API only                                    | No (security)       | Yes                                    |
| Display name (optional, 3–24 chars)                                                             | Postgres `users`                               | Shown to the player only (no public profiles)    | b                    | Life of account                                                     | API                                         | Yes                 | Yes                                    |
| Refresh token hashes, session metadata (created, last used, user-agent family, country)         | Postgres `sessions`                            | Session security, "sign out everywhere"          | b, f                 | Until revoked/expired + 30 days                                     | API; user sees own sessions                 | Yes                 | Yes                                    |
| Email verification / reset token hashes                                                         | Postgres                                       | Verify address, recover account                  | b                    | Until used or expired (24 h / 30 min)                               | API only                                    | No                  | Yes                                    |
| IP address (full)                                                                               | Redis rate-limit keys; Cloudflare              | Abuse prevention, rate limiting                  | f                    | Redis: window length (≤ 1 h); Cloudflare logs per plan (≤ 30 days)  | Automated; ops via Cloudflare console (MFA) | No                  | Expires                                |
| IP address (truncated /24 or /48) in logs                                                       | App logs                                       | Incident investigation                           | f                    | 30 days                                                             | Ops (MFA)                                   | No                  | Expires                                |
| Security audit events (login, reset, token reuse, email change, deletion, purchase)             | Postgres `audit_log`                           | Fraud and takeover investigation, disputes       | f, c                 | 1 year, then deleted; actor id pseudonymized after account deletion | Security/ops                                | Yes (own events)    | Pseudonymized                          |
| Cloud saves (game state, no personal data by design)                                            | Postgres `saves`                               | Sync progress across devices                     | b                    | Life of account                                                     | API (owner only)                            | Yes                 | Yes                                    |
| Account progress (achievements, Bloodline, Legacy, stats)                                       | Postgres `account_progress`                    | Never lose progress; The Cycle                   | b                    | Life of account                                                     | API (owner only)                            | Yes                 | Yes                                    |
| Entitlements                                                                                    | Postgres `entitlements`                        | Deliver purchased content                        | b                    | Life of account                                                     | API                                         | Yes                 | Yes                                    |
| Orders (provider order id, product, amount, currency, country, status, refund/chargeback flags) | Postgres `orders`                              | Fulfilment, refunds, disputes, tax evidence      | b, c                 | 10 years (accounting) — pseudonymized after account deletion        | Finance/ops                                 | Yes                 | Pseudonymized, kept                    |
| Payment details (card, billing address, tax id)                                                 | **Payment provider only** (Merchant of Record) | Payment, fraud screening, invoicing              | provider's own basis | Provider's policy                                                   | Provider                                    | Via provider        | Via provider request                   |
| Email delivery records (address, template, status)                                              | Email provider                                 | Deliverability, bounce handling                  | b, f                 | Provider retention set to ≤ 30 days                                 | Ops (MFA)                                   | No                  | Request to provider                    |
| Download log (account id, content id, time, truncated IP)                                       | Postgres `downloads`                           | Quotas, link-sharing detection                   | f                    | 90 days                                                             | Ops                                         | Yes                 | Yes                                    |
| Telemetry (random install id, game events, build, coarse platform)                              | Postgres/warehouse `telemetry`                 | Balancing and crash diagnosis                    | a                    | 90 days                                                             | Developers (aggregates)                     | Yes (by install id) | Yes (install id unlinked from account) |
| Bug reports (text the player writes, game version, platform; save + seed only with consent)     | Postgres `bug_reports`                         | Reproduce and fix bugs                           | a                    | 90 days                                                             | Developers                                  | No (no identifier)  | Not linkable (no account or id)        |
| Turnstile tokens                                                                                | Transient                                      | Bot detection                                    | f                    | Not stored                                                          | —                                           | —                   | —                                      |
| Guest data (local saves, guest profile, progress outbox)                                        | **Player's browser only**                      | Play without an account                          | —                    | Until the player clears it                                          | Player                                      | Save export ✅      | n/a (never on server)                  |

Never collected: real name, birth date, phone, precise location, contacts, card numbers,
government ids, free-text chat.

Processors (DPA signed before launch; status in [backlog](../BACKLOG.md)):

| Processor                   | What                                                                                              | Region / transfer basis                                | DPA                         |
| --------------------------- | ------------------------------------------------------------------------------------------------- | ------------------------------------------------------ | --------------------------- |
| Render                      | API hosting, application logs (7 days) ([ADR 0012](../adr/0012-hosting-free-tier.md))             | Frankfurt (EU); US company: SCCs + EU-US DPF           | Render DPA (self-serve)     |
| Neon                        | PostgreSQL (accounts, saves, purchases, telemetry, bug reports)                                   | AWS `eu-central-1` (Frankfurt); US company: SCCs + DPF | Neon DPA (self-serve)       |
| Upstash                     | Redis: rate-limit counters (keyed hashes, no IPs or emails), switches                             | `eu-central-1` (Frankfurt); SCCs                       | Upstash DPA (self-serve)    |
| Sentry                      | Server error reports (stack traces; no request, user, headers or bodies, C-47)                    | EU region (Frankfurt); US company: SCCs + DPF          | Sentry DPA (self-serve)     |
| GitHub                      | CI only: encrypted backups pass through jobs, never stored as artifacts                           | —                                                      | GitHub DPA                  |
| Cloudflare                  | Edge, WAF, Pages + `/api` Function, R2 (WEUR: paid content, encrypted backups), Turnstile, Access | Global edge; SCCs + EU Data Localization optional      | Cloudflare DPA (self-serve) |
| Email provider (to choose)  | Transactional email                                                                               | EU region required                                     | Before enabling `emails`    |
| Paddle (merchant of record) | Checkout, payments, tax, invoices; partly an independent controller                               | UK/EU; UK adequacy + SCCs                              | Paddle DPA                  |
| Have I Been Pwned           | Only a 5-character SHA-1 prefix (k-anonymity), no personal data                                   | —                                                      | Not needed                  |

International transfers: providers outside the EEA only under SCCs/adequacy; recorded per
processor.

Data subject rights: export (`GET /v1/account/export`, JSON, rate-limited 1/day), rectification
(email/display name with re-auth, C-36), erasure (C-37), objection to telemetry (toggle, C-26).
Breach notification: 72 h to the supervisory authority — [security incident runbook](../runbooks/security-incident.md).

Retention enforcement: unverified accounts deleted after 7 days and unconfirmed newsletter
addresses after 7 days (hourly jobs); audit log purged after 1 year (hourly job); application
logs 7 days (Render); encrypted database dumps 30 days (R2 lifecycle). A deleted account
can reappear in a backup until it expires, and is deleted again after any restore
([restore runbook](../runbooks/restore.md)).

Verification: SEC-DEL-37 (deletion cascade), SEC-LOG-34 (no full emails in logs), SEC-TEL-26 (no
personal fields in telemetry schema), export test planned with the account routes.
