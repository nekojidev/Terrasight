# syntax=docker/dockerfile:1.7
# Terrasight API (all roles). Build from the repo root:
#   docker build -f infra/api.Dockerfile -t terrasight-api .
# Uses the public npm registry unless an .npmrc is passed as a build secret:
#   docker build --secret id=npmrc,src=$HOME/.npmrc -f infra/api.Dockerfile .
# Targets: `runtime` (default, last stage) = the API; `migrate` = one-shot `prisma migrate deploy` (run by
# infra/prod/deploy.sh before the new API starts, never at container start).
FROM node:26-bookworm-slim AS build
RUN npm install -g pnpm@10.34.7
WORKDIR /repo
COPY . .
RUN --mount=type=secret,id=npmrc,target=/root/.npmrc \
    pnpm install --frozen-lockfile --filter @terrasight/api...
RUN pnpm turbo run build --filter=@terrasight/api...
# Production-only dependency tree plus the built workspace packages, nothing else (no sources, no dev tools).
RUN --mount=type=secret,id=npmrc,target=/root/.npmrc \
    pnpm --filter @terrasight/api deploy --prod --legacy /out

# One-shot migration runner: needs the prisma CLI (a dev dependency), so it reuses the build stage.
FROM build AS migrate
ENV NODE_ENV=production
WORKDIR /repo/apps/api
CMD ["npx", "prisma", "migrate", "deploy"]

FROM node:26-bookworm-slim AS runtime
ENV NODE_ENV=production
# Same layout as the repo so ../../prisma and ../../data paths keep resolving.
WORKDIR /repo/apps/api
COPY --from=build --chown=node:node /out/ ./
COPY --from=build --chown=node:node /repo/prisma /repo/prisma
COPY --from=build --chown=node:node /repo/data /repo/data
COPY --from=build --chown=node:node /repo/fixtures /repo/fixtures
RUN mkdir -p /repo/uploads && chown node:node /repo/uploads
USER node
EXPOSE 4000
HEALTHCHECK --interval=15s --timeout=5s --start-period=30s --retries=5 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:'+(process.env.PORT||4000)+'/healthz').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"]
# ROLE selects api / worker / scheduler / all. Migrations are NOT run here.
CMD ["node", "--enable-source-maps", "dist/main.js"]
