# syntax=docker/dockerfile:1.7
# Terrasight API (all roles). Build from the repo root:
#   docker build -f infra/api.Dockerfile -t terrasight-api .
# Uses the public npm registry unless an .npmrc is passed as a build secret:
#   docker build --secret id=npmrc,src=$HOME/.npmrc -f infra/api.Dockerfile .
FROM node:26-bookworm-slim AS build
RUN npm install -g pnpm@10.34.7
WORKDIR /repo
COPY . .
RUN --mount=type=secret,id=npmrc,target=/root/.npmrc \
    pnpm install --frozen-lockfile --filter @terrasight/api...
RUN pnpm turbo run build --filter=@terrasight/api...

FROM node:26-bookworm-slim
ENV NODE_ENV=production
WORKDIR /repo
COPY --from=build /repo /repo
WORKDIR /repo/apps/api
EXPOSE 4000
# Apply migrations, then start. ROLE selects api / worker / scheduler / all.
CMD ["sh", "-c", "npx prisma migrate deploy && node --enable-source-maps dist/main.js"]
