# EP-02 Fields & history

**Goal:** a drawn field gets its sources, 18-season history, irrigation status and season record, with live progress.
**RFC:** D1, D2, D3 (§4–§6). **Tech Design:** §6.3–§6.4, §8.1, §13. **Design:** 13 AddField, 07 Fields, 08 Field.

### S-02.01 Add a field

| Priority | Points | RFC | Tech Design | Design | Depends on |
| --- | --- | --- | --- | --- | --- |
| P0 | 5 | D1 | §5.1, §14, §15.2 | 13 AddField | S-01.03, S-00.06 |

As an agronomist, I want to draw or upload a field boundary, so that Terrasight can analyse it.

**Acceptance criteria**

- Draw on a MapLibre map or upload GeoJSON / KML / zipped Shapefile; invalid or self-intersecting polygons are rejected with a message.
- `POST /fields/preview` returns area (workspace units), county ("Logan County, CO"), library region and tier before saving.
- Name and irrigated yes / no / don't know are entered; saving creates the field and its gather job in one transaction (outbox).
- A field outside every library region saves normally and later shows "No rotation library for this region yet".

### S-02.02 Reverse geocoding and region

| Priority | Points | RFC | Tech Design | Design | Depends on |
| --- | --- | --- | --- | --- | --- |
| P0 | 3 | §6.3, §14.1 | §6.3, §6.4 | 07 Fields | S-00.07 |

As an agronomist, I want each field placed in its county and agronomic region, so that the right library and labels apply.

**Acceptance criteria**

- `boundaries:load` loads Natural Earth admin-1 and admin-2 US counties into PostGIS; the field centroid yields ISO 3166-2, country and (US) county.
- Region matching follows file order. `boundaries:check` (API script) derives each point in `data/region-test-points.json` (≥ 1 per library region) from the loaded boundaries and reaches the expected region; e.g. Garden City → `us-southern-plains`, Chase County NE and Logan County CO → `us-central-high-plains`.
- Outdated Natural Earth ISO 3166-2 codes are mapped in `packages/library/admin-aliases.ts` (old → current); `rotations.json` is not edited.
- No external geocoding call is made to place a field (place search on the map uses a rate-limited Nominatim proxy).

### S-02.03 Source adapters

| Priority | Points | RFC | Tech Design | Design | Depends on |
| --- | --- | --- | --- | --- | --- |
| P0 | 8 | D1, D2 | §13 | — | S-00.04 |

As the system, I want one adapter per data source with caching and rate limits, so that gathering is reliable and cheap.

**Acceptance criteria**

- Adapters for NASA POWER, MODIS NDVI (Planetary Computer), USDA CDL (CropScape) and SSURGO are written from scratch (there is no PoC); Sentinel-2 (Copernicus Data Space Ecosystem, free account; Planetary Computer documented as fallback only), OpenET, SoilGrids and DEM are added. SMAP and GPM are P1.
- Each returns `done` / `partial` / `failed`, a payload, `dataDate` and attribution, with a 20 s timeout per request (task timeouts per source, Tech Design §7).
- Responses are stored in `source_cache` by key; historical data is reused, current-year data refreshed after 7 days.
- Per-source token buckets in Redis; a half-rate in-process limit when Redis is down.
- When a live call fails and a fixture exists, the fixture is served labelled `cached` with its date.

### S-02.04 Gather job with live progress

| Priority | Points | RFC | Tech Design | Design | Depends on |
| --- | --- | --- | --- | --- | --- |
| P0 | 5 | §4 (D1) | §7, §8.1 | 13 AddField | S-02.01, S-02.03, S-00.05 |

As an agronomist, I want to see each source load, so that I know what data the field has.

**Acceptance criteria**

- One task per source runs in parallel; statuses `queued` → `running` → `done` / `partial` / `failed` / `cached` stream over SSE.
- A failed source shows its reason ("SSURGO did not respond, soil data missing") and a **Retry** for that source.
- A second gather for the same field while one is active returns 409.

### S-02.05 Crop history and stress years

| Priority | Points | RFC | Tech Design | Design | Depends on |
| --- | --- | --- | --- | --- | --- |
| P0 | 5 | §6.1 | §5.1, §8.1 | 08 Field | S-02.04 |

As an agronomist, I want 18 seasons of crops, bare months and stress years, so that I see the field's past at a glance.

**Acceptance criteria**

- CDL majority class per season (US) with confidence (high when ≥ 70% of the field); NDVI crop groups outside the US labelled "Estimate".
- Bare months and stress years are computed and stored in `field_history`.
- History is built provisionally when weather, soil and crops have arrived, and rebuilt when the remaining sources finish.
- The 18-season strip on 08 shows crops in library colours with the source per season.

### S-02.06 Irrigation detection and confirmation

| Priority | Points | RFC | Tech Design | Design | Depends on |
| --- | --- | --- | --- | --- | --- |
| P0 | 3 | §6.2 | §5.1 | 08 Field | S-02.05 |

As an agronomist, I want irrigation detected and confirmable, so that scenarios use the right water rules.

**Acceptance criteria**

- US: OpenET ET vs POWER precipitation + soil storage; elsewhere: NDVI through dry summers.
- The detected status and confidence are shown; the agronomist confirms or changes it; low confidence asks directly before scenarios run.

### S-02.07 Current rotation match

| Priority | Points | RFC | Tech Design | Design | Depends on |
| --- | --- | --- | --- | --- | --- |
| P0 | 3 | §6.3 | §6.3 | 10 Rotation | S-02.05 |

As an agronomist, I want my current rotation recognised, so that alternatives are compared against it.

**Acceptance criteria**

- The last 4–6 seasons are matched with cyclic shifts against the region's baseline rotations; ≥ 75% match uses the baseline, otherwise "Detected from history".
- Double-crop seasons match only when both crops match.
- The agronomist can correct past crops (`crop_seasons.is_override`); corrections trigger a rebuild.

### S-02.08 Season record

| Priority | Points | RFC | Tech Design | Design | Depends on |
| --- | --- | --- | --- | --- | --- |
| P0 | 5 | §6.4 | §5.1 | 08 Field | S-02.05 |

As an agronomist, I want this season's crop and sowing date known, so that pest models can run.

**Acceptance criteria**

- Values follow the source order: confirmed by the agronomist → saved plan → NDVI estimate → regional typical date → unknown; each value shows its source.
- The agronomist can edit crop, sowing date, emergence date, irrigated and tillage for the current season.
- Missing values make dependent evaluators return `unknown` and list what is missing.
