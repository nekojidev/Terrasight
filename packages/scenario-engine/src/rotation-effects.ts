/**
 * Rotation yield effects: mean yield multipliers when a crop follows itself (first four rows verified by Oleksandr
 * Baranovskyi, 2026-11-14). Applied on top of the FAO-33 water response. Values are means; years vary widely.
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
 *
 * Entries carry `verified`: the engine applies a coefficient only when verified is true. The unverified entries
 * (soybean, sunflower, canola, sugar beet; added 2026-11-15 from extension and peer-reviewed sources, NOT yet checked
 * by the team) are listed for the team to verify (set verified:true with verifiedBy and verifiedOn). Until then
 * results for rotations that repeat those crops carry the caveat "repeat-penalty-not-modelled:<crop>".
 */
export interface RotationEffect {
  crop: string;
  /** The previous season's crops that trigger the effect. */
  after: string[];
  /** Yield multiplier; null = the sources give no usable number (qualitative guidance only). */
  irrigated: number | null;
  dryland: number | null;
  /** Only a verified, numeric effect is applied. */
  verified: boolean;
  verifiedBy?: string;
  verifiedOn?: string;
  /** Citations (every unverified entry carries at least one). */
  sources?: Array<{ title: string; url: string; note: string }>;
}

const VERIFIED = { verified: true, verifiedBy: "Oleksandr Baranovskyi", verifiedOn: "2026-11-14" } as const;

const CANOLA_SOURCES: NonNullable<RotationEffect["sources"]> = [
  {
    title: "Canola Council of Canada: blackleg and crop rotation (2-year break advised; 3 years removes the yield-loss risk)",
    url: "https://canolacouncil.org/?p=18199",
    note: "Prairie rotation trials: about +5 bu/ac per extra year of break; no single canola-on-canola percent found, so no number.",
  },
  {
    title: "Influence of resistant cultivars and crop intervals on clubroot of canola (Can. J. Plant Sci. 99, 2019)",
    url: "https://complete.bioone.org/journals/canadian-journal-of-plant-science/volume-99/issue-6/cjps-2019-0018/Influence-of-resistant-cultivars-and-crop-intervals-on-clubroot-of/10.1139/cjps-2019-0018.full",
    note: "2-3 year breaks improve yield where clubroot is present; the effect depends on inoculum and resistance.",
  },
];

export const ROTATION_EFFECTS: RotationEffect[] = [
  { crop: "corn", after: ["corn", "silage_corn"], irrigated: 0.88, dryland: 0.9, ...VERIFIED },
  { crop: "silage_corn", after: ["corn", "silage_corn"], irrigated: 0.88, dryland: 0.9, ...VERIFIED },
  { crop: "sorghum", after: ["sorghum", "forage_sorghum"], irrigated: 1.0, dryland: 0.65, ...VERIFIED },
  { crop: "winter_wheat", after: ["winter_wheat", "spring_wheat"], irrigated: 1.0, dryland: 0.74, ...VERIFIED },
  // ---- Unverified (added 2026-11-15): not applied until the team verifies them ----
  {
    crop: "soybean",
    after: ["soybean"],
    irrigated: 0.93,
    dryland: 0.93,
    verified: false,
    sources: [
      {
        title: "Continuous soybean study challenges assumptions (Iowa State; literature 7 to 13% penalty)",
        url: "https://www.iasoybeans.com/newsroom/article/continuous-soybean-study-challenges-assumptions",
        note: "Literature range 7-13%; the 2023-26 Iowa trial found no significant loss yet.",
      },
      {
        title: "Planting soybean after soybean, part 1 (UNL CropWatch)",
        url: "https://cropwatch.unl.edu/2017/planting-soybean-after-soybean-part-1-planting-considerations",
        note: "Second-year soybean about 3-5% below soybean after corn; long-term trials 0 to 13% (Kentucky 2.3% mean, Ontario 6.5%, Wisconsin 0%). 0.93 is a placeholder mean of this range.",
      },
    ],
  },
  {
    crop: "sunflower",
    after: ["sunflower"],
    irrigated: null,
    dryland: null,
    verified: false,
    sources: [
      {
        title: "NDSU Extension, sunflower disease management (pp2300)",
        url: "https://www.ndsu.edu/agriculture/sites/default/files/2026-07/pp2300.pdf",
        note: "Return interval of 3-4 years or more because of Sclerotinia; no percent yield loss for a short return found, so no number.",
      },
    ],
  },
  { crop: "winter_canola", after: ["winter_canola", "spring_canola"], irrigated: null, dryland: null, verified: false, sources: CANOLA_SOURCES },
  { crop: "spring_canola", after: ["winter_canola", "spring_canola"], irrigated: null, dryland: null, verified: false, sources: CANOLA_SOURCES },
  {
    crop: "sugar_beet",
    after: ["sugar_beet"],
    irrigated: 0.85,
    dryland: 0.85,
    verified: false,
    sources: [
      {
        title: "Sugar beet monoculture trial with beet cyst nematode (Lelystad; Wageningen edepot 350186)",
        url: "https://edepot.wur.nl/350186",
        note: "After 5-7 consecutive beet crops sugar yield fell to 80-85% (nematode-infested upper bound).",
      },
      {
        title: "Shortened sugar beet rotations, long-term trial and survey (Frontiers in Plant Science 2018, 9:231)",
        url: "https://www.frontiersin.org/journals/plant-science/articles/10.3389/fpls.2018.00231/pdf",
        note: "No substantial yield loss from cutting the interval from 3 to 2 years; continuous-beet 0.85 is a placeholder.",
      },
    ],
  },
];

const matches = (x: RotationEffect, crop: string, previous: string[]) =>
  x.crop === crop && previous.some((p) => x.after.includes(p));

/** Multiplier for `crop` given the previous season's crops; only verified, numeric effects apply. */
export function rotationEffect(crop: string, previous: string[], irrigated: boolean): number {
  const e = ROTATION_EFFECTS.find((x) => matches(x, crop, previous));
  if (!e || !e.verified) return 1;
  return (irrigated ? e.irrigated : e.dryland) ?? 1;
}

/** True when `crop` repeats a crop whose repeat penalty the engine does not apply (unverified, or no number). */
export function repeatPenaltyUnmodelled(crop: string, previous: string[]): boolean {
  const e = ROTATION_EFFECTS.find((x) => matches(x, crop, previous));
  return !!e && (!e.verified || (e.irrigated === null && e.dryland === null));
}
