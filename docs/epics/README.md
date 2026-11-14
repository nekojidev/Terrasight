# Terrasight — Epics and stories

Backlog for the build described in [`../03-tech-design.md`](../03-tech-design.md). One file per epic; each epic holds its stories with acceptance criteria.

## Order (P0 path)

| # | Epic | Goal | Stories | Points |
| --- | --- | --- | --- | --- |
| EP-00 | [Foundation](EP-00-foundation.md) *(enabler)* | Repo, CI, local stack, schema, messaging, design system | 7 | 26 |
| EP-01 | [Onboarding & workspace](EP-01-onboarding-workspace.md) | Sign in, create the company, roles, invite the owner, demo company | 6 | 21 |
| EP-02 | [Fields & history](EP-02-fields-history.md) | Add a field, gather sources, 18-season history, season record | 8 | 37 |
| EP-03 | [Analysis runs & evaluators](EP-03-analysis-evaluators.md) | 06:00 run + Analyze fields, forecast, 3 verified demo models | 8 | 37 |
| EP-04 | [Morning brief](EP-04-morning-brief.md) | Urgency, hero, Accept / Snooze with 8 s Undo, field brief, Fields page | 8 | 34 |
| EP-05 | [AI assistant](EP-05-assistant.md) | Gemini with tools, number check, safety filter, panel and page | 7 | 34 |
| EP-06 | [Rotation planner](EP-06-rotation-planner.md) | 5-season scenarios, prices, Save to the 2026 plan | 7 | 34 |
| EP-07 | [Scouting](EP-07-scouting.md) | W-route task on a phone, photos, Send, result as evidence | 5 | 18 |
| EP-08 | [Owner report](EP-08-owner-report.md) | Report items, report link, one-tap answers, reply drafts | 6 | 20 |
| EP-09 | [Demo readiness](EP-09-demo-readiness.md) *(enabler)* | Demo host, fixtures, seed, E2E, performance, demo script, laptop fallback | 6 | 18 |
| | **Total** | | **68** | **279** |
| — | [Later (P1 / P2)](later.md) | Zones & yield, offline scouting, notifications, dark theme, replay, work log, integrations; hackathon simplifications to undo (L-18–L-22) | — | — |

EP-00 starts first and runs alongside EP-01. Two cross-order dependencies: the rotation item in the brief (S-03.08) and the field brief (S-04.07) need the scenario engine (S-06.03), so S-06.01–S-06.03 start in parallel with EP-03; the demo company copy (S-01.06) needs the seed (S-09.03). EP-09 runs in the last hours but its fixtures story (S-09.02) should start as soon as the source adapters exist.

## Conventions

- **IDs:** epics `EP-NN`; stories `S-NN.MM` (epic number + story number). Later items `L-NN`.
- **Priority:** P0 (P0 path, must work for the demo), P1 (in the hackathon if time), P2 (later). From the product definition §9.
- **Points:** Fibonacci 1, 2, 3, 5, 8. Anything bigger is split.
- **Links:** every story names its RFC section (behaviour), Tech Design section (how) and design screen (`design/screens/NN-*.png`) where there is one.
- **Status:** tracked in the issue tracker, not in these files. These files hold scope and acceptance criteria; change them through a PR.

## Story template

```markdown
### S-NN.MM Title

| Priority | Points | RFC | Tech Design | Design | Depends on |
| --- | --- | --- | --- | --- | --- |
| P0 | 3 | §x.y | §x.y | NN Screen | S-NN.MM |

As a <role>, I want <capability>, so that <outcome>.

**Acceptance criteria**

- Given …, when …, then …
- …
```

## Definition of done

- Acceptance criteria pass; tests at the levels named in Tech Design §16 are written and green in CI.
- UI matches the design screen, uses only `design/tokens.css` variables and `design/i18n` copy in UA and EN.
- Copy rules hold: "Owner report", "5 years / 2026–2030", no product names or doses.
- Permissions follow Tech Design §14.1; workspace isolation is tested for new queries.
- No secrets in code; new env vars are listed in Tech Design §17.
