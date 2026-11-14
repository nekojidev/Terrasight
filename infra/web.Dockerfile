# syntax=docker/dockerfile:1.7
# Terrasight web (Next.js). Build from the repo root:
#   docker build -f infra/web.Dockerfile -t terrasight-web .
FROM node:26-bookworm-slim AS build
RUN npm install -g pnpm@10.34.7
WORKDIR /repo
COPY . .
RUN --mount=type=secret,id=npmrc,target=/root/.npmrc \
    pnpm install --frozen-lockfile --filter @terrasight/web...
ENV NEXT_TELEMETRY_DISABLED=1
# Next.js fixes rewrites at build time: the API address the web server proxies /api/* to.
ARG API_URL=http://api:4000
ENV API_URL=${API_URL}
RUN pnpm turbo run build --filter=@terrasight/web...

FROM node:26-bookworm-slim
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1
WORKDIR /repo
COPY --from=build /repo /repo
WORKDIR /repo/apps/web
EXPOSE 3000
CMD ["npx", "next", "start", "-p", "3000"]
