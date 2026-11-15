import type { DailyWeather, SeasonalEnsemble } from "@terrasight/sources";

/**
 * Seasonal outlook maths (feature "frost and drought risk a month ahead").
 *
 * Per calendar month, every ensemble member (ECMWF SEAS5, 51 members) is reduced to one number and placed against the
 * field's own climatology: the same calendar month in 1991–2020 from NASA POWER (WMO normal period). Tercile
 * probabilities are the share of members below / between / above the climatological terciles (type-7 quantiles), so
 * "no information" is 33 / 33 / 33. No agronomic threshold is involved there.
 *
 * Counts of frost nights and hot days use fixed, cited definitions:
 *   - frost night: daily minimum air temperature ≤ 0 °C (WMO "frost days", ETCCDI index FD);
 *   - hot day: daily maximum air temperature ≥ 35 °C (the common heat-stress limit for cereals; ETCCDI uses 25 °C
 *     "summer days" and 30 °C / 35 °C variants).
 */
export const CLIMATOLOGY = { from: 1991, to: 2020 } as const;
export const FROST_TMIN_C = 0;
export const HEAT_TMAX_C = 35;
/** A dominant tercile with at least this share of members is worth a sentence (33 % = no information). */
export const SIGNAL_PROB = 0.5;
/** A count shifts when the ensemble mean moves ≥ max(1 day, 0.43 σ): 0.43 σ is the median-to-tercile distance of a normal. */
export const COUNT_SIGMA = 0.43;
const MIN_CLIM_YEARS = 25;

export interface Terciles {
  /** Share of members below the lower / between / above the upper climatological tercile (0–1, sums to ~1). */
  below: number;
  near: number;
  above: number;
  /** Climatological tercile boundaries and median of the month's value (mm total or °C mean). */
  lower: number;
  upper: number;
  climMedian: number;
  ensMedian: number;
}

export type Direction = "higher" | "lower" | "normal";

export interface CountSignal {
  /** Mean number of days per month in the climatology and in the ensemble. */
  climDays: number;
  ensDays: number;
  direction: Direction;
}

export interface MonthOutlook {
  /** YYYY-MM */
  month: string;
  precip: Terciles;
  temp: Terciles;
  frost: CountSignal;
  heat: CountSignal;
}

export type SignalKind =
  | "rain_below"
  | "rain_above"
  | "temp_above"
  | "temp_below"
  | "frost_higher"
  | "frost_lower"
  | "heat_higher"
  | "heat_lower";

export interface OutlookSignal {
  kind: SignalKind;
  month: string;
  /** Tercile probability for rain and temperature, null for day counts. */
  probability: number | null;
  /** Climatological and ensemble-mean days for frost / heat. */
  climDays: number | null;
  ensDays: number | null;
}

export interface FieldOutlook {
  months: MonthOutlook[];
  signals: OutlookSignal[];
  members: number;
  issuedAt: string;
  model: string;
  attribution: string;
  climatology: { from: number; to: number };
}

/** The first `n` calendar months that start on or after `today`: complete months only, never a partial one. */
export function outlookMonths(today: string, n = 3): string[] {
  const [y, m, d] = today.split("-").map(Number) as [number, number, number];
  let year = y;
  let month = d === 1 ? m : m + 1;
  const out: string[] = [];
  for (let i = 0; i < n; i++) {
    if (month > 12) {
      month = 1;
      year++;
    }
    out.push(`${year}-${String(month).padStart(2, "0")}`);
    month++;
  }
  return out;
}

/** Days from `today` (day 1 of the request) to the end of `lastMonth`, i.e. the `forecast_days` the request needs. */
export function daysThrough(today: string, lastMonth: string): number {
  const [y, m] = lastMonth.split("-").map(Number) as [number, number];
  const end = Date.UTC(y, m, 0);
  return Math.round((end - Date.parse(`${today}T00:00:00Z`)) / 86_400_000) + 1;
}

