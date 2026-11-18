# Runbook — security incident

Use this for a suspected breach: leaked keys or secrets, account takeover at scale, data exposure,
a malicious dependency, or forged purchases. Abuse and cost incidents (bots, floods, runaway
email) go to [abuse](abuse.md). Background: [threat model](../security/threat-model.md).

**Roles.** The _incident lead_ decides and keeps the timeline. The _operator_ runs the commands.
The _comms_ person talks to users and the authority. On a small team one person can hold several
roles, but write each decision down with its UTC time in the incident log
(`docs/security/incidents/<date>.md`, private repository).

## 0. First 15 minutes

1. Open the incident log and note the time, who detected it, the signal and its first scope.
2. Preserve evidence before changing anything: export the audit log rows
   (`SELECT * FROM audit_log WHERE timestamp > now() - interval '7 days'`), the app logs and the
   Cloudflare logs for the window. Take a database snapshot.
3. Contain with the steps below. Prefer switches and key rotation over redeploys.

## 1. Switch services off (no deploy)

Every instance reads the switches within 5 s:

```sh
redis-cli -u "$REDIS_URL" HSET mrak:switches registration off
redis-cli -u "$REDIS_URL" HSET mrak:switches purchases off     # webhooks stay on: refunds still work
redis-cli -u "$REDIS_URL" HSET mrak:switches cloud-saves off
redis-cli -u "$REDIS_URL" HSET mrak:switches emails off        # only if mail itself is abused
redis-cli -u "$REDIS_URL" HGETALL mrak:switches                # verify
```

To take the whole API offline, use the Cloudflare maintenance rule (edge) as described in
[abuse](abuse.md). The game keeps working offline with local saves.

## 2. Revoke all sessions

Access tokens are checked against their session on every request, so deleting sessions logs
everybody out within one request. Refresh tokens cascade.

```sql
-- every account
DELETE FROM sessions;
-- or only the affected accounts
DELETE FROM sessions WHERE user_id = ANY($1::uuid[]);
```

Tell users to sign in again. If password hashes may have leaked, also force a reset: set the
affected `password_hash` values to an unusable value and send reset emails in batches. The email
budget applies, so raise `EMAIL_DAILY_CAP` deliberately.

## 3. Rotate JWT signing keys (no downtime)

`AUTH_JWT_KEYS` is a JSON array: the **first** key signs, **all** keys verify (`kid`).

1. Generate a new key: `pnpm --filter @mrak/online-api keygen`. Store it only in the secret store.
2. Deploy `AUTH_JWT_KEYS=[new, old]`. New tokens are signed with the new key and live tokens still
   verify.
3. Wait at least 10 minutes (the access token lifetime). If the old key **leaked**, skip the wait:
   remove it at once and do step 2 of this runbook, because tokens forged with it must stop working.
4. Deploy `AUTH_JWT_KEYS=[new]`.
5. Verify: `GET /.well-known/jwks.json` lists only the new `kid`, and login, refresh and `/v1/me`
   work.

**Drill (staging, quarterly and before launch).** Run
`node tests/security/rotation-drill.mjs` with a staging test account while steps 1–4 are applied.
The drill passes when the script reports 0 failures. Record the result in the
[test report](../security/test-report.md).

## 4. Rotate other secrets

Rotate whatever may be exposed, newest first:

| Secret                                      | How                                                                            |
| ------------------------------------------- | ------------------------------------------------------------------------------ |
| `AUTH_SECRET`                               | New value. IP-hash salts and keyed hashes change, so rate-limit keys reset.    |
| `PADDLE_API_KEY`, `PADDLE_WEBHOOK_SECRET`   | Paddle dashboard → new key/secret → deploy → revoke the old one.               |
| `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY` | New R2 token → deploy → revoke the old one. Live signed URLs die within 5 min. |
| `TURNSTILE_SECRET`                          | Rotate in Cloudflare → deploy.                                                 |
| Database / Redis passwords                  | `ALTER ROLE … PASSWORD` / Redis ACL → deploy → drop old credentials.           |
| Content pack signing key                    | New Ed25519 key, re-sign packs, ship the new public key in the game build.     |

## 5. Eradicate and recover

- Find and fix the root cause: patch, revert, or pin the dependency. Add a test that fails without
  the fix.
- Forged purchases: revoke the entitlements (`UPDATE entitlements SET status='revoked' …`) and
  reconcile them with the Paddle orders.
- Turn the switches back on one at a time and watch errors and the audit log.

## 6. Communicate

- **Users.** Email the affected accounts and post on the site. Say what happened, which data was
  involved, what we did, and what they should do (sign in again, change reused passwords). Never
  include tokens or links that sign them in.
- **Supervisory authority (GDPR Art. 33).** For a personal-data breach that is likely to put
  people's rights and freedoms at risk, notify the lead supervisory authority **within 72 hours**
  of becoming aware of it. Include its nature, the categories and approximate number of people and
  records, likely consequences, the measures taken, and a contact. If not all facts are known,
  notify in phases. Document every breach, even ones that are not notified (Art. 33(5)).
- **Data subjects (Art. 34).** Inform them without undue delay when the risk is high.
- **Merchant of record.** If payment data or webhooks are involved, tell Paddle's security
  contact.
- **Researchers.** Acknowledge reports to `security@mrak.game`
  (`/.well-known/security.txt`) within 3 working days.

## 7. Close

Within 5 working days, write a blameless postmortem: timeline, root cause, what worked, and the
actions with owners. Update the threat model and the [test report](../security/test-report.md),
and add a regression test.
