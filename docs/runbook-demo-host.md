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
| SSM Parameter Store | SecureStrings under `/terrasight/demo/`: `JWT_SECRET` (≥ 32 random chars), `GEMINI_API_KEY`, `GEMINI_MODEL`, `OPENET_API_KEY`, `CDSE_CLIENT_ID`, `CDSE_CLIENT_SECRET`, `EARTHDATA_TOKEN`, `NASS_API_KEY`, `GEMINI_DAILY_CALL_BUDGET`, `GEMINI_DAILY_TOKEN_BUDGET` (see "Gemini budget" below), `S3_BUCKET`, `AWS_REGION`, **`SMTP_URL`** (required: the API refuses to start in production without it; used for password-reset emails only, since there is no email verification or invitation email; `smtps://user:pass@host:465`, an SES SMTP endpoint works) and `EMAIL_FROM` (a verified sender), **`OPEN_METEO_API_KEY` for a public host** (the free Open-Meteo endpoint is for non-commercial use only; without the key the API falls back to it, which a public site must not rely on) |
| DNS | an A record for the demo domain → the Elastic IP |

**Scouting photos need storage that survives a deploy.** The API receives `S3_BUCKET` **only through the SSM-generated `/opt/terrasight/.env`**
(the `S3_BUCKET` line in `prod.env` is read by the backup scripts, not by the API container). So create the SSM parameter `/terrasight/demo/S3_BUCKET`
(and `AWS_REGION`), re-run `ssm-env.sh` and `docker compose ... up -d api`. Check: `grep -c '^S3_BUCKET=' /opt/terrasight/.env` prints `1`.
Without a bucket the API writes photos (and zone rasters) to `/repo/uploads` inside the container; `infra/prod/docker-compose.yml` mounts the named volume `uploads` there
so they survive deploys, but that volume is on the instance disk, is **not** in `backup.sh`, and the signed upload URLs go through the API (10 MiB per photo). Use the bucket on a public host.

**Instance metadata hop limit (check by hand).** The API runs in a container, so its calls to the instance metadata service (IMDSv2) cross one more network hop.
With the default hop limit of 1 the SDK cannot get the instance-role credentials and S3 / SNS calls fail with "credentials not found". Set the limit to 2 and verify:

```bash
aws ec2 modify-instance-metadata-options --instance-id <i-...> --http-tokens required --http-put-response-hop-limit 2 --http-endpoint enabled
# from inside the api container (the image has no curl; it has node). Prints 200 when the metadata service is reachable:
docker compose -f /opt/terrasight/repo/infra/prod/docker-compose.yml exec api node -e \
  "fetch('http://169.254.169.254/latest/api/token',{method:'PUT',headers:{'X-aws-ec2-metadata-token-ttl-seconds':'60'}}).then(r=>console.log(r.status),e=>console.log('FAIL',e.message))"
```

(Not verifiable from the repository: the team performs and confirms it.)

## Gemini budget (set before the host is public)

`GEMINI_DAILY_CALL_BUDGET` and `GEMINI_DAILY_TOKEN_BUDGET` default to `0` = **unlimited**. A public host can be driven by anyone, so set both. Over budget the API makes no Gemini call
(one log line per UTC day: "Gemini daily budget spent ..."); recommendation texts, the day summary and AI-proposed rotations fall back to templates / library rotations until 00:00 UTC.
The check runs before a call; a call counts when it starts and tokens when it ends, so the last call of a day may overshoot the token budget a little.

What the app calls per day (from the code):

| Feature | Gemini calls | Notes |
| --- | --- | --- |
| AI-written recommendations and watch-items | at most 1 per field per check (one batched call) | skipped when the facts hash is unchanged (24 h cache), so most days far fewer |
| Day summary | 1 per company per changed facts hash | cached 24 h |
| AI-proposed rotations | 1 per field per scenario run with new inputs | cached 24 h; background recomputes use the cache and never call |
| Assistant chat | 1 per model step, up to about 8 per question (at most 6 tool calls plus the final answer) | tool results are sent back each step, so a question is the most token-heavy item |

