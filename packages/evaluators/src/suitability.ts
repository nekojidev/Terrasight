// Land suitability: can this field be cropped at all? Pure: no I/O. Thresholds come from data/land-suitability.json;
// every value there carries a source and the MVP defaults are flagged `mvpDefault`. Conditions only: the check never
// says which crop. "unsuitable" stops crop recommendations (until an agronomist overrides), "limited" only warns,
// "unknown" never blocks.

export type SuitabilityStatus = "suitable" | "limited" | "unsuitable" | "unknown";
export type LandCoverClass = "built" | "water" | "flooded" | "trees" | "bare" | "snow" | "rangeland" | "crops";
/** Classes that are not farmland on a land-cover map (rangeland and crops are). */
export const NON_FARM_CLASSES: readonly LandCoverClass[] = ["built", "water", "flooded", "trees", "bare", "snow"];

export interface SuitabilityThreshold {
  value: number;
  unit: string;
  verified: boolean;
  verifiedBy?: string;
  verifiedOn?: string;
  mvpDefault?: boolean;
  note?: string;
  source: { title: string; publisher: string; url: string; accessed: string; note?: string };
}

export interface LandSuitabilityConfig {
  version: number;
  lcc: Record<"notSuitedFromClass" | "unsuitableShare" | "limitedShare", SuitabilityThreshold>;
  landCover: Record<"unsuitableShare" | "limitedShare" | "seasons", SuitabilityThreshold>;
  slope: Record<"limitedPct" | "unsuitablePct", SuitabilityThreshold>;
  coarseFragments: Record<"limitedPct" | "unsuitablePct", SuitabilityThreshold>;
  ph: Record<"limitedBelow" | "limitedAbove", SuitabilityThreshold>;
  sand: Record<"sandMinPct" | "socMaxGPerKg", SuitabilityThreshold>;
  depth: Record<"limitedBelowCm", SuitabilityThreshold>;
  ndvi: Record<"cropPeak" | "minSeasons", SuitabilityThreshold>;
}

export interface LccShare {
  /** Land capability class 1-8 (I-VIII). */
  cls: number;
  /** Share of the outline (0-1). */
  share: number;
}

export interface SuitabilityInputs {
  irrigated?: boolean | null;
  /** US SSURGO land capability class shares (non-irrigated and irrigated conditions). */
  lcc?: { nonIrrigated: LccShare[]; irrigated: LccShare[] } | null;
  /** Land-cover class shares per season (0-1), latest last; the source name is shown as the evidence. */
  landCover?: {
    source: string;
    seasons: Array<{ year: number; shares: Partial<Record<LandCoverClass, number>> }>;
  } | null;
  slopePct?: number | null;
  soil?: {
    coarseFragmentsPct?: number | null;
    ph?: number | null;
    sandPct?: number | null;
    ocGPerKg?: number | null;
    bedrockDepthCm?: number | null;
  } | null;
  /** NDVI peak of each season with data (null = no observation). */
  ndviPeaks?: Array<number | null> | null;
}

export interface SuitabilityReason {
  /** Stable code the UI maps to a sentence. */
  code: string;
  /** What this reason does to the status. */
  level: "limited" | "unsuitable";
  value: number | string;
  threshold: number | string;
  unit: string;
  /** Source of the threshold (publisher and title). */
  source: string;
  sourceUrl: string;
  verified: boolean;
  mvpDefault: boolean;
  /** Extra word for the sentence, e.g. the dominant land-cover class. */
  detail?: string;
}

export interface LandSuitability {
  status: SuitabilityStatus;
  reasons: SuitabilityReason[];
  share?: { landCover?: Partial<Record<LandCoverClass, number>>; lccNotSuited?: number };
  /** Which checks had data: the others were skipped (not "passed"). */
  checked: string[];
  thresholdsVersion: number;
}

const src = (t: SuitabilityThreshold): Pick<SuitabilityReason, "source" | "sourceUrl" | "verified" | "mvpDefault"> => ({
  source: `${t.source.publisher}: ${t.source.title}`,
  sourceUrl: t.source.url,
  verified: t.verified,
  mvpDefault: t.mvpDefault === true,
});

