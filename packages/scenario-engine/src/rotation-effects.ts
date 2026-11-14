/**
 * Rotation yield effects: mean yield multipliers when a crop follows itself (verified by Oleksandr Baranovskyi,
 * 2026-11-14). Applied on top of the FAO-33 water response. Values are means; years vary widely.
 *
 * - Corn after corn, irrigated 0.88: Schlegel & Bond, "Alternative Cropping Systems with Limited Irrigation", K-State
 *   SWREC Report of Progress (Tribune, KS, 2013–2019: continuous corn 176 vs corn–wheat 201 bu/a).
 *   https://journals.newprairiepress.org/kaesrr/article/11127/galley/11020/download/
 * - Corn after corn, dryland 0.90: UNL CropWatch, Ortez & Elmore 2020 ("between 5% and 15%" for NE/SD rainfed
 *   districts; mid-point, transferred to the High Plains). https://cropwatch.unl.edu/2020/yield-penalties-continuous-corn-and-soybean-midwest-us
 * - Sorghum after sorghum, dryland 0.65; irrigated 1.0 (no significant difference): Schlegel, Holman & Thompson,
 *   "Wheat and Grain Sorghum in Four-Year Rotations", K-State SWREC 2018; Schlegel & Bond (above).
 *   https://ksu.janeway.systems/kaesrr/article/11408/galley/11298/download
 * - Wheat after wheat, dryland 0.74 (recrop wheat in WWSF vs wheat after sorghum–fallow): same 2018 SWREC report.
 * No yield bonus after alfalfa (K-State L-778 gives an N credit only, not modelled).
 */
export interface RotationEffect {
  crop: string;
  /** The previous season's crops that trigger the effect. */
  after: string[];
  irrigated: number;
  dryland: number;
}

export const ROTATION_EFFECTS: RotationEffect[] = [
  { crop: "corn", after: ["corn", "silage_corn"], irrigated: 0.88, dryland: 0.9 },
  { crop: "silage_corn", after: ["corn", "silage_corn"], irrigated: 0.88, dryland: 0.9 },
  { crop: "sorghum", after: ["sorghum", "forage_sorghum"], irrigated: 1.0, dryland: 0.65 },
  { crop: "winter_wheat", after: ["winter_wheat", "spring_wheat"], irrigated: 1.0, dryland: 0.74 },
];

/** Multiplier for `crop` given the previous season's crops. */
export function rotationEffect(crop: string, previous: string[], irrigated: boolean): number {
  const e = ROTATION_EFFECTS.find((x) => x.crop === crop && previous.some((p) => x.after.includes(p)));
  return e ? (irrigated ? e.irrigated : e.dryland) : 1;
}
