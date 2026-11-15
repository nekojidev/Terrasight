import type {
  ClimateMetric,
  ClimateMetricId,
  ClimatePeriod,
  ClimateShift,
  ClimateTrend,
  ClimateUnit,
  YearSetShift,
} from "@terrasight/shared";
import {
  METRIC_IDS,
  seasonSeries,
  type DailySeries,
  type SeasonOptions,
  type YearMetrics,
} from "./season.js";
import { mean, trendTest } from "./stats.js";

export const DEFAULT_BASELINE: ClimatePeriod = { from: 1981, to: 2000 };
export const DEFAULT_RECENT: ClimatePeriod = { from: 2006, to: 2025 };
export const DEFAULT_ALPHA = 0.05;
/** The trend test needs at least this many years; fewer gives "no trend result" (slope null). */
export const MIN_TREND_YEARS = 10;

const UNITS: Record<ClimateMetricId, ClimateUnit> = {
  seasonTemp: "degC",
  hotDaysFlowering: "days",
  seasonPrecip: "mm",
  longestDrySpell: "days",
  gdd: "degDays",
  lastSpringFrost: "dayOfYear",
  firstAutumnFrost: "dayOfYear",
  frostFreeDays: "days",
};

export interface ClimateShiftInput {
  daily: DailySeries;
  lat: number;
  baseline?: ClimatePeriod;
  recent?: ClimatePeriod;
  /** Flowering window of the main crop (or the T5 fallback). */
  flowering: SeasonOptions["flowering"];
  alpha?: number;
  /** Years of the trend test; default 1981 to the end of the recent period. */
  trend?: ClimatePeriod;
}

export type ClimateShiftResult = Pick<ClimateShift, "metrics" | "skippedYears" | "season" | "hemisphere">;

const FROST: ClimateMetricId[] = ["lastSpringFrost", "firstAutumnFrost", "frostFreeDays"];

/** The value of a metric for a year; null = no value (frost: no event, or window not covered → unknown). */
function value(y: YearMetrics, id: ClimateMetricId): number | null {
  return (y as unknown as Record<string, number | null>)[id] ?? null;
}

/** For frost metrics, was the year searchable (so a null means "no event" rather than "unknown")? */
function searched(y: YearMetrics, id: ClimateMetricId): boolean {
  if (id === "lastSpringFrost") return y.frostSearched.spring;
  if (id === "firstAutumnFrost") return y.frostSearched.autumn;
  if (id === "frostFreeDays") return y.frostSearched.spring && y.frostSearched.autumn;
  return true;
}

/**
 * Climate shift of one location: the metrics of T3 for the baseline and recent period, their difference, and the
 * Theil–Sen / Mann–Kendall trend over the annual series (T4). Deterministic; no I/O, no clock.
 * Period values are means over the period's years that have a value. Frost metrics: a year without a frost event is
 * counted in `yearsWithout` and left out of the mean (never treated as zero); for frostFreeDays that also covers a year
 * lacking either frost date. Trend years are the years with a value.
 */
export function climateShift(input: ClimateShiftInput): ClimateShiftResult {
  const baseline = input.baseline ?? DEFAULT_BASELINE;
  const recent = input.recent ?? DEFAULT_RECENT;
  const alpha = input.alpha ?? DEFAULT_ALPHA;
  const trend = input.trend ?? { from: 1981, to: recent.to };
  const from = Math.min(baseline.from, recent.from, trend.from);
  const to = Math.max(baseline.to, recent.to, trend.to);
  const series = seasonSeries(input.daily, input.lat, { years: { from, to }, flowering: input.flowering });

  const inRange = (y: YearMetrics, p: ClimatePeriod) => y.year >= p.from && y.year <= p.to;
  const metrics: ClimateMetric[] = METRIC_IDS.map((id) => {
    const periodOf = (p: ClimatePeriod) => {
      const ys = series.years.filter((y) => inRange(y, p));
      const vals = ys.map((y) => value(y, id)).filter((v): v is number => v !== null);
      const without = FROST.includes(id) ? ys.filter((y) => value(y, id) === null && searched(y, id)).length : 0;
      return { mean: vals.length ? mean(vals) : null, without };
    };
    const b = periodOf(baseline);
    const r = periodOf(recent);
    const pts = series.years
      .filter((y) => inRange(y, trend))
      .map((y) => ({ year: y.year, v: value(y, id) }))
      .filter((p): p is { year: number; v: number } => p.v !== null);
    let tr: ClimateTrend = { slopePerDecade: null, pValue: null, significant: false, years: pts.length };
    if (pts.length >= MIN_TREND_YEARS) {
      const t = trendTest(
        pts.map((p) => p.year),
        pts.map((p) => p.v),
        { alpha },
      );
      tr = {
        slopePerDecade: t.slope === null ? null : t.slope * 10,
        pValue: t.pValue,
        significant: t.pValue !== null && t.pValue < alpha,
        years: pts.length,
      };
    }
    const m: ClimateMetric = {
      id,
      unit: UNITS[id],
      baseline: b.mean,
      recent: r.mean,
      delta: b.mean !== null && r.mean !== null ? r.mean - b.mean : null,
      trend: tr,
    };
    if (FROST.includes(id)) m.yearsWithout = { baseline: b.without, recent: r.without };
    return m;
  });
  return { metrics, skippedYears: series.skippedYears, season: series.season, hemisphere: series.hemisphere };
}

/** Number of recent years whose mean defines the "now" of the trend extension. */
export const TREND_RECENT_YEARS = 15;
/** Clamp of the rainfall factor so a steep slope cannot extrapolate to a dry or a flood climate. */
export const PRECIP_FACTOR_MIN = 0.5;
export const PRECIP_FACTOR_MAX = 1.5;

/**
 * Weather shift of the "trend-2030" set (T8): the significant Theil–Sen slope of growing-season mean temperature
 * (°C/yr) and of growing-season precipitation (fraction of the last-15-years mean per year), each times
 * `targetYear − mean year of the last 15 years`. A slope that is not significant gives 0 / 1 and `applied: false`.
 * The trend runs over all available (non-skipped) years of the series.
 */
export function trendShift(
  daily: DailySeries,
  lat: number,
  opts: { targetYear: number; alpha?: number },
): YearSetShift {
  const alpha = opts.alpha ?? DEFAULT_ALPHA;
  const { years } = seasonSeries(daily, lat);
  const none: YearSetShift = { deltaT: 0, precipFactor: 1, applied: { temperature: false, precipitation: false } };
  if (years.length < MIN_TREND_YEARS) return none;
  const last = years.slice(-TREND_RECENT_YEARS);
  const centre = mean(last.map((y) => y.year));
  const horizon = opts.targetYear - centre;
  const ys = years.map((y) => y.year);

  const tT = trendTest(ys, years.map((y) => y.seasonTemp), { alpha });
  const temperature = tT.significant && tT.slope !== null;
  const tP = trendTest(ys, years.map((y) => y.seasonPrecip), { alpha });
  const recentMean = mean(last.map((y) => y.seasonPrecip));
  const precipitation = tP.significant && tP.slope !== null && recentMean > 0;
  return {
    deltaT: temperature ? tT.slope! * horizon : 0,
    precipFactor: precipitation
      ? Math.min(PRECIP_FACTOR_MAX, Math.max(PRECIP_FACTOR_MIN, 1 + (tP.slope! / recentMean) * horizon))
      : 1,
    applied: { temperature, precipitation },
  };
}
