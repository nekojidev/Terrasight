# Later (P1 / P2)

Not in the P0 path. Each item names what must already exist so it can be added without a redesign. Promote an item to an epic file when it is planned.

| ID | Item | Priority | Hackathon | RFC / PD | Design | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| L-01 | **Zones & yield tab (static mock)** | P1 | Static mock | PD FR-ZN-1, FR-YF-1 | 11 Zones | Render 11 from demo data, clearly labelled as an example; no computation |
| L-02 | Stable zones from Sentinel-2 + Landsat (≥ 5 seasons), layer switch | P1 | No | PD FR-ZN-1, FR-ZN-2 | 11 Zones | Needs a per-season NDVI percentile job; zone areas sum to the field area |
| L-03 | Yield range P10 / P50 / P90 from the simulator, with known pest losses in P10 | P1 | No | PD FR-YF-1 | 11 Zones | Needs a pest-loss term in the simulator (RFC D4 extension) |
| L-04 | Offline scouting (service worker, queued entries, no duplicates) | P1 | No | PD FR-SC-2, RFC §10.7 | 12 Scout, 17 States | Client ids already used by S-07.04 make replays safe |
| L-05 | Scouting result changes the risk level (observed beats modelled) | P1 | No | PD FR-SC-3, RFC §10.7 | 09 Rec | Needs verified `scoutAction` thresholds per pest |
| L-06 | Notifications bell (owner questions, new Urgent items, finished checks) | P2 | Design only | RFC §15.4 | top bar | In-app only; no email or push in v2 |
| L-07 | Dark theme | P2 | Design only | PD decision 14 | 06 MainMobileDark | Tokens already in `design/tokens.css` |
| L-08 | Replay "as of" a past date, archived forecasts, backtesting | P2 | No | RFC §10.6 | banner | Evaluators already take `asOf` |
| L-09 | Work log per field | P1 | Mock in design | PD FR-LOG-1 | 11 Zones | Merge assistant runs, owner replies, agronomist entries |
| L-10 | Rate-map export (Shapefile, later ISOXML), rates entered by the agronomist | P2 | No | PD FR-ZN-3 | — | Never suggests rates |
| L-11 | John Deere Operations Center import | P2 | "Coming soon" | PD FR-INT-1 | 11 Zones | Shown only as "Coming soon" |
| L-12 | Public read-only API | P2 | "Coming soon" | PD FR-INT-2 | 11 Zones | Shown only as "Coming soon" |
| L-13 | More evaluators: diseases (`weather_window`), irrigation timing (`water_stress`), sowing and cover-crop windows, weather alerts | P1 | No / design | PD §5, RFC §11.2 | — | Each needs verified thresholds |
| L-14 | Rootworm egg-hatch timing (`degree_days` on soil temperature) | P1 | No | RFC §11.4 | 09 Rec | Spring; soil-temperature proxy to verify |
| L-15 | Threshold tuning from outcomes | P2 | No | RFC §15.3 | — | Outcomes are stored with model versions from day one |
| L-16 | Assigning agronomists to fields; scouting by farm staff via link | P2 | No | PD decision 6 | — | |
| L-17 | Production infrastructure (ECS, RDS, Amazon MQ, ElastiCache) | P2 | No | — | — | Tech Design §17 |

## Hackathon simplifications to undo (Tech Design §1.1)

| ID | Item | Priority | Hackathon | Tech Design | Notes |
| --- | --- | --- | --- | --- | --- |
| L-18 | Terraform for the demo / production infrastructure | P2 | Set up by hand | §1.1, §17 | Replaces the manual EC2, S3, IAM, DNS setup (S-09.01) |
| L-19 | OpenTelemetry traces and metrics | P2 | pino logs only | §1.1, §17 | Run duration, field statuses, source failures, number-check fallback rate, commit latency |
| L-20 | Screenshot diff for Storybook against design PNGs | P2 | Storybook only | §1.1, §16 | Applies to `packages/ui` (S-00.06) |
| L-21 | Postman contract tests for every endpoint | P1 | P0 endpoints only | §1.1, §14, §16 | Full permission-matrix coverage (S-01.03) |
| L-22 | Testcontainers integration tests for all pipelines | P1 | Analysis pipeline, commit / Undo race, partial unique indexes only | §1.1, §16 | Adds gather, history, scenarios, outbox with a real broker (S-00.04) |
