#!/usr/bin/env node
// Loads administrative boundaries into PostGIS for offline reverse geocoding (Tech Design §6.4):
//   - Natural Earth admin-1 (states, provinces, oblasts) with ISO 3166-2 codes → admin_areas
//   - Natural Earth admin-2 US counties (derived from the US Census, public domain) → us_counties
// census.gov blocks scripted downloads (Cloudflare challenge), so the counties come from Natural Earth.
// Usage: pnpm --filter @terrasight/api boundaries:load   (downloads once into data/boundaries/, gitignored)
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const root = join(dirname(fileURLToPath(import.meta.url)), "../../..");
const dir = join(root, "data/boundaries");
const BASE = "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson";
const FILES = {
  admin1: "ne_10m_admin_1_states_provinces.geojson",
  counties: "ne_10m_admin_2_counties.geojson",
};

async function download(name) {
  const path = join(dir, name);
  if (existsSync(path)) return path;
  mkdirSync(dir, { recursive: true });
  const res = await fetch(`${BASE}/${name}`, {
    headers: { "User-Agent": "Terrasight/0.1 (boundaries loader)" },
  });
  if (!res.ok) throw new Error(`${name}: HTTP ${res.status}`);
  writeFileSync(path, Buffer.from(await res.arrayBuffer()));
  return path;
}

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is required");
  process.exit(1);
}
const client = new pg.Client({ connectionString: url });
await client.connect();

async function load(table, features, row) {
  await client.query("BEGIN");
  await client.query(`DELETE FROM ${table}`);
  let n = 0;
  for (const f of features) {
    const r = row(f.properties ?? {});
    if (!r || !f.geometry) continue;
    await client.query(
      `INSERT INTO ${table} VALUES ($1, $2, $3, ST_Multi(ST_MakeValid(ST_SetSRID(ST_GeomFromGeoJSON($4), 4326))))
       ON CONFLICT DO NOTHING`,
      [...r, JSON.stringify(f.geometry)],
    );
    n++;
  }
  await client.query("COMMIT");
  return n;
}

const admin1 = JSON.parse(readFileSync(await download(FILES.admin1), "utf8")).features;
const a = await load("admin_areas", admin1, (p) => {
  const code = p.iso_3166_2;
  // Some Natural Earth units have placeholder codes ending in "~" or "-"; skip them.
  if (!code || /[~]$|-$/.test(code)) return null;
  return [code, p.name_en ?? p.name ?? code, p.iso_a2 ?? code.split("-")[0]];
});

const counties = JSON.parse(readFileSync(await download(FILES.counties), "utf8")).features;
const c = await load("us_counties", counties, (p) => {
  if (p.ISO_A2 !== "US" || !p.CODE_LOCAL) return null;
  const name = p.NAME_ALT ?? `${p.NAME} County`;
  return [p.CODE_LOCAL, name, p.REGION ?? ""];
});

await client.query("ANALYZE admin_areas; ANALYZE us_counties");
await client.end();
console.log(`boundaries loaded: ${a} admin areas, ${c} US counties`);
