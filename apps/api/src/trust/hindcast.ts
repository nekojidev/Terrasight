import type {
  MissReason,
  TrustFit,
  TrustReport,
  TrustYear,
} from "@terrasight/shared";
import type { WeatherDay } from "@terrasight/simulator";

/**
 * Hindcast arithmetic (EP-10 S-10.08, T11 / T12). Pure functions, no I/O.
 *
 * Honesty rules: nothing here tunes, smooths or drops anything. Deviations are computed as the decisions say, the fit
 * is computed on every year that has both values, and a missing value stays null.
 */

export type Practice = "irrigated" | "non-irrigated" | "all";

export interface ActualPoint {
  year: number;
  tPerHa: number;
  practice: Practice;
}

/** What the simulator leaves out (checked in packages/simulator: a FAO-56 water balance + FAO-33 yield response only). */
export const NOT_MODELLED = ["heat", "frost", "pests", "nutrients", "variety", "harvest"];

/** A county series needs this many values in the compared years, else the state series is used (S-10.08). */
export const MIN_COUNTY_VALUES = 8;
/** Below this many values in the whole series a trend is not fitted: the deviation is from the mean. */
export const MIN_TREND_VALUES = 8;
/** |model − actual| above this many percentage points is a miss. */
export const MISS_POINTS = 20;

const r1 = (x: number | null) => (x === null ? null : Math.round(x * 10) / 10);
const r3 = (x: number | null) => (x === null ? null : Math.round(x * 1000) / 1000);
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

/** Pearson correlation; null for fewer than 5 pairs or a constant series. */
export function pearson(xs: number[], ys: number[]): number | null {
  const n = xs.length;
  if (n < 5) return null;
  const mx = mean(xs);
  const my = mean(ys);
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (let i = 0; i < n; i++) {
    sxy += (xs[i]! - mx) * (ys[i]! - my);
    sxx += (xs[i]! - mx) ** 2;
    syy += (ys[i]! - my) ** 2;
  }
  return sxx === 0 || syy === 0 ? null : sxy / Math.sqrt(sxx * syy);
}

export function fit(pairs: Array<[number, number]>): TrustFit {
  const n = pairs.length;
  return {
    n,
    r: r3(pearson(pairs.map((p) => p[0]), pairs.map((p) => p[1]))),
    mae: n ? r1(mean(pairs.map(([a, b]) => Math.abs(a - b)))) : null,
  };
}

/** Ordinary least squares y = a + b·x. */
export function ols(points: Array<{ x: number; y: number }>): { a: number; b: number } {
  const mx = mean(points.map((p) => p.x));
  const my = mean(points.map((p) => p.y));
  let sxy = 0;
  let sxx = 0;
  for (const p of points) {
    sxy += (p.x - mx) * (p.y - my);
    sxx += (p.x - mx) ** 2;
  }
  const b = sxx === 0 ? 0 : sxy / sxx;
  return { a: my - b * mx, b };
}

/**
 * Percent deviation of each value from the linear trend of its own series (OLS over every year given); from the mean
 * when the series has fewer than MIN_TREND_VALUES values (`short` = true).
 */
export function trendDeviation(series: Array<{ year: number; v: number }>): {
  at: (year: number, v: number) => number | null;
  short: boolean;
} {
  if (series.length === 0) return { at: () => null, short: true };
  const short = series.length < MIN_TREND_VALUES;
  if (short) {
    const m = mean(series.map((s) => s.v));
    return { at: (_y, v) => (m === 0 ? null : ((v - m) / m) * 100), short };
  }
  const { a, b } = ols(series.map((s) => ({ x: s.year, y: s.v })));
  return {
    at: (y, v) => {
      const f = a + b * y;
      return f > 0 ? ((v - f) / f) * 100 : null;
    },
    short,
  };
}

