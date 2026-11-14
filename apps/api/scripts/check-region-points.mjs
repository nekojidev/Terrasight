#!/usr/bin/env node
// S-02.02: every point in data/region-test-points.json, geocoded through the loaded Natural Earth boundaries
// (not the code written in the file), must reach its expected library region. Needs `boundaries:load` first.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { loadLibrary, matchRegion } from "@terrasight/library";

const data = fileURLToPath(new URL("../../../data/", import.meta.url));
const lib = loadLibrary(data);
const { points } = JSON.parse(readFileSync(`${data}region-test-points.json`, "utf8"));
const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();
let failed = 0;
for (const p of points) {
  const r = await client.query(
    "SELECT code FROM admin_areas WHERE ST_Contains(geom, ST_SetSRID(ST_MakePoint($1, $2), 4326)) LIMIT 1",
    [p.lon, p.lat],
  );
  const code = r.rows[0]?.code ?? null;
  const got = code ? matchRegion(lib.rotations, code, p.lat, p.lon) : null;
  const ok = got === p.region;
  if (!ok) failed++;
  console.log(
    `${ok ? "ok  " : "FAIL"} ${p.name.padEnd(48)} ${String(code).padEnd(8)} → ${got} ${ok ? "" : `(expected ${p.region})`}`,
  );
}
await client.end();
console.log(failed ? `${failed} point(s) failed` : `all ${points.length} points reach their region`);
process.exit(failed ? 1 : 0);
