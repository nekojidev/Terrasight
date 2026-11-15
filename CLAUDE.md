# Terrasight

An AI assistant for agronomists: daily, explained recommendations per field (pest and disease risk, irrigation, sowing windows, alerts) plus 5-season crop rotation planning (2026–2030; the headline is the decision for next season), using 18 seasons of NASA / USDA / ESA data. The farmer gets a simple shared report.
Built for NASA Space Apps Challenge 2026, challenge _"Field Shift: Adapting Farms with NASA Data"_.

## How we work

We build this project in three documented stages. Each one builds on the stage before it:

1. **Product Definition** — `docs/01-product-definition.md` — what we build and why ✅ v2.6 (no demo or example data in the product) (AI assistant for agronomists; competitors in `docs/competitor-eos.md`), open questions resolved
2. **RFC** — `docs/02-rfc.md` — proposed solution, alternatives, trade-offs, decisions ⏳ v2.2 draft in review (open questions in §19)
   - **Design** — `design/` (v4 "Morning brief", 17 screens) ✅ handed off; see "Design" below
3. **Tech Design** — `docs/03-tech-design.md` — architecture, data model, API, modules, testing, deploy ✅ v1.1 agreed; backlog in `docs/epics/`

Build: epic by epic in P0-path order (`docs/epics/README.md`). EP-00 … EP-08 ✅ (S-04.05/S-04.08 are P1), EP-09 ✅ except the public host (files in `infra/prod/`, runbook `docs/runbook-demo-host.md`; the team deploys). No demo company or example data in the product (v2.6); fixtures (real recorded responses): `scripts/record-fixtures.mjs <workspace-id>`; E2E: `apps/e2e` (Cypress); demo script: `docs/demo-script.md`.

Rules:

- Read `docs/01-product-definition.md` before any work. It is the source of truth for scope, users and priorities (P0–P3).
- Do not start code until the Tech Design is agreed.
- Before writing a new doc, list the open questions from the previous one and ask me to resolve them.
- Docs are Markdown in `docs/`, written in English, with tables for comparisons and Mermaid for diagrams.

## Design

Design source: `design/README.md` (screens, components, behaviour), `design/tokens.css` (all colours, type, spacing, motion — no hard-coded hex), `design/i18n/*.json` (UI copy UA/EN), `design/screens/*.png` (visual reference). `docs/02b-design-spec.md` is obsolete.

## Code

- Monorepo: pnpm + Turborepo. Node 26 (`.nvmrc`). `apps/web` (Next.js), `apps/api` (NestJS), `packages/*` (shared, library, ui, …).
- Local stack: `docker compose -f infra/docker-compose.yml up` (PostGIS, RabbitMQ, Redis, api, web). Redis is optional.
- Checks: `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build`, `pnpm library:check`, `pnpm i18n:check`; integration (Testcontainers): `pnpm test:integration`.
- npm installs go through the user's CodeArtifact mirror (global `~/.npmrc`); Docker builds take it as a build secret (`--secret id=npmrc,src=$HOME/.npmrc`).

## Tech stack

- Frontend: Next.js (App Router), React, TypeScript, MapLibre GL
- Backend: NestJS (Node.js, TypeScript)
- Data: PostgreSQL + PostGIS (source of truth), Prisma, RabbitMQ (jobs, progress events), Redis (hot cache, rate limits, revocation-check cache; optional, never the source of truth). Auth: 15-min JWT in httpOnly cookie + refresh tokens in PostgreSQL
- Infra: AWS
- Tests: Jest / Vitest, Cypress
- UI languages: Ukrainian + English

## Key domain facts

- Data sources:
  - NASA: POWER (weather, from 1981), MODIS NDVI (from 2000), SMAP, GPM
  - USDA: CDL (crop per year, US, 2008+), SSURGO (soil), NASS / AMS (yields, prices)
  - Other: OpenET (water use), SoilGrids and Sentinel-2 (global)
- Data tiers:
  - A "Full data" = US
  - B "Basic data" = EU
  - C "Estimate" = global, incl. Ukraine
- Models:
  - water balance and drought yield loss: FAO-56 and FAO-33 (Ky)
  - runoff and erosion: SCS-CN and a relative RUSLE index
  - soil carbon: ICBM
  - uncertainty: Monte Carlo, 150 weather runs (5-season block-bootstrap paths) × 10 price scenarios (±20%)
- Rotation horizon: 5 seasons (2026–2030), recomputed every autumn. Never "10 years".
- Economics:
  - gross margin = revenue − variable costs; no rent, depreciation or subsidies
  - decisions rest on the difference vs the current rotation, plus price robustness
- Rotation library: `data/rotations.json` v2 (113 rotations, 24 regions, 34 countries; region match rules, double cropping, southern hemisphere). Rebuild and validate with `python3 tools/build_rotations_v2.py` (`--check` in CI).
- Pest and disease library: `data/pests.json` (62 entries, EN/UA). Risk, not diagnosis; never pesticide products or doses. A model threshold is used only after it is verified against a cited source.
- AI assistant: Google Gemini API with function calling over our tools; every number in an answer must match a tool result.
- Forecast: Open-Meteo (paid), NOAA NWS as US fallback.
- One workspace = one farming company with many fields, possibly in several regions. Roles: Owner, Agronomist (the Owner answers decisions and manages users; the Agronomist does the field work and asks the owner). Platform admin is internal to Terrasight.
- All fields are re-checked every morning at 06:00 and on demand ("Analyze fields"); checks depend on the season.
- Demo field: a pivot-irrigated field near Garden City, Kansas (2022 = record drought).

## Existing assets (not in this folder yet)

- No proof of concept exists (confirmed 2026-11-14): source adapters and the simulator are written from scratch in `packages/sources` and `packages/simulator`.
- UI design: `design/` (v4 "Morning brief", 17 screens UA / EN; see "Design" above). Replaces the old "Clean agritech" palette (#0F766E)