Starting point (an estimate, **not measured**; adjust after a week of real use): for about 50 fields, 10 companies and 20 assistant questions a day that is roughly 50 + 10 + 50 + 160 = 270 calls
and, assuming about 4k tokens per recommendation call, 2k per summary, 3k per rotation and 15k per question, about 0.7 M tokens. With about 3x headroom:
`GEMINI_DAILY_CALL_BUDGET=1000` and `GEMINI_DAILY_TOKEN_BUDGET=2000000`. Raise them in proportion to fields and users; read the real usage from the `ai_usage` table
(`docker exec terrasight-postgres psql -U terrasight -d terrasight -c 'select * from ai_usage limit 10'`) and the "budget spent" log line.
**Known gap:** assistant chat turns call Gemini directly and are not counted against or stopped by this budget (only the texts and rotations are). Cap the cost of the assistant with a hard quota / billing alert on the
Gemini API key in the Google console, and watch `ai_usage`.

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

**First-deploy checklist (before `deploy.sh`).** (a) `SMTP_URL` must exist in SSM: in production the API **refuses to start** without it (config check: "SMTP_URL: required in production"),
even though mail is only sent for password resets; use an SES SMTP endpoint or any valid `smtps://user:pass@host:465` URL. (b) `OPEN_METEO_API_KEY`, `S3_BUCKET`, the Gemini budgets and `NASS_API_KEY` are set (above).
(c) On the 2-vCPU `t3.large` set the SSM parameter `SCENARIO_WORKERS=1`: scenario runs are CPU-bound and the API's event loop needs the other core (the default is cores minus one, which is also 1 on 2 vCPUs; setting it makes it explicit and survives a change of instance size). Other knobs: README "Advanced settings".
(d) Docker Compose is **at least v2.24**: run `docker compose version`. `infra/prod/docker-compose.cloudwatch.yml` uses the `!override` tag, which older versions reject
(Ubuntu 24.04's `docker-compose-v2` package is new enough; check anyway, and do not enable the CloudWatch override on an older one).

## 3. Deploy, roll back, back up

All scripts read `/opt/terrasight/prod.env` and share `infra/prod/common.sh`. Optional keys in `prod.env`:
`AWS_REGION`, `ALERT_SNS_TOPIC_ARN` (a message on every failed deploy, backup or restore check),
`NEXT_PUBLIC_BASEMAP_TILES` / `NEXT_PUBLIC_BASEMAP_ATTRIBUTION` / `NEXT_PUBLIC_SENTRY_DSN` (baked into the web image at build time),
`COMPOSE_FILE` (see CloudWatch below). Last result of each job: `/opt/terrasight/status/<deploy|backup|restore-check>.status`
(`ok <time>` or `FAIL <time> <reason>`).

```bash
/opt/terrasight/repo/infra/prod/deploy.sh v0.9.0       # see the flow below
docker compose -f /opt/terrasight/repo/infra/prod/docker-compose.yml exec api npm run boundaries:load   # once, after the first deploy (needs outbound internet to raw.githubusercontent.com)
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
- **Request limits and the proxy:** stock Caddy has no rate limiter (it needs a plugin), so none is configured. Rate limits for sign-in, sign-up and the public routes are enforced **in the API** with per-IP buckets
  (per-user buckets for the expensive signed-in endpoints; Redis-backed when Redis is up, in-process otherwise). That only works if the API sees the real client address: Caddy appends the client IP to `X-Forwarded-For`
  and the API sets Express `trust proxy` = 1 (one hop), so `req.ip` is the visitor, not Caddy. Do not put another proxy or CDN in front without raising that hop count in `apps/api/src/main.ts`, or every visitor would share one bucket.
  Caddy does cap request bodies: `/api/scouting-photos/*` 11 MB (photo cap `PHOTO_MAX_BYTES` is 10 MiB; with a bucket the photo goes to S3 directly), every other `/api/*` request 1 MB (JSON only; the largest is a field outline,
  at most 5,000 vertices per ring and 50 parts, and the API's own JSON limit is 100 kB). The Caddyfile also sends `Strict-Transport-Security`, `X-Content-Type-Options`, `Referrer-Policy`, `X-Frame-Options: DENY` and a restrictive `Permissions-Policy`, and hides the `Server` header.
- **Secrets rotate:** update the SSM parameter, run `ssm-env.sh`, then `docker compose … up -d api`.
- **Disk:** images accumulate per tag; run `docker image prune -a --filter "until=720h"` monthly (keeps recent tags for rollback).

## 4. Checks after a deploy

Health routes are `/healthz` (process up; used by the container healthcheck) and `/readyz` (PostgreSQL and RabbitMQ reachable); the API has **no** `/health`. Through Caddy only `/api/readyz` is mapped.

1. `curl -s -o /dev/null -w '%{http_code}\n' https://<domain>/api/readyz` gives `200` (`deploy.sh` already checked it inside the container); `status/deploy.status` says `ok`.
2. **Boundaries loaded** (`boundaries:load` is a manual step; without it field previews fail to find the county / region). Confirm it ran:
   `docker exec terrasight-postgres psql -U terrasight -d terrasight -c 'select (select count(*) from admin_areas) as admin_areas, (select count(*) from us_counties) as us_counties'`
   Both counts must be well above zero (Natural Earth: several thousand admin-1 areas, about 3,000 US counties). If they are 0, run the `boundaries:load` command from section 3.
3. Sign up, create the company, add a **real field** (draw an outline; the preview must answer): its history is gathered (MODIS ~2 min); Analyze fields finishes in < 30 s once history is built. There is no demo company (product definition v2.6).
4. A rotation run returns in < 5 s; the Owner report link opens on a phone.
5. **Public page `/explore`** (no sign-in): click a point on the map and the climate shift for it appears within seconds; when a ready field outline covers the clicked place, a rotation is shown.
   Also call the public API routes it uses, signed out (`https://<domain>/api/public/...`; the paths are in the public-page unit's API reference): each answers 200 with JSON, not 401, and a burst of requests from one IP eventually answers 429.
6. S3 photos: add a scouting photo to a task and open it (needs `S3_BUCKET` in `/opt/terrasight/.env` and the hop limit above). Gemini: the log has no "budget spent" line right after the first morning check.
7. Security headers: `curl -sI https://<domain>/ | grep -iE 'strict-transport|x-frame|x-content-type|referrer|permissions'`.

## 5. Public page (`/explore`)

**What it exposes without sign-in:** the climate shift (18 seasons of NASA data compared across periods) and, where a ready outline covers the point, the rotation view for a clicked location, through the
read-only routes under `/api/public/*`. No company, field, user or recommendation data is reachable; there is no write route. Sign-in, sign-up and the app stay as before.

**Which limits protect it:** per-IP request buckets in the API (the proxy forwards the real client IP; see "Request limits and the proxy"), Caddy's 1 MB request body cap on `/api/*`, source circuit breakers and caches
(`SOURCE_BREAKER_*`) so a flood cannot hammer NASA / Open-Meteo, and the Gemini daily budget for any AI text. Open-Meteo needs `OPEN_METEO_API_KEY` (commercial use).

**Switch it off quickly:** set the SSM parameter `PUBLIC_EXPLORE=0` (the kill switch, **implemented by the public-page unit**; until that lands it has no effect), run `ssm-env.sh`, then
`docker compose -f /opt/terrasight/repo/infra/prod/docker-compose.yml up -d api` (a few seconds; no rebuild, no migration). `/explore` and `/api/public/*` then stop answering; the signed-in app is unaffected.
If the flag is not available yet, the fastest block is a temporary `respond /api/public/* 404` and `respond /explore* 404` at the top of the site block in `infra/prod/Caddyfile`, then
`docker compose -f /opt/terrasight/repo/infra/prod/docker-compose.yml exec caddy caddy reload --config /etc/caddy/Caddyfile`.
