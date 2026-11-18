# Runbook — database restore

Cloud SQL keeps daily backups (production: 30, staging: 7) and transaction logs for point-in-time
recovery (production: 7 days). Restores always go to a **new instance**: the damaged one is kept
until the restore is verified. Platform: [ADR 0011](../adr/0011-hosting-gcp.md).

## Monthly drill (automated, staging)

`.github/workflows/restore-drill.yml` runs on the 3rd of each month at 05:00 UTC:

1. Clone the staging instance to one hour ago (PITR).
2. Check the clone with `infra/gcp/verify-restore.sh`: all migrations applied, none failed, core
   tables readable, newest audit row less than 48 h old.
3. Delete the clone.

The job summary records the restore time. Copy the result into the
[test report](../security/test-report.md). A failed drill is an incident.

## Real restore

1. **Decide the target time**: just before the damage. The audit log and the app logs show when
   it started. Note it in UTC.
2. **Stop writes** if the damage is ongoing:
   `redis-cli HSET mrak:switches cloud-saves off purchases off registration off`, or put the API
   behind maintenance at the edge ([abuse](abuse.md)).
3. **Clone to the point in time:**

   ```sh
   gcloud sql instances clone mrak-production mrak-production-restore \
     --point-in-time 2026-11-18T08:59:00Z
   # or from a backup: gcloud sql backups list --instance mrak-production
   #                   gcloud sql backups restore <id> --restore-instance mrak-production-restore
   ```

4. **Verify:** connect with the Cloud SQL Auth Proxy, run `infra/gcp/verify-restore.sh <url>`, and
   spot-check the damaged data.
5. **Switch:**
   - Whole database bad: point `DATABASE_URL` at the restored instance (new secret version) and
     redeploy. Later, rename instances in Terraform (`terraform import`).
   - Few rows bad: copy them back from the clone with reviewed SQL in one transaction, and keep
     the production instance.
6. **Re-enable** the switches. Watch the dashboard and write down what was lost: writes between
   the target time and the switch.
7. **Clean up:** delete the clone or the old instance after 7 days, with deletion protection
   lifted deliberately.

## Objectives

| Objective                      | Target                                                                                                                                                                |
| ------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| RPO (data loss)                | ≤ 5 minutes (PITR)                                                                                                                                                    |
| RTO (restore + switch)         | ≤ 2 hours                                                                                                                                                             |
| Backup lifetime                | 30 daily backups in production; PITR window 7 days                                                                                                                    |
| Deleted accounts after restore | GDPR: erasures made after the target time must be re-applied. Audit rows of deletions carry no account id, so a deletion ledger is needed ([backlog](../BACKLOG.md)). |
