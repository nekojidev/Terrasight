# Terrasight

A decision-support web app that helps agronomists and farmers choose a 10-year crop rotation for a specific field, using 18 seasons of NASA / USDA / ESA data.
Built for NASA Space Apps Challenge 2026, challenge _"Field Shift: Adapting Farms with NASA Data"_.

## How we work

We build this project in three documented stages. Each one builds on the stage before it:

1. **Product Definition** — `docs/01-product-definition.md` — what we build and why ✅ draft done
2. **RFC** — `docs/02-rfc.md` — proposed solution, alternatives, trade-offs, decisions ⏳ next
3. **Tech Design** — `docs/03-tech-design.md` — architecture, data model, API, modules, testing, deploy

Rules:

- Read `docs/01-product-definition.md` before any work. It is the source of truth for scope, users and priorities (P0–P3).
- Do not start code until the Tech Design is agreed.
- Before writing a new doc, list the open questions from the previous one and ask me to resolve them.
- Docs are Markdown in `docs/`, written in English, with tables for comparisons and Mermaid for diagrams.

## Tech stack (planned)

- Frontend: Next.js (App Router), React, TypeScript, MapLibre GL
- Backend: NestJS (Node.js, TypeScript)
- Data: PostgreSQL + PostGIS, Prisma, Redis (cache, queues)
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
  - uncertainty: Monte Carlo, 150 weather years × 10 price scenarios (±20%)
- Economics:
  - gross margin = revenue − variable costs; no rent, depreciation or subsidies
  - decisions rest on the difference vs the current rotation, plus price robustness
- Roles per farm workspace: Owner, Admin, Editor, Viewer. Platform admin is internal to Terrasight.
- Demo field: a pivot-irrigated field near Garden City, Kansas (2022 = record drought).

## Existing assets (not in this folder yet)

- A Next.js proof of concept with live NASA POWER, MODIS, CDL and SSURGO calls and a tested rotation simulator
- 12-screen UI design (UA / EN), palette "Clean agritech": primary #0F766E; Onest font
