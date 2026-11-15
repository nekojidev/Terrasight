#!/usr/bin/env node
// Record real USDA NASS Quick Stats county yields (EP-10 S-10.07) into fixtures/nass/<STATE>-<fips>-<crop>.json.
// The API key is read from NASS_API_KEY and never written anywhere.
//
// Usage: node --env-file=../../.env scripts/record-nass.mjs   (after `pnpm --filter @terrasight/sources build`)
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { fetchCountyYields, fetchStateYields, stripKey } from "@terrasight/sources";

const root = join(dirname(fileURLToPath(import.meta.url)), "../../..");
const out = join(process.env.FIXTURES_DIR ?? join(root, "fixtures"), "nass");
mkdirSync(out, { recursive: true });

const counties = [
  { state: "KS", fips: "20055" }, // Finney
  { state: "NE", fips: "31029" }, // Chase
  { state: "CO", fips: "08075" }, // Logan
];
const crops = ["corn", "sorghum", "winter_wheat", "soybean"];

for (const c of counties) {
  for (const crop of crops) {
    const r = await fetchCountyYields(
      { stateAlpha: c.state, countyFips: c.fips, crop, fromYear: 1981, toYear: new Date().getUTCFullYear() },
      { apiKey: process.env.NASS_API_KEY },
    );
    if (!r.connected || !r.ok) {
      console.log(c.state, c.fips, crop, "skipped:", stripKey(r.reason, process.env.NASS_API_KEY));
      continue;
    }
    if (r.rows.length === 0) {
      console.log(c.state, c.fips, crop, "no data");
      continue;
    }
    writeFileSync(join(out, `${c.state}-${c.fips}-${crop}.json`), `${JSON.stringify(r, null, 1)}\n`);
    console.log(c.state, c.fips, crop, r.area, r.rows.length, "rows");
  }
}

// State-level series (S-10.08): the fallback when a county has fewer than 8 published values for a crop.
for (const state of [...new Set(counties.map((c) => c.state))]) {
  for (const crop of crops) {
    const r = await fetchStateYields(
      { stateAlpha: state, crop, fromYear: 1981, toYear: new Date().getUTCFullYear() },
      { apiKey: process.env.NASS_API_KEY },
    );
    if (!r.connected || !r.ok) {
      console.log(state, "state", crop, "skipped:", stripKey(r.reason, process.env.NASS_API_KEY));
      continue;
    }
    if (r.rows.length === 0) {
      console.log(state, "state", crop, "no data");
      continue;
    }
    writeFileSync(join(out, `${state}-state-${crop}.json`), `${JSON.stringify(r, null, 1)}\n`);
    console.log(state, "state", crop, r.area, r.rows.length, "rows");
  }
}
