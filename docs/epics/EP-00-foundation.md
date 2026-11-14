# EP-00 Foundation (enabler)

**Goal:** a repository, local stack and CI that every other epic builds on.
**Tech Design:** §2–§5, §7, §15.3, §16, §17.

### S-00.01 Monorepo and CI

| Priority | Points | RFC | Tech Design | Design | Depends on |
| --- | --- | --- | --- | --- | --- |
| P0 | 3 | — | §3, §16 | — | — |

As a developer, I want one repository with shared tooling, so that web, api and packages build and test the same way.

**Acceptance criteria**

- pnpm workspaces + Turborepo with `apps/web`, `apps/api` and the packages listed in Tech Design §3 (empty packages export a placeholder).
- `pnpm lint`, `pnpm typecheck`, `pnpm test` run from the root; TypeScript strict everywhere.
- GitHub Actions runs lint → typecheck → unit → library checks on every PR; `tools/build_rotations_v2.py --check` is one of the library checks.

### S-00.02 Local stack with docker compose

| Priority | Points | RFC | Tech Design | Design | Depends on |
| --- | --- | --- | --- | --- | --- |
| P0 | 3 | D2 | §17 | — | S-00.01 |

As a developer, I want PostGIS, RabbitMQ and Redis running locally with one command, so that I can run the full app.

**Acceptance criteria**

- `docker compose up` starts PostgreSQL 16 + PostGIS 3, RabbitMQ 3.13 (management UI), Redis, api (`ROLE=all`) and web.
- `.env.example` lists every variable from Tech Design §17; the app starts without Redis and logs that it runs in fallback mode.
- `/healthz` and `/readyz` respond; `/readyz` fails when PostgreSQL or RabbitMQ is down and passes without Redis.

### S-00.03 Database schema and migrations

| Priority | Points | RFC | Tech Design | Design | Depends on |
| --- | --- | --- | --- | --- | --- |
| P0 | 5 | §5.5 | §5 | — | S-00.02 |

As a developer, I want the data model in Prisma with PostGIS columns, so that modules can store their state.

**Acceptance criteria**

- `prisma/schema.prisma` covers the tables in Tech Design §5.1; PostGIS columns and GIST indexes are created by SQL migrations.
- Partial unique indexes from Tech Design §5.2 exist and are covered by Testcontainers integration tests (second active gather job / field check / live recommendation is rejected) — one of the three integration suites kept in the hackathon (Tech Design §1.1).
- A Prisma middleware rejects queries on workspace-scoped tables without `workspace_id`; a test proves it.

### S-00.04 Messaging: exchanges, outbox, consumers

| Priority | Points | RFC | Tech Design | Design | Depends on |
| --- | --- | --- | --- | --- | --- |
| P0 | 5 | §5.1, §5.3 | §7 | — | S-00.03 |

As a developer, I want a tested job and event backbone, so that pipelines don't lose work.

**Acceptance criteria**

- Exchanges and queues from Tech Design §7 are declared at start-up (idempotently), including `retry.5s`, `retry.30s`, `commit.8s` and the dead-letter queue.
- A transactional outbox relay publishes rows and marks them; stopping RabbitMQ and restarting it publishes the backlog with no loss (unit test with a fake broker in the hackathon; Testcontainers test later, L-22).
- A consumer base class handles message ids, retries with back-off, dead-lettering and structured logs.

### S-00.05 SSE event stream

| Priority | Points | RFC | Tech Design | Design | Depends on |
| --- | --- | --- | --- | --- | --- |
| P0 | 3 | §5.3 | §7, §14 | — | S-00.04 |

As a user, I want live updates in the browser, so that progress and new items appear without reloading.

**Acceptance criteria**

- `GET /api/w/:ws/events?topics=…` streams events for the user's workspace only; on connect it first sends the current state for each topic.
- The web SSE client reconnects with back-off and invalidates the matching TanStack Query keys; when SSE fails it falls back to polling every 5 s.
- Works behind Caddy (no buffering; heartbeat every 15 s).

### S-00.06 Design system components

| Priority | Points | RFC | Tech Design | Design | Depends on |
| --- | --- | --- | --- | --- | --- |
| P0 | 5 | — | §15.1, §15.3 | 17 States, all screens | S-00.01 |

As a developer, I want the design-system components ready, so that screens are assembled from tested parts.

**Acceptance criteria**

- Tailwind maps every variable in `design/tokens.css`; a lint rule forbids hex colours in components.
- `packages/ui` has Button, Chip, HeroItem, QueueRow, BigNumber, FactorRows, SeasonStrip, FieldThumb, RailCard, AnalysisPanel, BottomSheet, Nav, Skeleton, ErrorCard, DoneRow, EmptyState with the variants in design/README §3, each in Storybook (no screenshot diff in the hackathon; later, L-20).
- next-intl messages are generated from `design/i18n/*.json` (UA and EN); a CI check fails on keys missing in one language.
- Focus ring, 44 px targets and reduced motion follow design/README §5.

### S-00.07 Library package

| Priority | Points | RFC | Tech Design | Design | Depends on |
| --- | --- | --- | --- | --- | --- |
| P0 | 2 | §6.3, §11.1 | §6 | — | S-00.01 |

As a developer, I want typed loaders for the library files, so that every module reads the same validated data.

**Acceptance criteria**

- `packages/library` loads `rotations.json`, `pests.json`, `pest-models.json`, `prices.json` with zod schemas and exposes each file's content hash as its version.
- `matchRegion(adminCode, lat, lon)` passes every point in `data/region-test-points.json` (one or more per library region), the same file the Python validator uses.
- The api refuses to start when a library file is invalid, with a clear error.
