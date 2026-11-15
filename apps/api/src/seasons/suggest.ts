import { CROPS, rusleIndex } from "@terrasight/simulator";

/**
 * Pure logic of the "This season" suggestions: sowing window status, best sowing date, emergence by growing degree
 * days and tillage. No I/O; the service feeds it files, weather and the field. Every agronomic number here comes
 * from data/crop-calendar.json or data/crop-phenology.json and is unverified until those files say otherwise.
 */

export type WindowStatus = "open" | "not-yet" | "late" | "closed";

/** Days after the window end that still read "late" (past the recommended window); beyond it "closed". Wording only, not agronomy. */
export const LATE_GRACE_DAYS = 14;

const DAY = 86_400_000;
const ms = (d: string) => Date.parse(`${d}T00:00:00Z`);
const fmt = (t: number) => new Date(t).toISOString().slice(0, 10);

export const addDays = (d: string, n: number) => fmt(ms(d) + n * DAY);
export const daysBetween = (a: string, b: string) => Math.round((ms(b) - ms(a)) / DAY);

/** Windows and typical dates starting in Aug-Dec belong to the next harvest year (winter crops sown in autumn). */
export function sowingYear(mmdd: string, season: number): number {
  return Number(mmdd.slice(0, 2)) >= 8 ? season - 1 : season;
}

/** A calendar rule [from, to] as MM-DD turned into dates for a harvest year; an end before the start runs into the next year. */
export function resolveWindow(rule: [string, string], season: number): { from: string; to: string } {
  const y = sowingYear(rule[0], season);
  const toYear = rule[1] < rule[0] ? y + 1 : y;
  return { from: `${y}-${rule[0]}`, to: `${toYear}-${rule[1]}` };
}

export interface StatusResult {
  status: WindowStatus;
  /** Days from today to the window end (open only). */
  daysLeft?: number;
  /** Days until the window opens (not-yet only). */
  opensInDays?: number;
}

export function windowStatus(win: { from: string; to: string }, today: string): StatusResult {
  if (today < win.from) return { status: "not-yet", opensInDays: daysBetween(today, win.from) };
  if (today <= win.to) return { status: "open", daysLeft: daysBetween(today, win.to) };
  return { status: daysBetween(win.to, today) <= LATE_GRACE_DAYS ? "late" : "closed" };
}

export interface DailySoil {
  date: string;
  /** Daily mean soil temperature at 6 cm, deg C. */
  soilC: number;
}