const pct = (share: number): number => Math.round(share * 100);
const round1 = (n: number): number => Math.round(n * 10) / 10;

/** Share of the outline in capability classes V-VIII, or null when SSURGO gave none. */
export function lccNotSuitedShare(classes: LccShare[], fromClass: number): number | null {
  const valid = classes.filter((c) => Number.isFinite(c.cls) && c.share > 0);
  if (!valid.length) return null;
  const total = valid.reduce((s, c) => s + c.share, 0);
  return valid.filter((c) => c.cls >= fromClass).reduce((s, c) => s + c.share, 0) / total;
}

/** Mean class shares of the latest `n` seasons. */
export function meanLandCover(
  seasons: Array<{ shares: Partial<Record<LandCoverClass, number>> }>,
  n: number,
): Partial<Record<LandCoverClass, number>> {
  const last = seasons.slice(-Math.max(1, n));
  const out: Partial<Record<LandCoverClass, number>> = {};
  const classes = new Set(last.flatMap((s) => Object.keys(s.shares) as LandCoverClass[]));
  for (const c of classes) out[c] = last.reduce((s, x) => s + (x.shares[c] ?? 0), 0) / last.length;
  return out;
}

export function landSuitability(inputs: SuitabilityInputs, cfg: LandSuitabilityConfig): LandSuitability {
  const reasons: SuitabilityReason[] = [];
  const checked: string[] = [];
  const share: NonNullable<LandSuitability["share"]> = {};
  const add = (r: SuitabilityReason): void => void reasons.push(r);

  // 1. US land capability class (NRCS): V-VIII are not suited to cultivation.
  if (inputs.lcc) {
    const classes =
      inputs.irrigated === true && inputs.lcc.irrigated.length ? inputs.lcc.irrigated : inputs.lcc.nonIrrigated;
    const s = lccNotSuitedShare(classes, cfg.lcc.notSuitedFromClass.value);
    if (s !== null) {
      checked.push("lcc");
      share.lccNotSuited = Math.round(s * 100) / 100;
      const u = cfg.lcc.unsuitableShare;
      const l = cfg.lcc.limitedShare;
      if (s >= u.value)
        add({ code: "lcc_not_suited", level: "unsuitable", value: pct(s), threshold: pct(u.value), unit: "%", ...src(u) });
      else if (s >= l.value)
        add({ code: "lcc_not_suited", level: "limited", value: pct(s), threshold: pct(l.value), unit: "%", ...src(l) });
    }
  }

  // 2. Land cover (Esri / Impact Observatory outside the US, CDL inside): built-up, water, wetland, trees, bare ground.
  if (inputs.landCover?.seasons.length) {
    checked.push("land_cover");
    const mean = meanLandCover(inputs.landCover.seasons, cfg.landCover.seasons.value);
    share.landCover = Object.fromEntries(
      Object.entries(mean).map(([k, v]) => [k, Math.round(v * 1000) / 1000]),
    ) as Partial<Record<LandCoverClass, number>>;
    const nonFarm = NON_FARM_CLASSES.reduce((s, c) => s + (mean[c] ?? 0), 0);
    const dominant = [...NON_FARM_CLASSES].sort((a, b) => (mean[b] ?? 0) - (mean[a] ?? 0))[0]!;
    const u = cfg.landCover.unsuitableShare;
    const l = cfg.landCover.limitedShare;
    if (nonFarm >= u.value)
      add({
        code: "land_cover_not_farmland",
        level: "unsuitable",
        value: pct(nonFarm),
        threshold: pct(u.value),
        unit: "%",
        detail: dominant,
        ...src(u),
      });
    else if (nonFarm >= l.value)
      add({
        code: "land_cover_not_farmland",
        level: "limited",
        value: pct(nonFarm),
        threshold: pct(l.value),
        unit: "%",
        detail: dominant,
        ...src(l),
      });
  }

  // 3. Slope (mean, DEM).
  if (inputs.slopePct != null) {
    checked.push("slope");
    const u = cfg.slope.unsuitablePct;
    const l = cfg.slope.limitedPct;
    if (inputs.slopePct > u.value)
      add({ code: "slope_steep", level: "unsuitable", value: round1(inputs.slopePct), threshold: u.value, unit: "%", ...src(u) });
    else if (inputs.slopePct > l.value)
      add({ code: "slope_steep", level: "limited", value: round1(inputs.slopePct), threshold: l.value, unit: "%", ...src(l) });
  }

  // 4. Soil (SoilGrids, SSURGO).
  const soil = inputs.soil;
  if (soil?.coarseFragmentsPct != null) {
    checked.push("coarse_fragments");
    const u = cfg.coarseFragments.unsuitablePct;
    const l = cfg.coarseFragments.limitedPct;
    const v = round1(soil.coarseFragmentsPct);
    if (v > u.value) add({ code: "coarse_fragments", level: "unsuitable", value: v, threshold: u.value, unit: "%", ...src(u) });
    else if (v > l.value) add({ code: "coarse_fragments", level: "limited", value: v, threshold: l.value, unit: "%", ...src(l) });
  }
  if (soil?.ph != null) {
    checked.push("ph");
    const lo = cfg.ph.limitedBelow;
    const hi = cfg.ph.limitedAbove;
    if (soil.ph < lo.value)
      add({ code: "ph_low", level: "limited", value: round1(soil.ph), threshold: lo.value, unit: "pH", ...src(lo) });
    else if (soil.ph > hi.value)
      add({ code: "ph_high", level: "limited", value: round1(soil.ph), threshold: hi.value, unit: "pH", ...src(hi) });
  }
  if (soil?.sandPct != null && soil.ocGPerKg != null) {
    checked.push("sandy");
    const s = cfg.sand.sandMinPct;
    const o = cfg.sand.socMaxGPerKg;
    if (soil.sandPct >= s.value && soil.ocGPerKg < o.value)
      add({
        code: "sandy_low_carbon",
        level: "limited",
        value: round1(soil.ocGPerKg),
        threshold: o.value,
        unit: "g/kg",
        detail: String(Math.round(soil.sandPct)),
        ...src(o),
      });
  }
  if (soil?.bedrockDepthCm != null) {
    checked.push("depth");
    const d = cfg.depth.limitedBelowCm;
    if (soil.bedrockDepthCm < d.value)
      add({ code: "soil_shallow", level: "limited", value: Math.round(soil.bedrockDepthCm), threshold: d.value, unit: "cm", ...src(d) });
  }

  // 5. NDVI: no season ever reached a crop-like peak.
  const peaks = (inputs.ndviPeaks ?? []).filter((p): p is number => p != null);
  if (peaks.length >= cfg.ndvi.minSeasons.value) {
    checked.push("ndvi");
    const t = cfg.ndvi.cropPeak;
    const best = Math.max(...peaks);
    if (best < t.value)
      add({
        code: "ndvi_never_crop",
        level: "limited",
        value: Math.round(best * 100) / 100,
        threshold: t.value,
        unit: "NDVI",
        detail: String(peaks.length),
        ...src(t),
      });
  }

  const status: SuitabilityStatus = !checked.length
    ? "unknown"
    : reasons.some((r) => r.level === "unsuitable")
      ? "unsuitable"
      : reasons.length
        ? "limited"
        : "suitable";
  return {
    status,
    reasons,
    ...(Object.keys(share).length ? { share } : {}),
    checked,
    thresholdsVersion: cfg.version,
  };
}

/** The stored override of an agronomist: while present, an "unsuitable" field behaves as cropland. */
export interface SuitabilityOverride {
  userId: string;
  userName?: string | null;
  at: string;
}

/** True when crop recommendations must be skipped: unsuitable and nobody overrode it. */
export function blocksCrops(
  suitability: Pick<LandSuitability, "status"> | null | undefined,
  override: unknown,
): boolean {
  return suitability?.status === "unsuitable" && !override;
}
