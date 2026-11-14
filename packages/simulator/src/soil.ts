import type { CropParams } from "./crops.js";

export type HydGroup = "A" | "B" | "C" | "D";

/**
 * SCS curve numbers for antecedent condition II (USDA NRCS TR-55, 1986, Table 2-2b, cultivated agricultural lands,
 * straight row, good hydrologic condition; fallow = bare soil).
 */
const CN: Record<CropParams["cover"], Record<HydGroup, number>> = {
  row: { A: 67, B: 78, C: 85, D: 89 },
  small_grain: { A: 63, B: 75, C: 83, D: 87 },
  legume_hay: { A: 58, B: 72, C: 81, D: 85 },
  fallow: { A: 77, B: 86, C: 91, D: 94 },
};

export function curveNumber(cover: CropParams["cover"], group: HydGroup | null): number {
  return CN[cover][group ?? "B"];
}

/** SCS-CN direct runoff for a daily rain P, mm (TR-55 Eq. 2-1 to 2-4, Ia = 0.2 S). */
export function scsRunoff(pMm: number, cn: number): number {
  const s = 25400 / cn - 254;
  const ia = 0.2 * s;
  return pMm <= ia ? 0 : (pMm - ia) ** 2 / (pMm - ia + s);
}

/**
 * Rainfall erosivity R from annual precipitation (Renard & Freimund 1994, Eq. for P < 850 mm:
 * R = 0.0483 · P^1.61, MJ mm ha⁻¹ h⁻¹ yr⁻¹; above 850 mm: R = 587.8 − 1.219 P + 0.004105 P²).
 */
export function erosivity(annualPmm: number): number {
  return annualPmm < 850 ? 0.0483 * annualPmm ** 1.61 : 587.8 - 1.219 * annualPmm + 0.004105 * annualPmm ** 2;
}

/** RUSLE LS for a 100 m slope (McCool et al. 1987/1989; m from the slope class). */
export function lsFactor(slopePct: number, lengthM = 100): number {
  const theta = Math.atan(slopePct / 100);
  const s = slopePct < 9 ? 10.8 * Math.sin(theta) + 0.03 : 16.8 * Math.sin(theta) - 0.5;
  const m = slopePct < 1 ? 0.2 : slopePct < 3.5 ? 0.3 : slopePct < 5 ? 0.4 : 0.5;
  return (lengthM / 22.13) ** m * s;
}

/**
 * Relative RUSLE index (RFC §7.1): R · LS · C with K and P held constant for the field, so options are compared by
 * how much of the year the soil is covered. Not an absolute soil-loss estimate.
 */
export function rusleIndex(annualPmm: number, slopePct: number, meanC: number): number {
  return erosivity(annualPmm) * lsFactor(slopePct) * meanC;
}

/**
 * ICBM, two-pool soil carbon model (Andrén & Kätterer 1997), annual step with input at the start of the year:
 * young pool Y decays at k1, a fraction h of it is humified into the old pool O decaying at k2; r scales both for
 * climate and soil. Defaults: k1 = 0.8, k2 = 0.006 yr⁻¹, h = 0.125 for crop residues (Andrén & Kätterer 1997).
 */
export interface IcbmState {
  young: number;
  old: number;
}

export function icbmStep(s: IcbmState, inputC: number, r = 1, k1 = 0.8, k2 = 0.006, h = 0.125): IcbmState {
  const y0 = s.young + inputC;
  const young = y0 * Math.exp(-k1 * r);
  const a = (h * k1 * y0) / (k2 - k1);
  const old = (s.old - a) * Math.exp(-k2 * r) + a * Math.exp(-k1 * r);
  return { young, old };
}

/** Steady state of ICBM for a constant input (closed form). */
export function icbmSteadyState(inputC: number, r = 1, k1 = 0.8, k2 = 0.006, h = 0.125): IcbmState {
  const young = (inputC * Math.exp(-k1 * r)) / (1 - Math.exp(-k1 * r));
  return { young, old: (h * inputC) / k2 / r };
}
