#!/usr/bin/env node
// Record fixtures (S-09.02) for one workspace's fields: the real responses gathered for them are copied
// from source_cache into fixtures/<source>/<fixtureKey>.json (stable key, no date) and fixtures/forecast/<cell>.json.
// Fixtures are served only when a live call fails, labelled "cached" with their date. Never synthetic.
//
// Usage: node --env-file=../../.env scripts/record-fixtures.mjs <workspace-id>   (after a finished gather)
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { createAdapters, forecastCell } from "@terrasight/sources";

const root = join(dirname(fileURLToPath(import.meta.url)), "../../..");
const out = process.env.FIXTURES_DIR ?? join(root, "fixtures");
const sha = (s) => createHash("sha256").update(s).digest("hex");
const adapters = createAdapters({
  cdseClientId: process.env.CDSE_CLIENT_ID,
  cdseClientSecret: process.env.CDSE_CLIENT_SECRET,
  openetApiKey: process.env.OPENET_API_KEY,
});

const workspaceId = process.argv[2];
if (!workspaceId) throw new Error("usage: record-fixtures.mjs <workspace-id>");
const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
await db.connect();
const fields = (
  await db.query(
    `SELECT f.id, f.name, f.country, ST_AsGeoJSON(f.geom, 7) AS mp, ST_X(f.centroid) AS lon, ST_Y(f.centroid) AS lat,
            ST_XMin(f.geom) AS xmin, ST_YMin(f.geom) AS ymin, ST_XMax(f.geom) AS xmax, ST_YMax(f.geom) AS ymax
     FROM fields f JOIN workspaces w ON w.id = f.workspace_id WHERE w.id = $1 AND f.archived_at IS NULL`,
    [workspaceId],
  )
).rows;
if (!fields.length) throw new Error("no fields in that workspace");

let written = 0;
for (const f of fields) {
  const geom = {
    polygons: JSON.parse(f.mp).coordinates,
    centroid: { lon: f.lon, lat: f.lat },
    bbox: [f.xmin, f.ymin, f.xmax, f.ymax],
    country: f.country,
  };
  // The latest finished gather tells which cache row each source used.
  const tasks = (
    await db.query(
      `SELECT t.source, t.cache_key FROM gather_tasks t JOIN gather_jobs j ON j.id = t.job_id
       WHERE j.field_id = $1 AND t.cache_key IS NOT NULL ORDER BY j.started_at DESC`,
      [f.id],
    )
  ).rows;
  for (const adapter of adapters.filter((a) => a.appliesTo(geom))) {
    const task = tasks.find((t) => t.source === adapter.id);
    if (!task) {
      console.log(`  ${f.name} ${adapter.id}: no cached response, skipped`);
      continue;
    }
    const row = (await db.query("SELECT payload, origin FROM source_cache WHERE key = $1", [task.cache_key]))
      .rows[0];
    if (!row?.payload || row.origin === "fixture") continue;
    const key = sha(`${adapter.id}:${adapter.cacheKey(geom, { today: "fixture" })}`);
    mkdirSync(join(out, adapter.id), { recursive: true });
    writeFileSync(join(out, adapter.id, `${key}.json`), JSON.stringify(row.payload));
    written++;
  }
  const cell = forecastCell(f.lat, f.lon);
  const fc = (await db.query("SELECT payload FROM source_cache WHERE key = $1", [`forecast:${cell.key}`]))
    .rows[0];
  if (fc?.payload) {
    mkdirSync(join(out, "forecast"), { recursive: true });
    writeFileSync(join(out, "forecast", `${cell.key}.json`), JSON.stringify(fc.payload));
    written++;
  }
  console.log(`${f.name}: recorded`);
}
console.log(`${written} fixture files in ${out}`);
await db.end();