/** Deviation from the mean of the values themselves (per group); null for groups with fewer than 2 values. */
export function deviationsFromMean(values: Map<number, number | null>): Map<number, number | null> {
  const present = [...values.values()].filter((v): v is number => v !== null);
  const m = present.length >= 2 ? mean(present) : null;
  return new Map(
    [...values].map(([y, v]) => [y, v === null || m === null || m === 0 ? null : ((v - m) / m) * 100]),
  );
}

// ---------- which actual series ----------

export interface ChosenSeries {
  practice: Practice;
  /** One value per year. */
  points: ActualPoint[];
  /** True when the series is "all" although the field has a practice. */
  allUsed: boolean;
}

/**
 * One practice per crop series, never mixed. The field's practice is used when it covers every compared year that any
 * practice covers in this source; else "all" for the whole series; else whatever matching values exist.
 */
export function chooseSeries(
  points: ActualPoint[],
  fieldPractice: "irrigated" | "non-irrigated",
  comparedYears: number[],
): ChosenSeries | null {
  const by = (p: Practice) => {
    const m = new Map<number, ActualPoint>();
    for (const x of points) if (x.practice === p) m.set(x.year, x);
    return m;
  };
  const match = by(fieldPractice);
  const all = by("all");
  const inCompared = (m: Map<number, ActualPoint>) => comparedYears.filter((y) => m.has(y));
  const anyYears = new Set([...inCompared(match), ...inCompared(all)]);
  const matchCovers = inCompared(match).length > 0 && [...anyYears].every((y) => match.has(y));
  if (matchCovers) return { practice: fieldPractice, points: [...match.values()], allUsed: false };
  if (all.size > 0) return { practice: "all", points: [...all.values()], allUsed: true };
  if (match.size > 0) return { practice: fieldPractice, points: [...match.values()], allUsed: false };
  return null;
}

export interface ActualPick {
  level: "county" | "state" | "oblast";
  area: string;
  chosen: ChosenSeries;
}

/** County when it has at least MIN_COUNTY_VALUES values in the compared years, else the state series. */
export function pickActual(
  county: { area: string; points: ActualPoint[] } | null,
  state: { area: string; points: ActualPoint[] } | null,
  fieldPractice: "irrigated" | "non-irrigated",
  comparedYears: number[],
): ActualPick | null {
  const c = county ? chooseSeries(county.points, fieldPractice, comparedYears) : null;
  const cCount = c ? comparedYears.filter((y) => c.points.some((p) => p.year === y)).length : 0;
  if (c && county && cCount >= MIN_COUNTY_VALUES) return { level: "county", area: county.area, chosen: c };
  const s = state ? chooseSeries(state.points, fieldPractice, comparedYears) : null;
  if (s && state) return { level: "state", area: state.area, chosen: s };
  if (c && county) return { level: "county", area: county.area, chosen: c };
  return null;
}

/** "Finney County, KS (all practices)" / "Kansas (state level, non-irrigated)". */
export function areaLabel(p: ActualPick): string {
  const practice = p.chosen.practice === "all" ? "all practices" : p.chosen.practice;
  if (p.level === "state") return `${p.area} (state level, ${practice})`;
  if (p.level === "oblast") return `${p.area} (oblast level, all farms)`;
  return `${p.area} (${practice})`;
}

// ---------- reasons for a miss (T12) ----------

