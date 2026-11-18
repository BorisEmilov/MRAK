# Runbook: abuse, attacks and runaway costs

Owner: on-call · Related: [threat model](../security/threat-model.md) (C-01 … C-05, C-11, C-24,
C-26, C-31, C-39), [ADR 0008](../adr/0008-cloudflare-edge.md), `infra/cloudflare/`,
`services/online-api/src/limits/`.

Every step below is reversible and needs **no deploy**. Write each action and its time in the
incident log.

## 0. Signals

| Signal                                                     | Where                                | Means                                        |
| ---------------------------------------------------------- | ------------------------------------ | -------------------------------------------- |
| `alert: "rate-limit-degraded"` / `"redis-error"`           | API logs                             | Redis down: auth answers 503, rest in memory |
| `alert: "email-budget"`, `level: 50 / 80 / 100`            | API logs                             | Daily email budget (`EMAIL_DAILY_CAP`) used  |
| Many `429` with `policy` in the body                       | API logs, Cloudflare analytics       | A limit is doing its job — check who         |
| "HTTP DDoS attack" email                                   | Cloudflare notification              | L7 attack being mitigated                    |
| "API tunnel unhealthy" email                               | Cloudflare notification              | Origin unreachable                           |
| Postgres connections ≈ instances × `DB_POOL_MAX`, CPU high | Database metrics                     | Load reaches the DB — act on steps 2–4       |
| Budget alert 50 % / 80 %                                   | Hosting, R2, email provider consoles | Costs growing faster than planned            |

## 1. Triage (5 minutes)

1. Which host and path? Cloudflare → Security → Events / Analytics, filter `api.mrak.game`.
2. Is it spread (botnet) or concentrated (few IPs/ASNs)? Note the top ASNs and countries.
3. Is the database healthy? `GET /health` latency, Postgres CPU and connections.
4. Which policy is firing? API logs: `error: "too_many_requests", policy: "<name>"`.

## 2. Edge first (cheapest: the request never reaches us)

1. **Concentrated source** → Cloudflare → Security → WAF → Tools: block the ASN/country/IP list
   for `api.mrak.game` only (never for the static sites). Expire the rule in 24 h.
2. **Spread L7 flood** → set security level to "I'm under attack" for the zone
   (`cloudflare_zone_setting.security_level = "under_attack"` or dashboard). Static sites keep
   working from cache; the game shows its offline mode for online features.
3. **One route abused** → tighten `edge_limits` in `infra/cloudflare/variables.tf`
   (e.g. `auth_per_min = 10`) and `terraform apply`, or edit the rule in the dashboard and copy
   the change back to Terraform afterwards.
4. Bots on sign-up despite Turnstile → in the Turnstile widget set "Managed" → "Interactive".

## 3. Emergency switches (seconds, no deploy)

State is the Redis hash `mrak:switches`; every instance re-reads it within 5 s.

```sh
redis-cli -u "$REDIS_URL" HSET mrak:switches registration off   # sign-ups → 503 feature_disabled
redis-cli -u "$REDIS_URL" HSET mrak:switches emails off         # no email leaves (verification included)
redis-cli -u "$REDIS_URL" HSET mrak:switches cloud-saves off    # progress/save writes → 503 (reads work)
redis-cli -u "$REDIS_URL" HSET mrak:switches telemetry off      # telemetry dropped
redis-cli -u "$REDIS_URL" HSET mrak:switches purchases off      # checkout → 503
redis-cli -u "$REDIS_URL" HGETALL mrak:switches                 # check
redis-cli -u "$REDIS_URL" HDEL mrak:switches registration       # back to the default (on)
```

If Redis itself is down, set `KILL_SWITCHES=registration,emails,…` in the service environment
and restart the instances (configuration only, same image).

Which switch for which incident:

