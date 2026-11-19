# Runbook — database restore

Platform: [ADR 0012](../adr/0012-hosting-free-tier.md) (Neon Free). Two layers of backup:

- **Neon restore window** (Free: a few hours of history): undo a mistake noticed quickly by
  branching from a point in time.
- **Nightly encrypted dumps** (`.github/workflows/backup.yml`): `pg_dump` → `age` → private R2
  bucket `mrak-backups`, kept 30 days (bucket lifecycle). The age **private key** is kept offline
  by the owner (password manager + paper copy) and as the `BACKUP_AGE_KEY` secret of the
  `production` environment for the drill.

Restores always go to a **new** database first; the damaged one is kept until the restore is
verified.

## Monthly drill (automated)

`.github/workflows/restore-drill.yml` runs on the 3rd of each month at 05:00 UTC:

1. Take the newest dump in R2 (fails if it is older than 48 h: the nightly backup is broken).
2. Decrypt it into a throw-away Postgres 17 container inside the job.
3. Check it with `infra/postgres/verify-restore.sh`: all migrations applied, none failed, core
   tables readable. Only row counts are printed.
4. Destroy the container.

The job summary records the dump age and restore time. Copy the result into the
[test report](../security/test-report.md). A failed drill is an incident.

## Real restore

1. **Decide the target time**: just before the damage (audit log, Render logs). Note it in UTC.
2. **Stop writes** if the damage is ongoing:
   `redis-cli -u "$REDIS_URL" HSET mrak:switches cloud-saves off purchases off registration off`
   ([abuse](abuse.md)).
3. **Restore into a new database:**
   - **Within the Neon window:** Neon console → project → Branches → _Create branch_ from a
     point in time (target time). Copy its connection string.
   - **From a dump:** create a new branch or project, then

     ```sh
     aws s3 cp s3://mrak-backups/online/<file>.dump.age . --endpoint-url https://<account>.r2.cloudflarestorage.com
     age -d -i age.key <file>.dump.age | pg_restore --no-owner --no-privileges -d "<new url>"
     ```

4. **Verify:** `infra/postgres/verify-restore.sh "<new url>"` and spot-check the damaged data.
5. **Switch:**
   - Whole database bad: Neon → set the restored branch as the default (or update `DATABASE_URL`
     on Render to the new endpoint) and redeploy.
   - Few rows bad: copy them back with reviewed SQL in one transaction; keep the current database.
6. **Re-enable** the switches. Write down what was lost: writes between the target time and the
   switch.
7. **Clean up** the old branch after 7 days.

## Objectives

| Objective                      | Target                                                                                                                                                                |
| ------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| RPO (data loss)                | Minutes within the Neon window; otherwise ≤ 24 h (nightly dump)                                                                                                       |
| RTO (restore + switch)         | ≤ 2 hours                                                                                                                                                             |
| Backup lifetime                | 30 nightly dumps (R2 lifecycle)                                                                                                                                       |
| Deleted accounts after restore | GDPR: erasures made after the target time must be re-applied. Audit rows of deletions carry no account id, so a deletion ledger is needed ([backlog](../BACKLOG.md)). |
