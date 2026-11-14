#!/usr/bin/env bash
# Writes /opt/terrasight/.env from SSM Parameter Store (S-09.01): every SecureString under /terrasight/demo/.
# The instance role needs ssm:GetParametersByPath and kms:Decrypt for that path.
set -euo pipefail
PREFIX="${SSM_PREFIX:-/terrasight/demo/}"
umask 077
aws ssm get-parameters-by-path --path "$PREFIX" --with-decryption --recursive \
  --query 'Parameters[].[Name,Value]' --output text |
  while IFS=$'\t' read -r name value; do printf '%s=%s\n' "${name##*/}" "$value"; done > /opt/terrasight/.env
echo "wrote /opt/terrasight/.env ($(wc -l < /opt/terrasight/.env) values)"
