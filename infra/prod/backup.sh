#!/usr/bin/env bash
# shellcheck disable=SC2034,SC1091
# pg_dump to the private S3 bucket (S-09.01). Cron: 15 3 * * * /opt/terrasight/repo/infra/prod/backup.sh >> /var/log/terrasight-backup.log 2>&1
#   backup.sh [label]    label (default "daily") goes into the key: backups/terrasight-<label>-<UTC stamp>.dump
# Uses `docker exec` on the fixed-name postgres container, so cron needs no TAG or POSTGRES_PASSWORD for compose.
# Failure: non-zero exit, status/backup.status = FAIL ..., optional SNS (see common.sh).
set -Eeuo pipefail
# shellcheck source=infra/prod/common.sh
. "$(dirname "$(readlink -f "${BASH_SOURCE[0]}")")/common.sh"

LABEL="${1:-daily}"
STAMP="$(date -u +%Y-%m-%dT%H%M)"
KEY="backups/terrasight-$LABEL-$STAMP.dump"
TMP="$(mktemp "$TS_HOME/backup.XXXXXX")"
cleanup() { rm -f "$TMP"; }
fail_trap backup cleanup

FAIL_MSG="pg_dump failed"
docker exec "$PG_CONTAINER" pg_dump -U terrasight -d terrasight --format=custom > "$TMP"
# The dump must be a readable archive of a plausible size before it goes anywhere.
FAIL_MSG="dump is not a valid pg_dump archive"
docker exec -i "$PG_CONTAINER" pg_restore --list < "$TMP" > /dev/null
SIZE="$(wc -c < "$TMP")"
FAIL_MSG="dump is only $SIZE bytes"
[ "$SIZE" -gt 10000 ]
FAIL_MSG="upload to s3://${S3_BUCKET:-<unset>}/$KEY failed"
aws s3 cp --only-show-errors "$TMP" "s3://${S3_BUCKET:?S3_BUCKET missing in prod.env}/$KEY"
FAIL_MSG=""
job_ok backup
log "backup $KEY done ($SIZE bytes)"
