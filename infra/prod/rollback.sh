#!/usr/bin/env bash
# Roll back to the previous tag in one command (S-09.01). Migrations are forward-only: roll back only between tags
# without new migrations, or restore the latest pg_dump (backup.sh) first.
set -euo pipefail
PREV="$(cat /opt/terrasight/previous-tag)"
cd /opt/terrasight/repo
set -a; . /opt/terrasight/prod.env; set +a
TAG="$PREV" docker compose -f infra/prod/docker-compose.yml up -d api web
echo "$PREV" > /opt/terrasight/current-tag
echo "rolled back to $PREV"
