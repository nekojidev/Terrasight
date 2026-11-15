/**
 * Climate shift of a field (EP-10, S-10.01 – S-10.04): two periods of NASA POWER daily weather compared, with a trend
 * test over the whole annual series. Every number comes from the POWER series; nothing is modelled or forecast.
 *
 *   GET /api/w/:ws/fields/:id/climate-shift      → ClimateShift (pending until the POWER gather task is done)
 *   POST /api/public/climate-shift {lon, lat}    → ClimateShift (no account; climate only)
 */

export type ClimateMetricId =
  | "seasonTemp" // mean temperature of the growing season, °C
  | "hotDaysFlowering" // days with Tmax above the crop's threshold inside its flowering window
  | "seasonPrecip" // growing-season precipitation, mm
  | "longestDrySpell" // longest run of days under 1 mm inside the growing season
  | "gdd" // growing degree days, base 10 °C, cap 30 °C
  | "lastSpringFrost" // day of year of the last Tmin ≤ 0 °C before mid-season
  | "firstAutumnFrost" // day of year of the first Tmin ≤ 0 °C after mid-season
  | "frostFreeDays";

export type ClimateUnit = "degC" | "days" | "mm" | "degDays" | "dayOfYear";

/** Theil–Sen slope and Mann–Kendall test over the annual series (two-sided; trend-free pre-whitening when needed). */
export interface ClimateTrend {
  /** Change per 10 years in the metric's unit; null when there are too few years. */
  slopePerDecade: number | null;
  pValue: number | null;
  /** pValue < alpha. False also when the test could not be run. */
  significant: boolean;
  /** Years that entered the test. */
  years: number;
}

export interface ClimateMetric {
  id: ClimateMetricId;
  unit: ClimateUnit;
  /** Mean over the baseline period; null when the metric has no value there (e.g. no frost at all). */
  baseline: number | null;
  recent: number | null;
  /** recent − baseline. */
  delta: number | null;
  trend: ClimateTrend;
  /** Years without the event (frost metrics): counted, never treated as zero. */
  yearsWithout?: { baseline: number; recent: number };
}

export interface ClimatePeriod {
  from: number;
  to: number;
}

export interface FloweringWindow {
  /** MM-DD, inclusive. */
  from: string;
  to: string;
  thresholdC: number;
  /** False until the owner has reviewed the cited value (data/crop-flowering.json). */
  verified: boolean;
  /** True when the crop is unknown or has no entry: "days above 35 °C in June–August" (mirrored in the south). */
  fallback: boolean;
  source: { title: string; publisher: string; url: string } | null;
}

/** Independent rainfall record (S-10.11): does GPM IMERG agree with POWER on the direction of the change? */
export interface GpmCheck {
  status: "ready" | "unavailable";
  /** Both halves are inside the IMERG record (2001 onwards). */
  early: ClimatePeriod | null;
  late: ClimatePeriod | null;
  /** Change of growing-season precipitation between the halves, percent. */
  powerChangePct: number | null;
  imergChangePct: number | null;
  /** Same sign (or both within ±2 %). */
  agree: boolean | null;
  lastDate: string | null;
}

export interface ClimateShift {
  status: "pending" | "ready" | "unavailable";
  /** Machine reason when unavailable: "weather-missing" | "too-few-years" | "outside-coverage". */
  reason?: string;
  periods: { baseline: ClimatePeriod; recent: ClimatePeriod };
  hemisphere: "north" | "south";
  /** Growing season, MM-DD inclusive. */
  season: { from: string; to: string };
  /** The field's main crop (library id) or null; the public point variant always has null. */
  crop: string | null;
  flowering: FloweringWindow;
  metrics: ClimateMetric[];
  /** Significance level of the trend test. */
  alpha: number;
  /** Years dropped because fewer than 90 % of their season days had data. */
  skippedYears: number[];
  source: {
    dataset: "NASA POWER";
    /** First and last day of the series used (ISO dates). */
    from: string;
    lastDate: string;
    /** Centre of the POWER grid cell the numbers belong to. */
    cell: { lat: number; lon: number };
    /** Neighbouring fields inside one cell share these numbers. */
    resolutionKm: number;
  } | null;
  gpm: GpmCheck | null;
}