| Incident                     | Switches                       |
| ---------------------------- | ------------------------------ |
| Sign-up bot wave             | `registration`                 |
| Email bombing / email budget | `emails` (then `registration`) |
| Storage growth / save abuse  | `cloud-saves`                  |
| Telemetry flood              | `telemetry`                    |
| Card testing / fraud spike   | `purchases`                    |

## 4. Application limits (minutes, restart only)

Limits live in `services/online-api/src/limits/policies.ts`. Override per environment without a
build: `RATE_LIMITS='{"login-ip":{"limit":10},"register-ip":{"limit":1}}'` and restart. Defaults:

| Policy                     | Limit             | Key        | Redis down |
| -------------------------- | ----------------- | ---------- | ---------- |
| `login-ip-email`           | 5 / min           | IP + email | reject     |
| `login-ip`                 | 20 / min          | IP         | reject     |
| `register-ip`              | 3 / hour          | IP         | reject     |
| `register-ip-day`          | 5 / day           | IP         | reject     |
| `email-send-email`         | 3 / hour          | email      | reject     |
| `email-send-ip`            | 10 / hour         | IP         | reject     |
| `refresh-session`          | 30 / hour         | session    | reject     |
| `refresh-ip`               | 60 / min          | IP         | reject     |
| `auth-token-ip`            | 20 / 15 min       | IP         | reject     |
| `sensitive-user`           | 5 / 15 min        | user       | reject     |
| `save-upload-user`         | 30 / hour         | user       | memory     |
| `achievements-unlock-user` | 120 / hour        | user       | memory     |
| `progress-write-user`      | 120 / hour        | user       | memory     |
| `checkout-user`            | 10 / hour         | user       | reject     |
| `telemetry-install`        | 60 batches / hour | install id | memory     |
| `authed-user`              | 120 / min         | user       | memory     |
| `public-ip`, `seasonal-ip` | 120, 30 / min     | IP         | memory     |

Fixed protections (no tuning needed): body 16 KB (cloud saves 2 MB), anything > 2 MB refused
before parsing, compressed bodies refused (415), request timeout 10 s, SQL statement timeout
5 s, DB pool 10 per instance, Redis commands 500 ms, Turnstile 5 s, HIBP 2 s, ≤ 10 active
sessions per account, emails ≤ 3/h and 10/day per recipient, unverified accounts deleted after
7 days.

## 5. Redis outage

1. Expected behaviour: auth routes answer `503 unavailable` (fail closed); other routes keep
   per-instance memory limits (looser by the number of instances, never unlimited); switches
   keep their last known state.
2. Restore Redis (managed service console). No data needs recovering: counters are ephemeral.
3. Verify: `redis-cli -u "$REDIS_URL" PING`, then a login works and the alert stops.

## 6. Cost runaway

1. Identify the line item in the provider console (email, R2 operations, hosting, logs).
2. Email → `emails` off; check `email-budget` alerts and the abused route.
3. R2 → paid downloads only via 5-minute presigned URLs; find the account with many downloads
   in the logs and revoke its sessions in the database
   (`UPDATE sessions SET revoked_at = now() WHERE user_id = '…'`).
4. Hosting → the autoscaling ceiling is **4 instances**; raising it is a deliberate decision
   with a cost estimate, never automatic.
5. Logs → raise `LOG_LEVEL` to `warn` temporarily.

## 7. Recovery and follow-up

1. Remove temporary WAF blocks and switches in reverse order; watch 15 minutes after each.
2. Return security level to "medium".
3. Postmortem within 48 h: timeline, which control stopped it, what reached the DB, what to
   tighten permanently (Terraform/policies PR + test).

## Regular checks (monthly)

- Budget alerts at 50 % / 80 % exist in the hosting, R2 and email consoles.
- `terraform plan` in `infra/cloudflare` shows no drift.
- Run `tests/load/abuse.js` against staging (`k6 run -e BASE_URL=… tests/load/abuse.js`); all
  thresholds green, Postgres connections ≤ instances × `DB_POOL_MAX`.
