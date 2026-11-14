#!/usr/bin/env node
// Live smoke run of every source adapter for one field. Usage: node tools/sources/smoke.mjs lon lat [halfSideM] [outDir]
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { adaptersFor } from "../../packages/sources/dist/index.js";

const [lon = -100.98, lat = 37.99, half = 350, out = ".", only = ""] = process.argv
  .slice(2)
  .map((v, i) => (i < 3 ? Number(v) : v));
const keys = {
  cdseClientId: process.env.CDSE_CLIENT_ID,
  cdseClientSecret: process.env.CDSE_CLIENT_SECRET,
  openetApiKey: process.env.OPENET_API_KEY,
};
const dLat = half / 111320,
  dLon = half / (111320 * Math.cos((lat * Math.PI) / 180));
const ring = [
  [lon - dLon, lat - dLat],
  [lon + dLon, lat - dLat],
  [lon + dLon, lat + dLat],
  [lon - dLon, lat + dLat],
  [lon - dLon, lat - dLat],
];
const field = {
  polygons: [[ring]],
  centroid: { lon, lat },
  bbox: [lon - dLon, lat - dLat, lon + dLon, lat + dLat],
  country: "US",
};
const ctx = { signal: AbortSignal.timeout(15 * 60_000), fetch, today: new Date().toISOString().slice(0, 10) };
mkdirSync(out, { recursive: true });
await Promise.all(
  adaptersFor(field, keys)
    .filter((a) => !only || only.split(",").includes(a.id))
    .map(async (a) => {
      const t0 = Date.now();
      try {
        const r = await a.fetch(field, ctx);
        writeFileSync(join(out, `${a.id}.json`), JSON.stringify(r));
        const p = r.payload;
        const brief =
          a.id === "power"
            ? `${p.dates.length} days ${p.dates[0]}→${r.dataDate}`
            : a.id === "cdl"
              ? p.seasons
                  .map(
                    (s) =>
                      `${s.year}:${s.majorityCode}(${Math.round(s.majorityShare * 100)}%,${s.method[0]})`,
                  )
                  .join(" ")
              : a.id === "modis"
                ? `${p.points.length} composites, last ${r.dataDate}`
                : a.id === "sentinel2"
                  ? `${p.ndvi.length} clear 5-day NDVI values, last ${r.dataDate}, NDVI ${p.ndvi
                      .slice(-4)
                      .map((x) => x.mean)
                      .join(
                        " ",
                      )}, thumbnail ${p.thumbnailPng ? Math.round((p.thumbnailPng.length * 0.75) / 1024) + " KB" : "none"}`
                  : a.id === "openet"
                    ? `${p.months.length} months, annual ${p.annual.map((y) => y.year + ":" + y.etMm).join(" ")}`
                    : JSON.stringify(p)?.slice(0, 160);
        console.log(
          `${a.id.padEnd(10)} ${r.status.padEnd(8)} ${String(Date.now() - t0).padStart(7)}ms ${brief} ${r.reason ?? ""}`,
        );
      } catch (e) {
        console.log(`${a.id.padEnd(10)} ERROR    ${String(Date.now() - t0).padStart(7)}ms ${e.message}`);
      }
    }),
);
