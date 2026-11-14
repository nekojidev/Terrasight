#!/usr/bin/env bash
# Daily pg_dump to the private S3 bucket (S-09.01). Cron: 15 3 * * * /opt/terrasight/repo/infra/prod/backup.sh
set -euo pipefail
set -a; . /opt/terrasight/prod.env; set +a
STAMP="$(date -u +%Y-%m-%dT%H%M)"
docker compose -f /opt/terrasight/repo/infra/prod/docker-compose.yml exec -T postgres \
  pg_dump -U terrasight -d terrasight --format=custom | aws s3 cp - "s3://${S3_BUCKET:?}/backups/terrasight-$STAMP.dump"
echo "backup $STAMP done"
