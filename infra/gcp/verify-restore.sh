#!/usr/bin/env bash
# Verifies a restored online-api database (docs/runbooks/restore.md). Used by the monthly restore
# drill (.github/workflows/restore-drill.yml) and after any real restore.
#   infra/gcp/verify-restore.sh "<postgres url>" [migrations dir]
# Passes when: every repository migration is applied and none failed, the core tables exist and
# answer, and (optionally) the restored data is not older than MAX_AGE_HOURS.
set -euo pipefail
url="$1"
migrations="${2:-services/online-api/prisma/migrations}"
max_age_hours="${MAX_AGE_HOURS:-}"
q() { psql "$url" -v ON_ERROR_STOP=1 -At -c "$1"; }

expected=$(find "$migrations" -mindepth 1 -maxdepth 1 -type d | wc -l | tr -d ' ')
applied=$(q "SELECT count(*) FROM _prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL")
failed=$(q "SELECT count(*) FROM _prisma_migrations WHERE finished_at IS NULL AND rolled_back_at IS NULL")
[ "$applied" -ge "$expected" ] || { echo "✘ $applied of $expected migrations applied"; exit 1; }
[ "$failed" -eq 0 ] || { echo "✘ $failed failed migrations"; exit 1; }

for t in users sessions refresh_tokens audit_log cloud_saves account_progress entitlements payment_events; do
  n=$(q "SELECT count(*) FROM $t")
  echo "  $t: $n rows"
done

if [ -n "$max_age_hours" ]; then
  newest=$(q "SELECT coalesce(extract(epoch FROM now() - max(timestamp))/3600, 1e9)::int FROM audit_log")
  [ "$newest" -le "$max_age_hours" ] || { echo "✘ newest audit row is ${newest} h old (> ${max_age_hours} h)"; exit 1; }
fi
echo "✔ restore verified: $applied migrations, core tables readable"
