/**
 * Farm stress test (EP-10, S-10.13): margin at risk across the company's fields when the weather of 2022 repeats in
 * one of the five planned seasons: the loss of the hit season, averaged over the five possible seasons, so the number
 * does not depend on what happens to be planted in one particular year. Built from the stored rotation runs; no new
 * model.
 *
 *   GET /api/w/:ws/farm-stress   → FarmStress
 */

export interface FarmStressField {
  fieldId: string;
  name: string;
  areaHa: number;
  /** Typical margin of the hit season minus its margin under 2022 weather (mean of the five placements), whole field. */
  currentLoss: number;
  recommendedLoss: number;
  /** Scenario id of the recommended option (equal priorities); may equal the current plan. */
  recommendedId: string;
}

export type FarmStressSkip = "no-run" | "no-2022-weather" | "no-prices" | "land-unsuitable";

export interface FarmStress {
  status: "ready" | "unavailable";
  stressYear: number;
  /** First planned season (e.g. 2026); the stress weather is placed in each of the five seasons from it in turn. */
  season: number;
  currency: string | null;
  /** Sum over the counted fields. */
  current: { atRisk: number; typical: number } | null;
  recommended: { atRisk: number; typical: number } | null;
  /** current.atRisk − recommended.atRisk (positive = the recommended plan loses less). */
  difference: number | null;
  counted: FarmStressField[];
  notCounted: Array<{ fieldId: string; name: string; reason: FarmStressSkip }>;
}
