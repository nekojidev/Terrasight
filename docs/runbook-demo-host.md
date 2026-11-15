# Runbook — demo host (S-09.01)

One EC2 instance runs the whole stack with Docker Compose behind Caddy (TLS). Set up by hand for the hackathon
(Terraform is backlog item L-18). Files: `infra/prod/`.

## 1. AWS resources (once)

| Resource | Setting |
| --- | --- |
| EC2 | Ubuntu 24.04 LTS, `t3.large` (2 vCPU, 8 GB; scenario runs use one core each), 40 GB gp3, Elastic IP |
| Security group | 80 and 443 from anywhere; 22 from your IP only |
| S3 bucket | private, block all public access, SSE-S3, versioning on, lifecycle rule (see Backups); used for scouting photos (`scouting/…`) and backups (`backups/…`) |
| IAM role (instance profile) | `s3:PutObject`, `s3:GetObject`, `s3:ListBucket` on the bucket; `sns:Publish` on the alert topic (optional); `ssm:GetParametersByPath` on `/terrasight/demo/*`; `kms:Decrypt` for the SSM key |
| SSM Parameter Store | SecureStrings under `/terrasight/demo/`: `JWT_SECRET` (≥ 32 random chars), `GEMINI_API_KEY`, `GEMINI_MODEL`, `OPENET_API_KEY`, `CDSE_CLIENT_ID`, `CDSE_CLIENT_SECRET`, `EARTHDATA_TOKEN`, `S3_BUCKET`, `AWS_REGION`, optional `OPEN_METEO_API_KEY` |
| DNS | an A record for the demo domain → the Elastic IP |

## 2. Host setup (once)

```bash
sudo apt-get update && sudo apt-get install -y docker.io docker-compose-v2 awscli git
sudo usermod -aG docker ubuntu && newgrp docker
sudo mkdir -p /opt/terrasight && sudo chown ubuntu /opt/terrasight
git clone https://github.com/<org>/Terrasight.git /opt/terrasight/repo
# Non-secret settings for compose:
cat > /opt/terrasight/prod.env <<'ENV'
DOMAIN=demo.example.com
POSTGRES_PASSWORD=<long random>
S3_BUCKET=<bucket>
ENV
chmod 600 /opt/terrasight/prod.env
/opt/terrasight/repo/infra/prod/ssm-env.sh            # writes /opt/terrasight/.env from SSM
```

## 3. Deploy, roll back, back up

All scripts read `/opt/terrasight/prod.env` and share `infra/prod/common.sh`. Optional keys in `prod.env`:
`AWS_REGION`, `ALERT_SNS_TOPIC_ARN` (a message on every failed deploy, backup or restore check),
`NEXT_PUBLIC_BASEMAP_TILES` / `NEXT_PUBLIC_BASEMAP_ATTRIBUTION` / `NEXT_PUBLIC_SENTRY_DSN` (baked into the web image at build time),
`COMPOSE_FILE` (see CloudWatch below). Last result of each job: `/opt/terrasight/status/<deploy|backup|restore-check>.status`
(`ok <time>` or `FAIL <time> <reason>`).

```bash
/opt/terrasight/repo/infra/prod/deploy.sh v0.9.0       # see the flow below
docker compose -f /opt/terrasight/repo/infra/prod/docker-compose.yml exec api npm run boundaries:load   # once
(crontab -l; echo "15 3 * * * /opt/terrasight/repo/infra/prod/backup.sh >> /var/log/terrasight-backup.log 2>&1") | crontab -
```

**Deploy flow (`deploy.sh <tag>`):**

1. Check out the tag, build `terrasight-api:<tag>`, `terrasight-api-migrate:<tag>` (the one-shot migration image) and `terrasight-web:<tag>`. A build failure changes nothing on the host.
2. Start postgres, rabbitmq, redis; wait for postgres to be healthy.
3. **Pre-migration dump** (`backup.sh predeploy-<tag>` → `backups/terrasight-predeploy-<tag>-<time>.dump`). If it fails, the deploy stops before touching the schema. Skipped on the very first deploy.
4. `prisma migrate deploy` in the one-shot migrate container. **This is the only place migrations run**; the api image does not migrate at start, so restarts are safe. If it fails, the old api keeps running.
5. Start api and web on the new tag; wait up to 2 minutes for `/readyz` = 200 (checked inside the api container).
6. On success record `current-tag` / `previous-tag`. On failure: the previous tag is restored through `rollback.sh`; if that refuses (new migrations), the alert says so and the deploy exits non-zero with the new tag still running.

