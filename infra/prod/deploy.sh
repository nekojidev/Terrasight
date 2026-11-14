#!/usr/bin/env bash
# Deploy a git tag (S-09.01): build the images for that tag, start them, keep the previous tag for rollback.
#   infra/prod/deploy.sh v0.9.0
set -euo pipefail
TAG="${1:?usage: deploy.sh <git tag>}"
cd /opt/terrasight/repo
git fetch --tags --quiet && git checkout --quiet "$TAG"
docker build -f infra/api.Dockerfile -t "terrasight-api:$TAG" .
docker build -f infra/web.Dockerfile -t "terrasight-web:$TAG" .
[ -f /opt/terrasight/current-tag ] && cp /opt/terrasight/current-tag /opt/terrasight/previous-tag
echo "$TAG" > /opt/terrasight/current-tag
set -a; . /opt/terrasight/prod.env; set +a
TAG="$TAG" docker compose -f infra/prod/docker-compose.yml up -d
echo "deployed $TAG"
