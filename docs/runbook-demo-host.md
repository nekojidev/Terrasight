# Runbook — demo host (S-09.01)

One EC2 instance runs the whole stack with Docker Compose behind Caddy (TLS). Set up by hand for the hackathon
(Terraform is backlog item L-18). Files: `infra/prod/`.

## 1. AWS resources (once)

| Resource | Setting |
| --- | --- |
| EC2 | Ubuntu 24.04 LTS, `t3.large` (2 vCPU, 8 GB; scenario runs use one core each), 40 GB gp3, Elastic IP |
| Security group | 80 and 443 from anywhere; 22 from your IP only |
| S3 bucket | private, block all public access, SSE-S3; used for scouting photos (`scouting/…`) and backups (`backups/…`) |
| IAM role (instance profile) | `s3:PutObject`, `s3:GetObject` on the bucket; `ssm:GetParametersByPath` on `/terrasight/demo/*`; `kms:Decrypt` for the SSM key |
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

## 3. Deploy, seed, back up

```bash
/opt/terrasight/repo/infra/prod/deploy.sh v0.9.0       # build images for the tag, start, keep the previous tag
docker compose -f /opt/terrasight/repo/infra/prod/docker-compose.yml exec api npm run boundaries:load
docker compose -f /opt/terrasight/repo/infra/prod/docker-compose.yml exec api node scripts/seed-demo.mjs
(crontab -l; echo "15 3 * * * /opt/terrasight/repo/infra/prod/backup.sh >> /var/log/terrasight-backup.log 2>&1") | crontab -
```

- **Rollback:** `infra/prod/rollback.sh` restarts api and web on the previous tag. Migrations are forward-only:
  between tags with a new migration, restore the latest dump first
  (`aws s3 cp s3://<bucket>/backups/<file>.dump - | docker compose … exec -T postgres pg_restore -U terrasight -d terrasight --clean`).
- **Logs:** `docker compose -f infra/prod/docker-compose.yml logs -f api` (pino JSON). No OpenTelemetry (L-19).
- **Secrets rotate:** update the SSM parameter, run `ssm-env.sh`, then `docker compose … up -d api`.

## 4. Checks after a deploy

1. `https://<domain>/api/readyz` → 200.
2. Sign in, **Explore the demo company**: the brief shows the seeded items; Analyze fields finishes in < 30 s.
3. A rotation run returns in < 5 s; the Owner report link opens on a phone.