**Rollback (`rollback.sh [from to]`):** restarts api and web on the previous tag and checks `/readyz`. It compares `prisma/migrations` in both tags
(`git ls-tree`) and **refuses** if the newer tag added migrations, because the old code would run against a newer schema. Then either deploy a
fix-forward tag, or restore the pre-deploy dump (below) and deploy the old tag; data written since the dump is lost.

**Restore (disaster or refused rollback):**

```bash
aws s3 cp s3://<bucket>/backups/<file>.dump /tmp/restore.dump
docker compose -f /opt/terrasight/repo/infra/prod/docker-compose.yml stop api web
docker exec -i terrasight-postgres pg_restore -U terrasight -d terrasight --clean --if-exists --no-owner < /tmp/restore.dump
/opt/terrasight/repo/infra/prod/deploy.sh <tag to run>     # migrates forward if the dump is older than the tag
```

### Backups, S3 settings and the monthly drill

- `backup.sh` dumps with `docker exec terrasight-postgres pg_dump` (no compose variables needed, so cron works), checks that the archive is readable (`pg_restore --list`) and larger than 10 kB, uploads it, and exits non-zero on any failure (`set -o pipefail`, status file, optional SNS).
- Bucket: turn on **S3 versioning**, and a **lifecycle** rule: `backups/` current versions expire after 35 days, non-current versions after 7 days, abort incomplete multipart uploads after 3 days, and move `backups/` to Standard-IA after 30 days if you keep them longer. `scouting/` photos follow the retention in the Tech Design (90 days), not this rule.
- Alert on a missing backup: a CloudWatch alarm on the SNS topic, or check `status/backup.status` from your uptime tool.
- **Monthly drill (put it in the calendar, first Monday):** run `infra/prod/restore-check.sh` on the host. It downloads the latest dump (or the key you pass), restores it into a scratch database on the running postgres, checks tables, applied migrations vs the deployed tag and row counts, then drops the scratch database. A green `status/restore-check.status` and the logged counts are the evidence. Also run it once after changing `backup.sh` or the database image. Production data is never touched; it needs about the dump size in free disk.

### Other operations

- **Logs:** `docker compose -f infra/prod/docker-compose.yml logs -f api` (pino JSON). Every request line carries `req.id`; the same id is returned in the `X-Request-Id` response header (a sane incoming `X-Request-Id` from the proxy is reused), so a user's failing request can be found by id.
- **CloudWatch Logs instead of local files:** add `COMPOSE_FILE=infra/prod/docker-compose.yml:infra/prod/docker-compose.cloudwatch.yml` and `AWS_REGION=<region>` to `prod.env` (instance role: `logs:CreateLogGroup`, `logs:CreateLogStream`, `logs:PutLogEvents`), then `deploy.sh <tag>` again. Groups: `/terrasight/demo/api`, `/terrasight/demo/web`. Read them with `aws logs tail /terrasight/demo/api --follow`.
- **Error reporting (optional):** set `SENTRY_DSN` (and optionally `SENTRY_ENVIRONMENT`, `SENTRY_RELEASE`) as SSM parameters for the API: 5xx responses and consumers that gave up are reported with the request id as a tag. For the browser set `NEXT_PUBLIC_SENTRY_DSN` in `prod.env` before the deploy (build-time); a tiny reporter sends uncaught errors and unhandled rejections (max 5 per page load). Unset = nothing is sent.
- **External uptime check:** point an external monitor (UptimeRobot, Better Stack, a Route 53 health check) at `https://<domain>/api/readyz` every minute, expecting 200 (it is 503 when PostgreSQL or RabbitMQ is down; Redis is optional and only reported). Alert by e-mail or SMS to two people. Caddy maps `/api/readyz` to the API's `/readyz`.
- **Secrets rotate:** update the SSM parameter, run `ssm-env.sh`, then `docker compose … up -d api`.
- **Disk:** images accumulate per tag; run `docker image prune -a --filter "until=720h"` monthly (keeps recent tags for rollback).

## 4. Checks after a deploy

1. `https://<domain>/api/readyz` → 200 (`deploy.sh` already checked it); `status/deploy.status` says `ok`.
2. Sign up, create the company, add a real field: its history is gathered (MODIS ~2 min); Analyze fields finishes in < 30 s once history is built. There is no demo company (product definition v2.6).
3. A rotation run returns in < 5 s; the Owner report link opens on a phone.
