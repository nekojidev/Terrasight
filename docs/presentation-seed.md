# Presentation database seed

`apps/api/scripts/seed-presentation.mjs` fills an empty local database for the hackathon presentation. It is a script
for a presentation database, not a product feature.

## What is real, what is a persona

| Part | Source |
| --- | --- |
| Company "Prairie Field Co.", Owner "Olena Kovalenko", Agronomist "Marko Shevchenko" (`@example.com`) | Persona (fictional) |
| The six fields | Real outlines in `data/presentation/fields/*.geojson` |
| History, weather, NDVI, soil, climate shift, rotations, year-set comparison, trust report, farm stress, recommendations | The product's own pipelines (NASA POWER, MODIS, USDA CDL, SSURGO / SoilGrids, simulator, evaluators, NASS) |
| A few human inputs: notes to the owner, the owner's answers, the current-season crop and sowing date, scouting counts | Typed in as the persona, short and plain |

The script never writes to the database. It calls the HTTP API like a user (cookie auth, `X-Requested-With`). It
invents no measurement and no model result. The sowing date is the product's own sowing suggestion for the crop that
the real history shows. Scouting counts are low (0 or 1 of 20 plants at five points). No pesticide products or doses.

## What it does

1. The owner signs up, creates the company (America/Chicago, imperial units, report language = `--lang`), adds the
   agronomist and takes the one-time setup link; the agronomist sets a password.
2. The agronomist adds Pivot 12, Pivot 14 (irrigated pivots near Garden City, KS), North quarter (dryland, Finney
   County), Kearny dryland (dryland, Kearny County), Черкаси and Миколаїв (Ukraine, rainfed), and confirms irrigation as in
   the outline files. It waits for each gather and history build.
3. "Analyze fields" runs and is awaited.
4. For every field: rotation run (default overrides), year-set comparison, climate shift and trust report. This warms the
   caches, so the screens open instantly.
5. Agronomist work: current-season record where the history supports it, 2026 plan on two fields, one accepted item,
   "Ask the owner" on up to three items (rotation changes first), one scouting check on a pest or disease item.
6. The owner approves one asked item and asks a question on another; the agronomist replies. The third asked item is left
   waiting, so the Decisions screen is alive.
7. One assistant question on North quarter ("Has the climate of this field changed?"). Skipped silently if the assistant
   is unavailable.

## Run

The local stack must be up and the owner's e-mail must not exist yet. The script does not need `AUTH_TEST_HOOKS` (the
agronomist's setup link is returned by the API).

```sh
node apps/api/scripts/seed-presentation.mjs --base http://localhost:4000 --out ~/terrasight-presentation.json
# trial runs: another company and e-mail each time
node apps/api/scripts/seed-presentation.mjs --base http://localhost:4000 --out /tmp/trial.json --suffix t2 --lang uk
```

Options: `--suffix x` (appended to the company name and e-mails), `--lang en|uk` (UI and report language).
Passwords are random; set `SEED_OWNER_PASSWORD` / `SEED_AGRONOMIST_PASSWORD` to choose them.

## Output and credentials

`--out` is a JSON file (mode 600) with the credentials, the workspace and field ids, the decisions and a `numbers`
section copied from the API responses: per field the climate shift (baseline, recent, delta, significant), the year-set
comparison (years, shift, ordered options with margin and drought, `bestChanges`), the trust report (`modelFlat`,
`vsCounty`, `vsNdvi`, `dryland.fit`, the 2012 and 2022 rows, missed years), the rotation headline (current vs
recommended, `if2022`) and the workspace's farm stress. Keep the file out of the repository. Stdout shows a short
summary without credentials.

## How long

With cached sources a field takes seconds. A cold gather (MODIS, Sentinel-2, SoilGrids, WaPOR) takes minutes per field;
fields gather in parallel. Plan 10 to 30 minutes for a first run on a cold cache, then a few minutes for the rest.
The script waits up to 25 minutes for the gathers.

## Re-running, and when a source is down

- If the owner's e-mail already exists, the script stops before creating anything. Use another `--suffix`, or wipe
  the company first.
- If a source fails, the other fields continue. The failure appears in the summary and under `findings` in the output
  file; fields with no history get no rotation, trust or recommendations. To fix it, retry the source on the field page
  ("Retry"), then use another `--suffix` for a full run once the source is back. Do not fill gaps by hand.
