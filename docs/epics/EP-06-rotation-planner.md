# EP-06 Rotation planner

**Goal:** the current rotation and 2 alternatives over 5 seasons, explained, with a decision for 2026.
**RFC:** D4, D5 (§7, §8), §9. **Tech Design:** §6.2, §9. **Design:** 10 Rotation.

### S-06.01 Port the simulator

| Priority | Points | RFC | Tech Design | Design | Depends on |
| --- | --- | --- | --- | --- | --- |
| P0 | 5 | §7.1 | §9.1 | — | S-00.01 |

As a developer, I want the PoC simulator in `packages/simulator` with its tests, so that we start from tested science.

**Acceptance criteria**

- FAO-56 water balance, FAO-33 Ky, SCS-CN, relative RUSLE index and ICBM moved with their PoC tests green before any change.
- Double cropping: `main` then `second` in one season on their own calendars, soil water carried over (new tests).
- Deficit irrigation under a water cap follows `1 − Ya/Ym = Ky × (1 − ETa/ETc)`.

### S-06.02 Weather and price scenarios

| Priority | Points | RFC | Tech Design | Design | Depends on |
| --- | --- | --- | --- | --- | --- |
| P0 | 5 | §7.3, §7.4, §7.7 | §9.1 | — | S-06.01, S-02.03 |

As the system, I want reproducible weather and price runs, so that the same inputs always give the same answer.

**Acceptance criteria**

- 150 block-bootstrap runs of 5 seasons from POWER 1981–2025 with 2–3-year blocks cut at 1 January (north) or 1 July (south); seeded PCG32.
- "If 2022 repeats": 2022 placed in each year 1–5, worst reported separately.
- 10 price scenarios (±20%, shared grain factor, scenario 0 = base) applied after the weather step.
- Same inputs → identical output (test).

### S-06.03 Scenario engine

| Priority | Points | RFC | Tech Design | Design | Depends on |
| --- | --- | --- | --- | --- | --- |
| P0 | 8 | §8 | §9.1 | 10 Rotation | S-06.02, S-02.07, S-06.05 |

As an agronomist, I want 2 different alternatives scored against my current rotation, so that I see real trade-offs.

**Acceptance criteria**

- Pipeline: region library → filters (irrigation, precipitation, season length, slope) → FAO-56 quick pass → Monte Carlo → price step → score (margin, water, soil, drought CVaR-10 as differences) → pick 2 different alternatives (RFC §8.3); relaxation precipitation → slope.
- Exactly 5 seasons, no padding; current rotation continues from its position, alternatives start at year 1.
- Pest pressure per scenario (host repeats, short intervals) shown under Risks, not scored.
- Runs in a worker-thread pool, cached by inputs hash; < 5 s per field on the demo host.
- No library region → "No rotation library for this region yet".

### S-06.04 Rotation screen

| Priority | Points | RFC | Tech Design | Design | Depends on |
| --- | --- | --- | --- | --- | --- |
| P0 | 5 | §7.7, §9 | §15.2 | 10 Rotation | S-06.03, S-00.06 |

As an agronomist, I want the decision first and the evidence below, so that I can decide for next season.

**Acceptance criteria**

- Ink banner "Recommended for 2026: <crop>" (or "Your choice for 2026" after picking another option) with the lime **Save to the 2026 plan**.
- Priority picker re-ranks in the browser (< 50 ms); 3 option cards with 5-tile SeasonStrips; why / what to check.
- Cumulative margin 2026–2030 with yearly points (sum of the 5 simulated years, no extrapolation); "If 2022 repeats"; all-numbers table; soil carbon and erosion as trends.
- Everything says "5 years / 2026–2030"; regions marked `verify` show "Library not yet reviewed for this region".

### S-06.05 Prices file for the demo regions

| Priority | Points | RFC | Tech Design | Design | Depends on |
| --- | --- | --- | --- | --- | --- |
| P0 | 3 | §16 | §6.2, §20 | 10 Rotation | S-00.07 — **done before EP-06 starts** |

As the team, I want sourced prices and costs, so that margins are believable.

**Acceptance criteria**

- The team fills `data/prices.json` **before EP-06 starts**: every crop used in `us-southern-plains` and `us-central-high-plains` has a price from **USDA NASS prices received (2025 average)**, a variable cost from **K-State crop budgets** and a reference yield, with `source` and `asOf` per crop.
- Other regions fall back to FAOSTAT producer prices, labelled "Estimate"; a CI check lists crops with neither.
- The price date is shown on the rotation screen.

### S-06.06 Save to the plan

| Priority | Points | RFC | Tech Design | Design | Depends on |
| --- | --- | --- | --- | --- | --- |
| P0 | 3 | §6.4, §20 (plan) | §5.1 | 10 Rotation | S-06.04 |

As an agronomist, I want to save my choice for 2026, so that it feeds the season record and the Owner report.

**Acceptance criteria**

- **Save to the 2026 plan** stores the crop and rotation in `plans`; the season record uses it as source "From plan".
- No Owner approval step; sharing happens through the Owner report.
- Viewers can explore scenarios but can't save.

### S-06.07 Climate sliders and water cap

| Priority | Points | RFC | Tech Design | Design | Depends on |
| --- | --- | --- | --- | --- | --- |
| P1 | 5 | §7.5, §7.6 | §9.1 | 10 Rotation | S-06.03 |

As an agronomist, I want to test +°C, −% rain and a water cap, so that I see how robust each option is.

**Acceptance criteria**

- Climate sliders re-run the full simulation (2–5 s); the water cap re-runs deficit irrigation for affected options (1–3 s); results cached by inputs hash.
- Options over the cap show "exceeds cap" with the extra loss; the cap never filters.
