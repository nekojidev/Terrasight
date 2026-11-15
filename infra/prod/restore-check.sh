#!/usr/bin/env bash
# shellcheck disable=SC2034,SC1091
# Restore drill: restores the latest S3 dump (or a given key) into a scratch database on the running postgres
# container, runs sanity queries, drops the scratch database. Production data is never touched.
#   restore-check.sh [backups/terrasight-daily-2026-11-15T0315.dump]
# Run it monthly (runbook section "Backup drill") and after changing backup.sh. Result: status/restore-check.status.
set -Eeuo pipefail
# shellcheck source=infra/prod/common.sh
. "$(dirname "$(readlink -f "${BASH_SOURCE[0]}")")/common.sh"

BUCKET="${S3_BUCKET:?S3_BUCKET missing in prod.env}"
SCRATCH="restore_check_$(date -u +%Y%m%d%H%M%S)"
TMP="$(mktemp "$TS_HOME/restore.XXXXXX")"
psql_pg() { docker exec -i "$PG_CONTAINER" psql -U terrasight -v ON_ERROR_STOP=1 "$@"; }
cleanup() {
  rm -f "$TMP"
  psql_pg -d postgres -qc "DROP DATABASE IF EXISTS $SCRATCH" > /dev/null 2>&1 || true
}
fail_trap restore-check cleanup

KEY="${1:-}"
if [ -z "$KEY" ]; then
  FAIL_MSG="no dumps found under s3://$BUCKET/backups/"
  KEY="$(aws s3api list-objects-v2 --bucket "$BUCKET" --prefix backups/terrasight- \
    --query 'sort_by(Contents,&LastModified)[-1].Key' --output text)"
  [ -n "$KEY" ] && [ "$KEY" != None ]
fi
FAIL_MSG="download of $KEY failed"
aws s3 cp --only-show-errors "s3://$BUCKET/$KEY" "$TMP"

FAIL_MSG="pg_restore of $KEY into $SCRATCH failed"
psql_pg -d postgres -qc "CREATE DATABASE $SCRATCH"
docker exec -i "$PG_CONTAINER" pg_restore -U terrasight -d "$SCRATCH" --no-owner --exit-on-error < "$TMP"

FAIL_MSG="sanity query failed on the restored $KEY"
TABLES="$(psql_pg -d "$SCRATCH" -Atc "SELECT count(*) FROM information_schema.tables WHERE table_schema='public'")"
MIGS="$(psql_pg -d "$SCRATCH" -Atc "SELECT count(*) FROM _prisma_migrations WHERE finished_at IS NOT NULL")"
ROWS="$(psql_pg -d "$SCRATCH" -Atc "SELECT coalesce(sum(n_live_tup),0)::bigint FROM pg_stat_user_tables")"
EXPECTED="$(git -C "$REPO" ls-tree --name-only "$(cat "$TS_HOME/current-tag"):prisma/migrations" | grep -c '^[0-9]')"
log "restored $KEY: $TABLES tables, $MIGS applied migrations (current tag has $EXPECTED), ~$ROWS rows"
[ "$TABLES" -ge 5 ]
FAIL_MSG="restored dump has $MIGS migrations, the deployed tag expects $EXPECTED (stale or wrong dump)"
[ "$MIGS" -ge "$((EXPECTED - 2))" ]

FAIL_MSG=""
job_ok restore-check
log "restore check OK for $KEY"