/** Daily means from an hourly forecast (hours keyed "YYYY-MM-DDTHH:00", cell local time); days need 12 or more readings. */
export function dailySoilMeans(hours: Array<{ time: string; soilTemp6cmC: number | null }>): DailySoil[] {
  const by = new Map<string, number[]>();
  for (const h of hours) {
    if (h.soilTemp6cmC == null) continue;
    const k = h.time.slice(0, 10);
    by.set(k, [...(by.get(k) ?? []), h.soilTemp6cmC]);
  }
  return [...by.entries()]
    .filter(([, v]) => v.length >= 12)
    .map(([date, v]) => ({ date, soilC: v.reduce((a, b) => a + b, 0) / v.length }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

export interface BestSowing {
  date: string;
  /** `soil-temp` = first forecast day inside the window with soil at or above the crop's minimum. */
  basis: "typical" | "soil-temp" | "soil-temp-cold";
}

/**
 * The best date inside an open or upcoming window: the typical date clamped into the window and not before today;
 * when the window is open and the forecast has daily soil temperatures, the first day from there on with soil at or
 * above the crop's minimum. If the whole forecast is colder, the typical date stays and the basis says so.
 */
export function bestSowing(
  win: { from: string; to: string },
  today: string,
  typical: string | null,
  soil: DailySoil[] | null,
  minSoilC: number | null,
): BestSowing | null {
  if (today > win.to) return null;
  const earliest = today > win.from ? today : win.from;
  let date = typical ?? earliest;
  if (date < earliest) date = earliest;
  if (date > win.to) date = win.to;
  const open = today >= win.from;
  if (open && soil?.length && minSoilC != null) {
    const warm = soil.find((d) => d.date >= date && d.date <= win.to && d.soilC >= minSoilC);
    if (warm) return { date: warm.date, basis: "soil-temp" };
    const covered = soil.some((d) => d.date >= date && d.date <= win.to);
    if (covered) return { date, basis: "soil-temp-cold" };
  }
  return { date, basis: "typical" };
}

// ---------- emergence ----------

export interface WeatherDay {
  date: string;
  tminC: number | null;
  tmaxC: number | null;
  tmeanC: number | null;
  origin: string;
}

/** Growing degree days of one day, deg C d: mean of Tmin and Tmax (or the daily mean) minus the base, floored at 0. */
export function gddDay(
  d: { tminC: number | null; tmaxC: number | null; tmeanC: number | null },
  baseC: number,
) {
  const mean = d.tminC !== null && d.tmaxC !== null ? (d.tminC + d.tmaxC) / 2 : d.tmeanC;
  return mean === null ? null : Math.max(mean - baseC, 0);
}

export type EmergenceMethod = "gdd-observed" | "gdd-forecast" | "gdd-climatology" | "typical-days";

/** Mean Tmin/Tmax per MM-DD over past years (±3 days smoothing), the stand-in for days beyond the forecast. */
export type Climatology = Map<string, { tminC: number; tmaxC: number }>;

export function climatology(
  dates: string[],
  tmin: Array<number | null>,
  tmax: Array<number | null>,
  fromYear: number,
): Climatology {
  const sum = new Map<string, { n: number; lo: number; hi: number }>();
  dates.forEach((date, i) => {
    if (Number(date.slice(0, 4)) < fromYear) return;
    const lo = tmin[i];
    const hi = tmax[i];
    if (lo == null || hi == null || lo < -90 || hi < -90) return;
    const k = date.slice(5);
    const s = sum.get(k) ?? { n: 0, lo: 0, hi: 0 };
    sum.set(k, { n: s.n + 1, lo: s.lo + lo, hi: s.hi + hi });
  });
  const out: Climatology = new Map();
  for (const k of sum.keys()) {
    let n = 0;
    let lo = 0;
    let hi = 0;
    for (let off = -3; off <= 3; off++) {
      // A leap year anchor (2024) keeps every MM-DD valid.
      const s = sum.get(addDays(`2024-${k}`, off).slice(5));
      if (s) {
        n += s.n;
        lo += s.lo;
        hi += s.hi;
      }
    }
    if (n) out.set(k, { tminC: lo / n, tmaxC: hi / n });
  }
  return out;
}

export interface EmergenceResult {
  date: string;
  method: EmergenceMethod;
  gdd: number | null;
}

/**
 * Emergence date: degree days accumulate from the sowing day with the crop's base temperature until the requirement
 * is met. Days come from observed weather, then the forecast, then the climatology; the method names the weakest
 * kind used. Null when the weather does not cover the days and there is no climatology to fill them.
 */
export function emergenceByGdd(args: {
  sowing: string;
  weather: WeatherDay[];
  baseC: number;
  requiredGdd: number;
  climate?: Climatology | null;
  maxDays?: number;
}): EmergenceResult | null {
  const byDate = new Map(args.weather.map((d) => [d.date, d]));
  let total = 0;
  let usedForecast = false;
  let usedClimate = false;
  for (let i = 0; i < (args.maxDays ?? 120); i++) {
    const date = addDays(args.sowing, i);
    const day = byDate.get(date);
    let g = day ? gddDay(day, args.baseC) : null;
    if (g !== null && day) {
      if (day.origin === "forecast") usedForecast = true;
    } else {
      const c = args.climate?.get(date.slice(5));
      if (!c) return null;
      g = gddDay({ tminC: c.tminC, tmaxC: c.tmaxC, tmeanC: null }, args.baseC);
      usedClimate = true;
    }
    total += g ?? 0;
    if (total >= args.requiredGdd) {
      return {
        date,
        method: usedClimate ? "gdd-climatology" : usedForecast ? "gdd-forecast" : "gdd-observed",
        gdd: Math.round(total * 10) / 10,
      };
    }
  }
  return null;
}

// ---------- tillage ----------

export type Tillage = "no_till" | "reduced" | "conventional";

export interface TillageConfig {
  noTillSlopePct: number;
  reducedSlopePct: number;
}

export interface TillageSuggestion {
  value: Tillage;
  /** Machine code of the reason, for localisation; `params` fill the sentence. */
  reasonCode: "slope-high" | "slope-moderate" | "regional-practice" | "gentle-slope";
  params: { slopePct?: number; practice?: Tillage };
  reason: string;
  /** Relative RUSLE index (R·LS·C) for the crop, a comparison number and not a soil loss. */
  rusle: number | null;
}

const TILL_LABEL: Record<Tillage, string> = {
  no_till: "no-till",
  reduced: "reduced tillage",
  conventional: "conventional tillage",
};

/**
 * Tillage from erosion risk first (slope against the file's thresholds), then the region's usual practice. Steeper
 * land keeps residue on the surface; gentle slopes follow practice, else the choice stays open. Null without a slope
 * and without a regional practice. Only a suggestion.
 */
export function suggestTillage(args: {
  slopePct: number | null;
  annualPrecipMm: number | null;
  crop: string;
  regionPractice: Tillage | null;
  cfg: TillageConfig;
}): TillageSuggestion | null {
  const { slopePct: s, cfg } = args;
  const c = CROPS[args.crop]?.cFactor;
  const rusle =
    s !== null && args.annualPrecipMm !== null && c !== undefined
      ? rusleIndex(args.annualPrecipMm, s, c)
      : null;
  const rounded = rusle === null ? null : Math.round(rusle * 10) / 10;
  if (s !== null && s >= cfg.noTillSlopePct)
    return {
      value: "no_till",
      reasonCode: "slope-high",
      params: { slopePct: s },
      reason: `slope ${s}%: keep residue on the surface`,
      rusle: rounded,
    };
  if (s !== null && s >= cfg.reducedSlopePct)
    return {
      value: "reduced",
      reasonCode: "slope-moderate",
      params: { slopePct: s },
      reason: `slope ${s}%: leave part of the residue on the surface`,
      rusle: rounded,
    };
  if (args.regionPractice)
    return {
      value: args.regionPractice,
      reasonCode: "regional-practice",
      params: { ...(s !== null ? { slopePct: s } : {}), practice: args.regionPractice },
      reason: `${s !== null ? `slope ${s}%, ` : "slope unknown, "}${TILL_LABEL[args.regionPractice]} is the usual practice in the region`,
      rusle: rounded,
    };
  if (s !== null)
    return {
      value: "conventional",
      reasonCode: "gentle-slope",
      params: { slopePct: s },
      reason: `slope ${s}%: erosion risk from slope is low`,
      rusle: rounded,
    };
  return null;
}
