/**
 * Farm stress test (EP-10, S-10.13): margin at risk across the company's fields when the weather of 2022 repeats in the
 * first planned season on every field. Built from the stored rotation runs; no new model.
 *
 *   GET /api/w/:ws/farm-stress   → FarmStress
 */

export interface FarmStressField {
  fieldId: string;
  name: string;
  areaHa: number;
  /** Typical margin of that season minus its margin under 2022 weather, for the whole field. */
  currentLoss: number;
  recommendedLoss: number;
  /** Scenario id of the recommended option (equal priorities); may equal the current plan. */
  recommendedId: string;
}

export type FarmStressSkip = "no-run" | "no-2022-weather" | "no-prices" | "land-unsuitable";

export interface FarmStress {
  status: "ready" | "unavailable";
  stressYear: number;
  /** The planned season that receives the stress weather (the first one, e.g. 2026). */
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
