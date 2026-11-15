// Real annual series for the opening graphic: the project's own climate code over the recorded NASA POWER response of
// the Garden City cell (lat 38, lon -101.25, the grid cell of North quarter). Nothing here is invented or smoothed.
import fs from "node:fs";
import path from "node:path";
import { ROOT } from "./env.mjs";

const climate = await import(path.join(ROOT, "packages/climate/dist/index.js"));

/** Returns {cell, years:[{year, day}], baseline, recent, trend...} for first autumn frost (day of year). */
export async function loadFrostSeries() {
  // The POWER series of North quarter's own grid cell (lat 38, lon -100.625), fetched once with the project's own
  // `power` adapter (same URL, same parsing) and kept in out/power-cell.json.
  const file = path.join(ROOT, "tools/demo-video/out/power-cell.json");
  if (!fs.existsSync(file)) throw new Error("run the POWER fetch first (out/power-cell.json)");
  const found = { j: JSON.parse(fs.readFileSync(file, "utf8")), f: "power-cell.json" };
  const w = found.j.payload;
  const daily = climate.dailyFromPower({ dates: w.dates, values: w.values });
  const lat = 38.0608;
  const flowering = { from: "06-29", to: "07-24", thresholdC: 35 };
  const shift = climate.climateShift({ daily, lat, flowering });
  const ss = climate.seasonSeries(daily, lat, { flowering });
  const years = ss.years.filter((y) => y.firstAutumnFrost != null).map((y) => ({ year: y.year, doy: y.firstAutumnFrost }));
  const m = shift.metrics.find((x) => x.id === "firstAutumnFrost");
  const ts = climate.theilSen(years.map((y) => y.year), years.map((y) => y.doy));
  const mean = (a, b) => {
    const v = years.filter((y) => y.year >= a && y.year <= b).map((y) => y.doy);
    return v.reduce((x, y) => x + y, 0) / v.length;
  };
  return { ts, baseline: mean(1981, 2000), recent: mean(2006, 2025), cell: w.cell, dataDate: found.j.dataDate, years, metric: m, shiftMetricIds: shift.metrics.map((x) => x.id) };
}

if (process.argv[1] === import.meta.filename) {
  const s = await loadFrostSeries();
  console.log(JSON.stringify({ cell: s.cell, n: s.years.length, first: s.years[0], last: s.years.at(-1), metric: s.metric }, null, 1));
}