function daysIn(month: string): number {
  const [y, m] = month.split("-").map(Number) as [number, number];
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

/** Type-7 quantile of a sorted array. */
export function quantile(sorted: number[], p: number): number {
  if (sorted.length === 0) return NaN;
  const h = (sorted.length - 1) * p;
  const lo = Math.floor(h);
  const hi = Math.ceil(h);
  return sorted[lo]! + (sorted[hi]! - sorted[lo]!) * (h - lo);
}

const mean = (v: number[]) => v.reduce((s, x) => s + x, 0) / v.length;
const sd = (v: number[]) => {
  const m = mean(v);
  return Math.sqrt(v.reduce((s, x) => s + (x - m) ** 2, 0) / Math.max(1, v.length - 1));
};
const r2 = (x: number) => Math.round(x * 100) / 100;
const r1 = (x: number) => Math.round(x * 10) / 10;

/** One value per day-series: month totals / means / counts. null if any day is missing. */
interface MonthStats {
  precip: number;
  temp: number;
  frost: number;
  heat: number;
}

function monthStats(
  tmax: Array<number | null>,
  tmin: Array<number | null>,
  precip: Array<number | null>,
  from: number,
  n: number,
): MonthStats | null {
  let p = 0;
  let t = 0;
  let frost = 0;
  let heat = 0;
  for (let i = from; i < from + n; i++) {
    const hi = tmax[i];
    const lo = tmin[i];
    const pr = precip[i];
    if (hi == null || lo == null || pr == null) return null;
    p += pr;
    t += (hi + lo) / 2;
    if (lo <= FROST_TMIN_C) frost++;
    if (hi >= HEAT_TMAX_C) heat++;
  }
  return { precip: p, temp: t / n, frost, heat };
}

/** Climatological month values per year from POWER (T2M_MAX, T2M_MIN, PRECTOTCORR), 1991–2020. */
export function climatology(weather: DailyWeather, month: string): MonthStats[] {
  const mm = month.slice(5, 7);
  const index = new Map<string, number>();
  weather.dates.forEach((d, i) => index.set(d, i));
  const out: MonthStats[] = [];
  for (let y = CLIMATOLOGY.from; y <= CLIMATOLOGY.to; y++) {
    const first = index.get(`${y}-${mm}-01`);
    const n = new Date(Date.UTC(y, Number(mm), 0)).getUTCDate();
    if (first === undefined || weather.dates[first + n - 1] !== `${y}-${mm}-${String(n).padStart(2, "0")}`)
      continue;
    const s = monthStats(
      weather.values.T2M_MAX,
      weather.values.T2M_MIN,
      weather.values.PRECTOTCORR,
      first,
      n,
    );
    if (s) out.push(s);
  }
  return out;
}

function terciles(clim: number[], ens: number[]): Terciles {
  const c = [...clim].sort((a, b) => a - b);
  const lower = quantile(c, 1 / 3);
  const upper = quantile(c, 2 / 3);
  const below = ens.filter((v) => v < lower).length / ens.length;
  const above = ens.filter((v) => v > upper).length / ens.length;
  const e = [...ens].sort((a, b) => a - b);
  return {
    below: r2(below),
    near: r2(1 - below - above),
    above: r2(above),
    lower: r1(lower),
    upper: r1(upper),
    climMedian: r1(quantile(c, 0.5)),
    ensMedian: r1(quantile(e, 0.5)),
  };
}

/** Months where the threshold is crossed on over 80 % of days in a normal year carry no signal (the count saturates). */
const SATURATED = 0.8;

function countSignal(clim: number[], ens: number[], monthDays: number): CountSignal {
  const cm = mean(clim);
  const em = mean(ens);
  const delta = em - cm;
  const need = Math.max(1, COUNT_SIGMA * sd(clim));
  return {
    climDays: r1(cm),
    ensDays: r1(em),
    direction:
      cm > SATURATED * monthDays ? "normal" : delta >= need ? "higher" : delta <= -need ? "lower" : "normal",
  };
}

/**
 * Ensemble values of one month per member; members with a missing day are dropped.
 *
 * SEAS5 has its own climate (it is notably too wet in dry regions), so raw values cannot be set against POWER terciles.
 * Open-Meteo gives the ensemble-mean monthly anomaly against SEAS5's reforecast climatology: the raw ensemble mean
 * minus that anomaly is the model's own normal. Temperatures are shifted so that normal equals the field's POWER
 * normal; precipitation is scaled by the ratio of the two normals (shifted when the model normal is below 1 mm).
 * What is left is the forecast signal: the ensemble's departure from its own normal, placed on the field's climate.
 */
function ensembleMonth(
  e: SeasonalEnsemble,
  month: string,
  obs: { temp: number; precip: number },
): MonthStats[] | null {
  const first = e.dates.indexOf(`${month}-01`);
  const n = daysIn(month);
  if (first < 0 || e.dates[first + n - 1] !== `${month}-${String(n).padStart(2, "0")}`) return null;
  const k = e.monthly?.months.indexOf(month) ?? -1;
  const tAnom = k >= 0 ? e.monthly.tempAnomalyC[k] : null;
  const pAnom = k >= 0 ? e.monthly.precipAnomalyMm[k] : null;
  if (tAnom == null || pAnom == null) return null;
  const raw: MonthStats[] = [];
  for (let m = 0; m < e.tmaxC.length; m++) {
    const s = monthStats(e.tmaxC[m]!, e.tminC[m]!, e.precipMm[m]!, first, n);
    if (s) raw.push(s);
  }
  if (raw.length < 10) return null;
  const modelTemp = mean(raw.map((s) => s.temp)) - tAnom;
  const modelPrecip = mean(raw.map((s) => s.precip)) - pAnom;
  const dT = obs.temp - modelTemp;
  const scale = modelPrecip >= 1 ? obs.precip / modelPrecip : null;
  const add = obs.precip - modelPrecip;
  const out: MonthStats[] = [];
  for (let m = 0; m < e.tmaxC.length; m++) {
    const s = monthStats(
      e.tmaxC[m]!.map((v) => (v == null ? v : v + dT)),
      e.tminC[m]!.map((v) => (v == null ? v : v + dT)),
      e.precipMm[m]!.map((v) => (v == null ? v : scale !== null ? v * scale : Math.max(0, v + add / n))),
      first,
      n,
    );
    if (s) out.push(s);
  }
  return out;
}

export function computeOutlook(
  ensemble: SeasonalEnsemble,
  weather: DailyWeather,
  months: string[],
): FieldOutlook | null {
  const out: MonthOutlook[] = [];
  let members = 0;
  for (const month of months) {
    const clim = climatology(weather, month);
    if (clim.length < MIN_CLIM_YEARS) continue;
    const ens = ensembleMonth(ensemble, month, {
      temp: mean(clim.map((s) => s.temp)),
      precip: mean(clim.map((s) => s.precip)),
    });
    if (!ens) continue;
    members = Math.max(members, ens.length);
    out.push({
      month,
      precip: terciles(
        clim.map((s) => s.precip),
        ens.map((s) => s.precip),
      ),
      temp: terciles(
        clim.map((s) => s.temp),
        ens.map((s) => s.temp),
      ),
      frost: countSignal(
        clim.map((s) => s.frost),
        ens.map((s) => s.frost),
        daysIn(month),
      ),
      heat: countSignal(
        clim.map((s) => s.heat),
        ens.map((s) => s.heat),
        daysIn(month),
      ),
    });
  }
  if (out.length === 0) return null;
  return {
    months: out,
    signals: deriveSignals(out),
    members,
    issuedAt: ensemble.issuedAt,
    model: ensemble.model,
    attribution: ensemble.attribution,
    climatology: { ...CLIMATOLOGY },
  };
}

export function deriveSignals(months: MonthOutlook[]): OutlookSignal[] {
  const out: OutlookSignal[] = [];
  for (const m of months) {
    if (m.precip.below >= SIGNAL_PROB)
      out.push({ kind: "rain_below", month: m.month, probability: m.precip.below, climDays: null, ensDays: null });
    else if (m.precip.above >= SIGNAL_PROB)
      out.push({ kind: "rain_above", month: m.month, probability: m.precip.above, climDays: null, ensDays: null });
    if (m.temp.above >= SIGNAL_PROB)
      out.push({ kind: "temp_above", month: m.month, probability: m.temp.above, climDays: null, ensDays: null });
    else if (m.temp.below >= SIGNAL_PROB)
      out.push({ kind: "temp_below", month: m.month, probability: m.temp.below, climDays: null, ensDays: null });
    for (const [name, c] of [
      ["frost", m.frost],
      ["heat", m.heat],
    ] as const) {
      if (c.direction !== "normal")
        out.push({
          kind: `${name}_${c.direction}` as SignalKind,
          month: m.month,
          probability: null,
          climDays: c.climDays,
          ensDays: c.ensDays,
        });
    }
  }
  return out;
}

export interface OutlookSummary {
  /** First outlook month (YYYY-MM) and counts of fields among those with an outlook. */
  month: string | null;
  fields: number;
  withOutlook: number;
  drier: number;
  wetter: number;
  warmer: number;
  cooler: number;
  frostHigher: number;
  heatHigher: number;
}

/** Counts for the Home rail: how many fields lean drier / warmer / more frost / more heat in the next month. */
export function summarise(outlooks: Array<FieldOutlook | null>): OutlookSummary {
  const have = outlooks.filter((o): o is FieldOutlook => o !== null);
  const month = have[0]?.months[0]?.month ?? null;
  const s: OutlookSummary = {
    month,
    fields: outlooks.length,
    withOutlook: 0,
    drier: 0,
    wetter: 0,
    warmer: 0,
    cooler: 0,
    frostHigher: 0,
    heatHigher: 0,
  };
  for (const o of have) {
    const m = o.months.find((x) => x.month === month);
    if (!m) continue;
    s.withOutlook++;
    if (m.precip.below >= SIGNAL_PROB) s.drier++;
    if (m.precip.above >= SIGNAL_PROB) s.wetter++;
    if (m.temp.above >= SIGNAL_PROB) s.warmer++;
    if (m.temp.below >= SIGNAL_PROB) s.cooler++;
    if (m.frost.direction === "higher") s.frostHigher++;
    if (m.heat.direction === "higher") s.heatHigher++;
  }
  return s;
}
