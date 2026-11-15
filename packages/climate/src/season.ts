import type { ClimateMetricId, FloweringWindow } from "@terrasight/shared";

/** Daily series in the shape of NASA POWER (T2M, T2M_MAX, T2M_MIN, PRECTOTCORR), arrays in parallel, nulls = no data. */
export interface DailySeries {
  /** ISO dates ascending, no gaps. */
  dates: string[];
  tmin: Array<number | null>;
  tmax: Array<number | null>;
  tmean: Array<number | null>;
  precip: Array<number | null>;
}

/** Structural type of `DailyWeather` from @terrasight/sources, so this package needs no dependency on it. */
export interface PowerLike {
  dates: string[];
  values: {
    T2M: Array<number | null>;
    T2M_MAX: Array<number | null>;
    T2M_MIN: Array<number | null>;
    PRECTOTCORR: Array<number | null>;
  };
}

export function dailyFromPower(w: PowerLike): DailySeries {
  return {
    dates: w.dates,
    tmin: w.values.T2M_MIN,
    tmax: w.values.T2M_MAX,
    tmean: w.values.T2M,
    precip: w.values.PRECTOTCORR,
  };
}

export type Hemisphere = "north" | "south";

export const SEASONS: Record<Hemisphere, { from: string; to: string }> = {
  north: { from: "04-01", to: "09-30" },
  south: { from: "10-01", to: "03-31" },
};

/** Fallback of T5: "days above 35 °C in June–August", mirrored in the south. */
export const FALLBACK_FLOWERING: Record<Hemisphere, { from: string; to: string; thresholdC: number }> = {
  north: { from: "06-01", to: "08-31", thresholdC: 35 },
  south: { from: "12-01", to: "02-28", thresholdC: 35 },
};

export const GDD_BASE_C = 10;
export const GDD_CAP_C = 30;
export const DRY_DAY_MM = 1;
export const MIN_SEASON_COVERAGE = 0.9;

export function hemisphereOf(lat: number): Hemisphere {
  return lat < 0 ? "south" : "north";
}

/** Per-year values of every metric; null = no value (frost metrics: no frost event or search window incomplete). */
export interface YearMetrics {
  /** Harvest/season label: north = the calendar year; south = the year in which the season ends. */
  year: number;
  seasonTemp: number;
  hotDaysFlowering: number;
  seasonPrecip: number;
  longestDrySpell: number;
  gdd: number;
  lastSpringFrost: number | null;
  firstAutumnFrost: number | null;
  frostFreeDays: number | null;
  /** Frost metrics: the search windows were covered (≥ 90 % of days with Tmin). Without it null means "unknown". */
  frostSearched: { spring: boolean; autumn: boolean };
}

export interface SeasonSeries {
  hemisphere: Hemisphere;
  season: { from: string; to: string };
  /** Years with enough data, ascending. */
  years: YearMetrics[];
  /** Years in the requested range dropped for < 90 % of season days. */
  skippedYears: number[];
}

export interface SeasonOptions {
  /** Inclusive range of season labels to evaluate; default: every year the data touches. */
  years?: { from: number; to: number };
  /** Flowering window and threshold; default: the T5 fallback for the hemisphere. */
  flowering?: Pick<FloweringWindow, "from" | "to" | "thresholdC">;
}

export const METRIC_IDS: ClimateMetricId[] = [
  "seasonTemp",
  "hotDaysFlowering",
  "seasonPrecip",
  "longestDrySpell",
  "gdd",
  "lastSpringFrost",
  "firstAutumnFrost",
  "frostFreeDays",
];

const DAY = 86_400_000;
const utc = (iso: string): number => Date.parse(`${iso}T00:00:00Z`);

function dayOfYear(iso: string): number {
  const y = Number(iso.slice(0, 4));
  return Math.round((utc(iso) - Date.UTC(y, 0, 1)) / DAY) + 1;
}

function inWindow(mmdd: string, from: string, to: string): boolean {
  return from <= to ? mmdd >= from && mmdd <= to : mmdd >= from || mmdd <= to;
}

/** Index lookup for a date; ascending daily series, so the offset from the first date is the index. */
class Index {
  private readonly t0: number;
  constructor(private readonly daily: DailySeries) {
    this.t0 = daily.dates.length ? utc(daily.dates[0]!) : 0;
  }
  at(iso: string): number {
    return Math.round((utc(iso) - this.t0) / DAY);
  }
  get length(): number {
    return this.daily.dates.length;
  }
}

/** Season days [start, end] (ISO) of a season label. */
export function seasonBounds(year: number, h: Hemisphere): { start: string; end: string } {
  const s = SEASONS[h];
  if (h === "north") return { start: `${year}-${s.from}`, end: `${year}-${s.to}` };
  return { start: `${year - 1}-${s.from}`, end: `${year}-${s.to}` };
}

