# Shared helpers for the demo-host scripts (source it, do not run it). Layout under $TS_HOME (default /opt/terrasight):
#   repo/            the checkout            prod.env   non-secret compose settings (DOMAIN, POSTGRES_PASSWORD, S3_BUCKET, ...)
#   current-tag, previous-tag               status/<job>.status  last result per job (ok | FAIL <time> <message>)
# Optional in prod.env: ALERT_SNS_TOPIC_ARN (+ AWS_REGION) to get a message on every failure.
# shellcheck shell=bash disable=SC2034,SC2154
TS_HOME="${TS_HOME:-/opt/terrasight}"
REPO="$TS_HOME/repo"
STATUS_DIR="$TS_HOME/status"
mkdir -p "$STATUS_DIR"
set -a
# shellcheck disable=SC1091
. "$TS_HOME/prod.env"
set +a
export COMPOSE_FILE="${COMPOSE_FILE:-infra/prod/docker-compose.yml}"
export COMPOSE_PROJECT_NAME=terrasight
PG_CONTAINER=terrasight-postgres
API_CONTAINER=terrasight-api
NETWORK=terrasight_default
cd "$REPO" || return 1

log() { printf '%s %s\n' "$(date -u +%FT%TZ)" "$*"; }

# job_ok <job>: record success. job_fail <job> <message>: record failure and, when configured, notify via SNS.
job_ok() { echo "ok $(date -u +%FT%TZ)" > "$STATUS_DIR/$1.status"; }
job_fail() {
  local job="$1" msg="$2"
  echo "FAIL $(date -u +%FT%TZ) $msg" > "$STATUS_DIR/$job.status"
  log "ALERT [$job] $msg" >&2
  if [ -n "${ALERT_SNS_TOPIC_ARN:-}" ] && command -v aws > /dev/null; then
    aws sns publish ${AWS_REGION:+--region "$AWS_REGION"} --topic-arn "$ALERT_SNS_TOPIC_ARN" \
      --subject "Terrasight $job failed" --message "$(hostname): $msg" > /dev/null \
      || log "could not publish the SNS alert" >&2
  fi
}

# fail_trap <job> [cleanup command]: on a non-zero exit run the optional cleanup, then record and send the alert.
# Set FAIL_MSG="..." before a step to say what failed (plain assignment, not a command prefix).
fail_trap() {
  FAIL_JOB="$1"
  FAIL_CLEANUP="${2:-}"
  FAIL_MSG=""
  trap 'rc=$?; [ -n "$FAIL_CLEANUP" ] && $FAIL_CLEANUP; if [ $rc -ne 0 ]; then job_fail "$FAIL_JOB" "${FAIL_MSG:-exited with status $rc}"; fi; exit $rc' EXIT
}

# wait_postgres: until the postgres container reports healthy (max ~2 min).
wait_postgres() {
  for _ in $(seq 1 60); do
    [ "$(docker inspect -f '{{.State.Health.Status}}' "$PG_CONTAINER" 2> /dev/null)" = healthy ] && return 0
    sleep 2
  done
  return 1
}

# wait_ready: /readyz (PostgreSQL + RabbitMQ reachable) answers 200 inside the api container, max ~2 min.
wait_ready() {
  for _ in $(seq 1 40); do
    if docker exec "$API_CONTAINER" node -e \
      "fetch('http://127.0.0.1:4000/readyz').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))" 2> /dev/null; then
      return 0
    fi
    sleep 3
  done
  return 1
}

# migrations_added <from-tag> <to-tag>: migration folders present in <to-tag> but not in <from-tag>.
migrations_added() {
  comm -13 \
    <(git -C "$REPO" ls-tree --name-only "$1:prisma/migrations" | sort) \
    <(git -C "$REPO" ls-tree --name-only "$2:prisma/migrations" | sort)
}