const dayMs = 86_400_000;
const addDays = (iso: string, n: number) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * dayMs).toISOString().slice(0, 10);
const shiftYear = (iso: string, by: number) => `${Number(iso.slice(0, 4)) + by}${iso.slice(4)}`;
const quantile = (xs: number[], q: number) => {
  const s = [...xs].sort((a, b) => a - b);
  const pos = (s.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return s[lo]! + (s[hi]! - s[lo]!) * (pos - lo);
};

export const HEAT_TMAX_C = 35;
export const FROST_TMIN_C = -2;

export interface CropWindow {
  /** Simulated sowing and harvest dates (ISO) of the crop in the missed year. */
  sowing: string;
  harvest: string;
}

/**
 * Why a missed year may have been missed, only from that year's weather of the field (POWER):
 *  - heat: days with Tmax > 35 °C between sowing and harvest above the 80th percentile of the same count over all of
 *    the field's years (the same calendar window shifted to each year);
 *  - frost: a Tmin ≤ −2 °C in the last 6 weeks before the simulated harvest, or, for a winter crop (sown in
 *    autumn), on or after 1 April of the harvest year (we do not track heading; the crop is assumed to be heading);
 *  - harvest-rain: precipitation in the 30 days before the simulated harvest above the 90th percentile of the same
 *    window over all years;
 *  - otherwise unknown. Checked in this order; the first that holds is reported.
 */
export function missReason(
  year: number,
  weatherByYear: Map<number, WeatherDay[]>,
  w: CropWindow,
): MissReason {
  if (!weatherByYear.get(year)?.length) return "unknown";
  // A season window ends on 31 Aug of the harvest year, but a crop harvested in September or October needs the next
  // window's first days: a year's days are its own window followed by the next one.
  const span = (y: number) => [...(weatherByYear.get(y) ?? []), ...(weatherByYear.get(y + 1) ?? [])];
  const days = span(year);
  const inRange = (d: WeatherDay[], from: string, to: string) => d.filter((x) => x.date >= from && x.date <= to);
  const windowOf = (y: number) => ({
    sow: shiftYear(w.sowing, y - year),
    har: shiftYear(w.harvest, y - year),
  });
  const complete = (y: number) => (weatherByYear.get(y)?.length ?? 0) >= 360;
  const lateHarvest = Number(w.harvest.slice(0, 4)) > year || Number(w.harvest.slice(5, 7)) >= 9;
  // Reference years: complete ones whose window (and, for a September harvest, the next window) is in the data.
  const years = [...weatherByYear.keys()].filter((y) => complete(y) && (!lateHarvest || complete(y + 1)));

  // Heat.
  const hot = (y: number) => {
    const { sow, har } = windowOf(y);
    return inRange(span(y), sow, har).filter((d) => d.tmax > HEAT_TMAX_C).length;
  };
  const hotYear = hot(year);
  if (hotYear > quantile(years.map(hot), 0.8)) return "heat";

  // Frost.
  const winter = Number(w.sowing.slice(5, 7)) >= 8;
  const frostFrom = addDays(w.harvest, -42);
  const frosty = inRange(days, frostFrom, w.harvest).some((d) => d.tmin <= FROST_TMIN_C);
  const lateWinter = winter && inRange(days, `${w.harvest.slice(0, 4)}-04-01`, w.harvest).some((d) => d.tmin <= FROST_TMIN_C);
  if (frosty || lateWinter) return "frost";

  // Rain before harvest.
  const wet = (y: number) => {
    const { har } = windowOf(y);
    return inRange(span(y), addDays(har, -30), addDays(har, -1)).reduce((a, d) => a + d.precip, 0);
  };
  if (wet(year) > quantile(years.map(wet), 0.9)) return "harvest-rain";
  return "unknown";
}

// ---------- the table ----------

export interface SeasonRow {
  year: number;
  crop: string;
  /** Engine relative yield for that year (null when the engine returned null). */
  relative: number | null;
  /** Field MODIS NDVI peak of the season. */
  ndviPeak: number | null;
}

export interface ActualSources {
  kind: TrustReport["actual"]["kind"];
  connected: boolean;
  /** Per crop: county (or oblast) and state series. */
  county: Record<string, { area: string; points: ActualPoint[] }>;
  state: Record<string, { area: string; points: ActualPoint[] }>;
  oblast: boolean;
}

export interface TableResult {
  years: TrustYear[];
  vsCounty: TrustFit | null;
  vsNdvi: TrustFit | null;
  area: string | null;
  caveats: string[];
}

/** Builds the per-year table and the fit. `reasonFor` gives the weather-based reason of a missed year. */
export function buildTable(
  rows: SeasonRow[],
  actual: ActualSources,
  fieldPractice: "irrigated" | "non-irrigated",
  reasonFor: (row: SeasonRow) => MissReason,
): TableResult {
  const caveats: string[] = [];
  const crops = [...new Set(rows.map((r) => r.crop))].sort();
  const modelDev = new Map<string, Map<number, number | null>>();
  const ndviDev = new Map<string, Map<number, number | null>>();
  for (const c of crops) {
    const mine = rows.filter((r) => r.crop === c);
    if (mine.length < 2) caveats.push(`single-year-crop:${c}`);
    modelDev.set(c, deviationsFromMean(new Map(mine.map((r) => [r.year, r.relative]))));
    ndviDev.set(c, deviationsFromMean(new Map(mine.map((r) => [r.year, r.ndviPeak]))));
  }

  const cmpYears = (c: string) => rows.filter((r) => r.crop === c).map((r) => r.year);
  const picks = new Map<string, ActualPick>();
  const dev = new Map<string, ReturnType<typeof trendDeviation>>();
  for (const c of crops) {
    const county = actual.county[c] ?? null;
    const pick = actual.oblast
      ? county
        ? ({
            level: "oblast",
            area: county.area,
            chosen: { practice: "all", points: county.points, allUsed: false },
          } as ActualPick)
        : null
      : pickActual(county, actual.state[c] ?? null, fieldPractice, cmpYears(c));
    if (!pick) continue;
    picks.set(c, pick);
    const t = trendDeviation(pick.chosen.points.map((p) => ({ year: p.year, v: p.tPerHa })));
    dev.set(c, t);
    if (t.short) caveats.push(`short-county-series:${c}`);
    if (pick.level === "state") caveats.push(`state-level-yields:${c}`);
    if (pick.chosen.allUsed) caveats.push(`practice-all-used:${c}`);
  }

  const years: TrustYear[] = rows
    .slice()
    .sort((a, b) => a.year - b.year)
    .map((row) => {
      const model = modelDev.get(row.crop)?.get(row.year) ?? null;
      const ndvi = ndviDev.get(row.crop)?.get(row.year) ?? null;
      const pick = picks.get(row.crop);
      const point = pick?.chosen.points.find((p) => p.year === row.year);
      const county = point && pick ? (dev.get(row.crop)!.at(row.year, point.tPerHa) ?? null) : null;
      const miss = model !== null && county !== null && Math.abs(model - county) > MISS_POINTS;
      return {
        year: row.year,
        crop: row.crop,
        model: r1(model),
        county: r1(county),
        ndvi: r1(ndvi),
        countyYield: point?.tPerHa ?? null,
        practice: point && pick ? pick.chosen.practice : null,
        miss,
        reason: miss ? reasonFor(row) : null,
        // keep unrounded values for the fit
        _model: model,
        _county: county,
        _ndvi: ndvi,
      } as TrustYear & { _model: number | null; _county: number | null; _ndvi: number | null };
    });

  type Raw = TrustYear & { _model: number | null; _county: number | null; _ndvi: number | null };
  const pairs = (a: "_county" | "_ndvi") =>
    (years as Raw[])
      .filter((y) => y._model !== null && y[a] !== null)
      .map((y) => [y._model!, y[a]!] as [number, number]);
  const pc = pairs("_county");
  const pn = pairs("_ndvi");
  const cleaned = (years as Raw[]).map(({ _model, _county, _ndvi, ...y }) => y);

  const labels = new Map<string, string[]>();
  for (const [c, p] of picks) {
    const l = areaLabel(p);
    labels.set(l, [...(labels.get(l) ?? []), c]);
  }
  const area =
    labels.size === 0
      ? null
      : labels.size === 1
        ? [...labels.keys()][0]!
        : [...labels].map(([l, cs]) => `${cs.join(", ")}: ${l}`).join("; ");

  return {
    years: cleaned,
    vsCounty: picks.size ? fit(pc) : null,
    vsNdvi: cleaned.some((y) => y.ndvi !== null) ? fit(pn) : null,
    area,
    caveats: [...new Set(caveats)],
  };
}
