#!/usr/bin/env bash
# shellcheck disable=SC2034,SC1091
# Roll back api and web to the previous tag (S-09.01).
#   rollback.sh                 current-tag -> previous-tag (the files under /opt/terrasight)
#   rollback.sh <from> <to>     explicit tags (deploy.sh uses this for its automatic rollback)
# Migrations are forward-only. The script REFUSES when <from> added migration folders that <to> does not have,
# because the older code would run against a newer schema. In that case restore the pre-deploy dump
# (backups/terrasight-predeploy-<tag>-*.dump, see the runbook) or ship a fix-forward tag.
set -Eeuo pipefail

# The whole body lives in a function that is called on the last line: bash has then parsed the complete script
# before the checkout of another tag replaces this file, so a changed script on that tag cannot corrupt this run.
main() {
  # shellcheck source=infra/prod/common.sh
  . "$(dirname "$(readlink -f "${BASH_SOURCE[0]}")")/common.sh"

  FROM="${1:-$(cat "$TS_HOME/current-tag")}"
  TO="${2:-$(cat "$TS_HOME/previous-tag" 2> /dev/null || true)}"
  [ -n "$TO" ] || { echo "no previous tag recorded: nothing to roll back to" >&2; exit 1; }
  git fetch --tags --quiet || true

  ADDED="$(migrations_added "$TO" "$FROM")"
  if [ -n "$ADDED" ]; then
    {
      echo "REFUSING to roll back $FROM -> $TO: $FROM added migrations that $TO does not know:"
      # shellcheck disable=SC2001
      echo "$ADDED" | sed 's/^/  - /'
      echo "The database already has them (migrations are forward-only), so $TO's code could break on the new schema."
      echo "Options: deploy a fix-forward tag; or restore the pre-deploy dump (data written since is lost):"
      echo "  aws s3 ls s3://${S3_BUCKET:-<bucket>}/backups/ | grep predeploy-$FROM"
      echo "  then see the runbook, section 'Restore', and run deploy.sh $TO."
    } >&2
    exit 2
  fi

  git checkout --quiet "$TO"
  TAG="$TO" docker compose up -d api web
  if ! wait_ready; then
    echo "rolled back to $TO but /readyz does not answer 200: check 'docker compose logs api'" >&2
    exit 1
  fi
  echo "$TO" > "$TS_HOME/current-tag"
  echo "rolled back $FROM -> $TO"
}

main "$@"
exit $?
