#!/usr/bin/env bash
# shellcheck disable=SC2034,SC1091
# Deploy a git tag (S-09.01): build the images for that tag, dump the database, migrate, start, verify, auto-roll-back.
#   infra/prod/deploy.sh v0.9.0
# Order: build -> start data services -> pre-migration dump (backup.sh) -> prisma migrate deploy (one-shot container,
# the only place migrations run) -> start api+web on the new tag -> wait for /readyz -> record tags.
# If /readyz never turns 200 the previous tag is restored (rollback.sh; it refuses when the new tag added
# migrations, then the alert says so and the pre-deploy dump is the way back). Optional build settings in prod.env:
# NEXT_PUBLIC_BASEMAP_TILES, NEXT_PUBLIC_BASEMAP_ATTRIBUTION, NEXT_PUBLIC_SENTRY_DSN (baked into the web image).
set -Eeuo pipefail

# The whole body lives in a function that is called on the last line: bash has then parsed the complete script
# before the checkout of another tag replaces this file, so a changed script on that tag cannot corrupt this run.
main() {
  # shellcheck source=infra/prod/common.sh
  . "$(dirname "$(readlink -f "${BASH_SOURCE[0]}")")/common.sh"
  fail_trap deploy

  TAG="${1:?usage: deploy.sh <git tag>}"
  PREV="$(cat "$TS_HOME/current-tag" 2> /dev/null || true)"
  export TAG

  FAIL_MSG="checkout of $TAG failed"
  git fetch --tags --quiet
  git checkout --quiet "$TAG"

  FAIL_MSG="image build for $TAG failed (nothing was changed on the host)"
  docker build -f infra/api.Dockerfile -t "terrasight-api:$TAG" .
  docker build -f infra/api.Dockerfile --target migrate -t "terrasight-api-migrate:$TAG" .
  WEB_ARGS=()
  for v in NEXT_PUBLIC_BASEMAP_TILES NEXT_PUBLIC_BASEMAP_ATTRIBUTION NEXT_PUBLIC_SENTRY_DSN; do
    [ -n "${!v:-}" ] && WEB_ARGS+=(--build-arg "$v=${!v}")
  done
  docker build -f infra/web.Dockerfile "${WEB_ARGS[@]}" -t "terrasight-web:$TAG" .

  FAIL_MSG="data services did not become healthy"
  docker compose up -d postgres rabbitmq redis
  wait_postgres

  if [ -n "$PREV" ]; then
    FAIL_MSG="pre-migration dump failed: deploy aborted, nothing migrated (see backup.status)"
    "$REPO/infra/prod/backup.sh" "predeploy-$TAG"
  else
    log "first deploy (no current tag): skipping the pre-migration dump"
  fi

  FAIL_MSG="prisma migrate deploy failed: the old api is still running; the pre-deploy dump is backups/terrasight-predeploy-$TAG-*"
  docker run --rm --network "$NETWORK" \
    -e "DATABASE_URL=postgresql://terrasight:${POSTGRES_PASSWORD:?}@postgres:5432/terrasight" \
    "terrasight-api-migrate:$TAG"

  FAIL_MSG="docker compose up failed"
  docker compose up -d --remove-orphans

  FAIL_MSG=""
  if wait_ready; then
    [ -n "$PREV" ] && [ "$PREV" != "$TAG" ] && echo "$PREV" > "$TS_HOME/previous-tag"
    echo "$TAG" > "$TS_HOME/current-tag"
    job_ok deploy
    log "deployed $TAG (readyz 200)"
    exit 0
  fi

  # Post-deploy check failed.
  docker compose logs --tail 60 api >&2 || true
  if [ -z "$PREV" ] || [ "$PREV" = "$TAG" ]; then
    FAIL_MSG="$TAG is up but /readyz is not 200 and there is no previous tag to roll back to"
    exit 1
  fi
  if "$REPO/infra/prod/rollback.sh" "$TAG" "$PREV"; then
    FAIL_MSG="$TAG failed /readyz; automatically rolled back to $PREV"
  else
    FAIL_MSG="$TAG failed /readyz and the automatic rollback to $PREV did not complete (new migrations? see rollback.sh output); pre-deploy dump: backups/terrasight-predeploy-$TAG-*"
  fi
  exit 1
}

main "$@"
exit $?
