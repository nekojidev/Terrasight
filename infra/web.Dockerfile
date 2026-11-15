# syntax=docker/dockerfile:1.7
# Terrasight web (Next.js, standalone output). Build from the repo root:
#   docker build -f infra/web.Dockerfile -t terrasight-web .
FROM node:26-bookworm-slim AS build
RUN npm install -g pnpm@10.34.7
WORKDIR /repo
COPY . .
RUN --mount=type=secret,id=npmrc,target=/root/.npmrc \
    pnpm install --frozen-lockfile --filter @terrasight/web...
ENV NEXT_TELEMETRY_DISABLED=1 NEXT_STANDALONE=1
# Next.js fixes rewrites and NEXT_PUBLIC_* at build time: the API address the web server proxies /api/* to, the
# satellite basemap (defaults to EOX Sentinel-2 cloudless 2016, CC BY 4.0) and the optional Sentry DSN.
ARG API_URL=http://api:4000
ARG NEXT_PUBLIC_BASEMAP_TILES=
ARG NEXT_PUBLIC_BASEMAP_ATTRIBUTION=
ARG NEXT_PUBLIC_SENTRY_DSN=
ENV API_URL=${API_URL} \
    NEXT_PUBLIC_BASEMAP_TILES=${NEXT_PUBLIC_BASEMAP_TILES} \
    NEXT_PUBLIC_BASEMAP_ATTRIBUTION=${NEXT_PUBLIC_BASEMAP_ATTRIBUTION} \
    NEXT_PUBLIC_SENTRY_DSN=${NEXT_PUBLIC_SENTRY_DSN}
RUN pnpm turbo run build --filter=@terrasight/web...

FROM node:26-bookworm-slim AS runtime
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0
WORKDIR /app
# The standalone server and its traced node_modules; static assets and public/ are copied next to it.
COPY --from=build --chown=node:node /repo/apps/web/.next/standalone ./
COPY --from=build --chown=node:node /repo/apps/web/.next/static ./apps/web/.next/static
COPY --from=build --chown=node:node /repo/apps/web/public ./apps/web/public
USER node
EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=5s --start-period=20s --retries=5 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:3000/').then(r=>process.exit(r.status<500?0:1),()=>process.exit(1))"]
CMD ["node", "apps/web/server.js"]