/** Frost search windows of a season label: [spring from, spring to], [autumn from, autumn to]; split at mid-season. */
function frostWindows(year: number, h: Hemisphere) {
  return h === "north"
    ? {
        spring: [`${year}-01-01`, `${year}-06-30`] as const,
        autumn: [`${year}-07-01`, `${year}-12-31`] as const,
      }
    : {
        spring: [`${year - 1}-07-01`, `${year - 1}-12-31`] as const,
        autumn: [`${year}-01-01`, `${year}-06-30`] as const,
      };
}

/**
 * Per-year values of each metric (T2–T4 of EP-10). Definitions:
 *  - season: 1 Apr–30 Sep (north), 1 Oct–31 Mar (south, labelled by the year it ends); a year with fewer than 90 % of
 *    its season days having all four variables is skipped and listed.
 *  - seasonTemp: mean of daily mean temperature; seasonPrecip: sum over days with data (not scaled up);
 *  - hotDaysFlowering: days inside the flowering window with Tmax above the threshold;
 *  - longestDrySpell: longest run of consecutive days under 1 mm (a missing day ends a run);
 *  - gdd: Σ max(0, min(Tmean, 30) − 10);
 *  - frost (Tmin ≤ 0 °C): last in the first half of the 12-month search window ("spring"), first in the second half
 *    ("autumn"), as day of year of the calendar year of the event; frostFreeDays = days strictly between them.
 */
export function seasonSeries(daily: DailySeries, lat: number, opts: SeasonOptions = {}): SeasonSeries {
  const hemisphere = hemisphereOf(lat);
  const flowering = opts.flowering ?? FALLBACK_FLOWERING[hemisphere];
  const idx = new Index(daily);
  const first = daily.dates[0];
  const last = daily.dates[daily.dates.length - 1];
  const years: YearMetrics[] = [];
  const skippedYears: number[] = [];
  if (!first || !last) return { hemisphere, season: SEASONS[hemisphere], years, skippedYears };
  const from = opts.years?.from ?? Number(first.slice(0, 4));
  const to = opts.years?.to ?? Number(last.slice(0, 4));

  const valid = (i: number): boolean =>
    i >= 0 &&
    i < idx.length &&
    daily.tmean[i] != null &&
    daily.tmax[i] != null &&
    daily.tmin[i] != null &&
    daily.precip[i] != null;

  for (let year = from; year <= to; year++) {
    const b = seasonBounds(year, hemisphere);
    const i0 = idx.at(b.start);
    const i1 = idx.at(b.end);
    const total = i1 - i0 + 1;
    let n = 0;
    for (let i = i0; i <= i1; i++) if (valid(i)) n++;
    if (n < MIN_SEASON_COVERAGE * total) {
      skippedYears.push(year);
      continue;
    }
    let tSum = 0;
    let pSum = 0;
    let gdd = 0;
    let hot = 0;
    let run = 0;
    let dry = 0;
    for (let i = i0; i <= i1; i++) {
      if (!valid(i)) {
        run = 0;
        continue;
      }
      const tm = daily.tmean[i]!;
      const p = daily.precip[i]!;
      tSum += tm;
      pSum += p;
      gdd += Math.max(0, Math.min(tm, GDD_CAP_C) - GDD_BASE_C);
      if (p < DRY_DAY_MM) {
        run++;
        if (run > dry) dry = run;
      } else run = 0;
      if (inWindow(daily.dates[i]!.slice(5), flowering.from, flowering.to) && daily.tmax[i]! > flowering.thresholdC) hot++;
    }

    const fw = frostWindows(year, hemisphere);
    const search = (win: readonly [string, string], pick: "first" | "last") => {
      const a = idx.at(win[0]);
      const z = idx.at(win[1]);
      let seen = 0;
      let hit: number | null = null;
      for (let i = Math.max(a, 0); i <= Math.min(z, idx.length - 1); i++) {
        if (daily.tmin[i] == null) continue;
        seen++;
        if (daily.tmin[i]! <= 0 && (pick === "last" || hit === null)) hit = i;
      }
      return { complete: seen >= MIN_SEASON_COVERAGE * (z - a + 1), hit };
    };
    const sp = search(fw.spring, "last");
    const au = search(fw.autumn, "first");
    const spDate = sp.complete && sp.hit !== null ? daily.dates[sp.hit]! : null;
    const auDate = au.complete && au.hit !== null ? daily.dates[au.hit]! : null;
    years.push({
      year,
      seasonTemp: tSum / n,
      hotDaysFlowering: hot,
      seasonPrecip: pSum,
      longestDrySpell: dry,
      gdd,
      lastSpringFrost: spDate ? dayOfYear(spDate) : null,
      firstAutumnFrost: auDate ? dayOfYear(auDate) : null,
      frostFreeDays: spDate && auDate ? Math.round((utc(auDate) - utc(spDate)) / DAY) - 1 : null,
      frostSearched: { spring: sp.complete, autumn: au.complete },
    });
  }
  return { hemisphere, season: SEASONS[hemisphere], years, skippedYears };
}
