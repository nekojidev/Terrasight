import type { Localised } from "./decisions.js";

/**
 * Rotation ranking under different sets of weather years (EP-10, S-10.05, S-10.06). A sensitivity analysis of the
 * ranking to the years used, never a climate forecast. The recommendation itself stays on "all".
 *
 *   POST /api/w/:ws/fields/:id/scenario-runs/year-sets   → YearSetComparison
 */

export type YearSetId = "all" | "climate-1981-2000" | "last-15" | "trend-2030";

export const YEAR_SET_IDS: YearSetId[] = ["all", "climate-1981-2000", "last-15", "trend-2030"];

/** Weather shift of the "trend-2030" set: significant Theil–Sen slopes extended to 2028. Weather only. */
export interface YearSetShift {
  /** °C added to daily temperatures. 0 when the temperature trend is not significant. */
  deltaT: number;
  /** Factor on daily precipitation. 1 when the precipitation trend is not significant. */
  precipFactor: number;
  applied: { temperature: boolean; precipitation: boolean };
}

export interface YearSetOption {
  /** Scenario id, as in the rotation run ("current", a library rotation id, or "ai:…"). */
  id: string;
  /** 1 = best in this set (equal priorities). */
  rank: number;
  /** Mean margin per hectare per year in the workspace currency; null in agronomy-only mode. */
  margin: number | null;
  /** Mean margin (or relative yield in agronomy-only mode) in the worst 10 % of runs. */
  drought: number | null;
  score: number;
}

export interface YearSetRanking {
  id: YearSetId;
  /** Harvest years that entered the bootstrap. */
  years: { from: number; to: number; count: number };
  shift: YearSetShift | null;
  options: YearSetOption[];
  /** Id of the rank-1 option. */
  best: string;
}

export interface YearSetComparison {
  mode: "money" | "agronomy";
  currency: string | null;
  sets: YearSetRanking[];
  /** True when the rank-1 option is not the same in every set. */
  bestChanges: boolean;
  /** Display names of the options (same as the rotation run's names). */
  names: Record<string, Localised>;
}
