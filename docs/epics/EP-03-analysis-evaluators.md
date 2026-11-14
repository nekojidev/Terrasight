# EP-03 Analysis runs & evaluators

**Goal:** every field is checked at 06:00 and on demand; the 3 verified demo models produce recommendations with evidence.
**RFC:** §10.2, §10.3, §11, §13. **Tech Design:** §6.1, §8.2, §8.3, §10.1, §13. **Design:** 04 Main (AnalysisPanel), 17 States.

### S-03.01 Forecast service

| Priority | Points | RFC | Tech Design | Design | Depends on |
| --- | --- | --- | --- | --- | --- |
| P0 | 5 | §13 | §8.3, §13 | 04 Main (rail) | S-02.03 |

As the system, I want a forecast per grid cell with a fallback chain, so that windows and frost dates are available.

**Acceptance criteria**

- Open-Meteo forecast and recent observed days per 0.1° cell, cached 6 h; NWS as the US fallback; then the last cached forecast with its age; then none.
- NWS requests send a generic application User-Agent with no personal contact.
- Next frost per county is derived for the brief's rail; days 8–10 are marked uncertain.
- Open-Meteo attribution is returned with the data.

### S-03.02 Analysis runs: schedule and manual

| Priority | Points | RFC | Tech Design | Design | Depends on |
| --- | --- | --- | --- | --- | --- |
| P0 | 5 | §10.2 | §8.2 | 04 Main | S-00.04, S-01.02 |

As an agronomist, I want all fields checked at 06:00 and whenever I click **Analyze fields**, so that the brief is current.

**Acceptance criteria**

- The scheduler (advisory lock, single instance) starts one `schedule` run per workspace after 06:00 local time, once per day; missed runs after a restart are caught up.
- `POST /analysis-runs {fieldIds?}` starts a manual run for all or selected fields; a field already being checked is attached to that check.
- One `field.check` per field; each field's status `waiting` → `running` → `ok` / `stale` / `failed` streams on `workspace.<id>.analysis`.
- A Testcontainers integration test runs a full analysis run with fixtures (one of the three integration suites kept in the hackathon).

### S-03.03 Field check pipeline

| Priority | Points | RFC | Tech Design | Design | Depends on |
| --- | --- | --- | --- | --- | --- |
| P0 | 5 | §10.2 | §8.2 | — | S-03.02, S-03.01, S-02.08 |

As the system, I want each field check to refresh data and run the season's evaluators, so that recommendations reflect today.

**Acceptance criteria**

- Refresh per grid cell (POWER recent days, Open-Meteo recent observed days and forecast, NDVI when a new composite exists).
- Only evaluators whose `stageWindow` matches the season state run (November: autumn checks).
- A failed source sets `stale` with the last good data date; no usable data sets `failed`.
- Results upsert recommendations (one live per field / type / subject / season) and append to the level history.

### S-03.04 Run summary, panel and retry

| Priority | Points | RFC | Tech Design | Design | Depends on |
| --- | --- | --- | --- | --- | --- |
| P0 | 3 | §10.2 | §8.2 | 04 Main, 17 States | S-03.03, S-00.06 |

As an agronomist, I want to see each field's progress and what failed, so that I can trust or retry the result.

**Acceptance criteria**

- While a run is active, the AnalysisPanel lists every field (waiting / running / done / **No data**) with an overall progress bar and "what we check in November".
- The summary reads like "7 of 8 fields checked. Pivot 21: NASA POWER didn't respond — showing yesterday's data"; **Retry** re-runs only that field.
- The brief header shows the last run's time and summary; the panel has `aria-live`.

### S-03.05 Evaluator kinds and combinators

| Priority | Points | RFC | Tech Design | Design | Depends on |
| --- | --- | --- | --- | --- | --- |
| P0 | 5 | §11.2 | §10.1 | — | S-00.07 |

As a developer, I want the evaluator kinds as pure functions, so that pest models are data, not code.

**Acceptance criteria**

- `host_repeat`, `degree_days`, `climate_anomaly`, `green_bridge` and combinators `all`, `any`, `max`, `gate` are implemented for the hackathon; `host_interval`, `weather_window`, `water_stress` have stubs returning `unknown`.
- Each returns level, deadline, irreversible, planning, key numbers, drivers, evidence, unknowns; `unknown` is never mapped to `low`.
- The confidence rule (tier, −1 per estimated input, pest/disease capped at medium until scouted) is unit-tested.
- Inputs are hashed and stored as `input_snapshots`.

### S-03.06 `pest-models.json` and the verification gate

| Priority | Points | RFC | Tech Design | Design | Depends on |
| --- | --- | --- | --- | --- | --- |
| P0 | 3 | §11.1, §11.3 | §6.1 | — | S-00.07 |

As the team, I want models to run only with verified, cited thresholds, so that no unchecked number reaches a user.

**Acceptance criteria**

- JSON Schema for `pest-models.json` as in Tech Design §6.1; CI fails when an `enabled` model has any threshold with `verified: false` or no source.
- The api loads only enabled models; the others are "library only".
- The citation (title, publisher, URL) is part of each recommendation's evidence.

### S-03.07 Verify and enable the 3 demo models

| Priority | Points | RFC | Tech Design | Design | Depends on |
| --- | --- | --- | --- | --- | --- |
| P0 | 8 | §11.3, §11.4 | §6.1 | 09 Rec | S-03.05, S-03.06 |

As the team, I want the demo models verified from extension publications, so that the demo shows real, cited risks.

**Acceptance criteria**

- Rootworm (`host_repeat`, a 2026 planning item), BYD with aphids (`climate_anomaly` + `degree_days` base 3 °C from emergence), wheat streak mosaic (`green_bridge` + `climate_anomaly`) have every threshold filled from K-State, UNL or Colorado State extension sources, with `verifiedBy` and, if available, a local agronomist as reviewer.
- Each model is enabled only after its thresholds pass the gate.
- Fixture tests: Pivot 12 → rootworm planning item; Pivot 14 → BYD/aphids with a frost deadline; the Logan County field → wheat streak mosaic risk with the 10 m NDVI limit listed under "not known".

### S-03.08 Rotation recommendation item

| Priority | Points | RFC | Tech Design | Design | Depends on |
| --- | --- | --- | --- | --- | --- |
| P0 | 3 | §10.2 | §9.2 | 04 Main, 08 Field | S-06.03 |

As an agronomist, I want the rotation suggestion in the brief as a planning item, so that I see it next to in-season work.

**Acceptance criteria**

- After the history build and every autumn recompute, a `rotation` recommendation is upserted with the best-fit option, key numbers (Tech Design §9.2) and a planning deadline (agronomist-set; default the next crop's typical sowing date).
- It is `planning: true`, so urgency keeps it under All good until 14 days before the deadline.
