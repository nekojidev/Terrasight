/** Pure view logic of the rotation screen: which notice shows, how reliable the pick is, where prices come from. */

export type Reliability = "high" | "medium" | "low";

/**
 * How far to trust the headline number. Not a statistic of its own: it only combines what the run already says.
 * Start high; drop a step for an estimated current rotation, for default soil, and (with money) for a pick that wins
 * in few price scenarios; two steps below 5 of 10.
 */
export function reliabilityOf(x: {
  agro: boolean;
  isCurrent: boolean;
  priceWins: number;
  currentBasis?: string | undefined;
  soilBasis?: string | undefined;
}): Reliability {
  let drop = 0;
  if (x.currentBasis === "estimated" || x.currentBasis === "missing") drop += 1;
  if (x.soilBasis === "default") drop += 1;
  if (!x.agro && !x.isCurrent) {
    if (x.priceWins < 5) drop += 2;
    else if (x.priceWins < 8) drop += 1;
  }
  return drop === 0 ? "high" : drop === 1 ? "medium" : "low";
}

export type NoticeKind = "land" | "agro" | "estimate";

/** One visible notice at most: land unsuitable or limited > agronomy-only mode > estimated current rotation. */
export function visibleNotice(x: {
  landLimited: boolean;
  agro: boolean;
  estimatedCurrent: boolean;
}): NoticeKind | null {
  if (x.landLimited) return "land";
  if (x.agro) return "agro";
  if (x.estimatedCurrent) return "estimate";
  return null;
}

/** Engine filter steps that were relaxed to find alternatives, as message keys in the Rotation namespace. */
const RELAXED: Record<string, string> = { precipitation: "relaxed_precipitation", slope: "relaxed_slope" };
export const relaxedKey = (id: string): string => RELAXED[id] ?? "relaxed_other";

/** Message key of a pest or disease label. Unknown ids get the generic wording and never reach the screen. */
export function pestKey(id: string, has: (key: string) => boolean): string {
  return has(`pest.${id}`) ? `pest.${id}` : "pest_unknown";
}

export type PriceLabel = "company" | "library" | "mixed" | null | undefined;

/**
 * The price source line from what the run says: the company's own prices, or the verified library of the region.
 * The library is US-only today (USDA NASS prices, K-State / UNL budgets); another region gets a neutral line.
 */
export function priceSourceKind(x: {
  priceLabel: PriceLabel;
  regionId?: string | null | undefined;
}): "company" | "mixed" | "library_us" | "library" | null {
  if (x.priceLabel === "company") return "company";
  if (x.priceLabel === "mixed") return "mixed";
  if (x.priceLabel === "library") return x.regionId?.startsWith("us-") ? "library_us" : "library";
  return null;
}

export type PlanStatus = "saved" | "proposed" | "none" | "unsuitable" | "no-library";

/** Status of one field in the plan overview. */
export function planStatus(f: {
  hasLibrary: boolean;
  suitability?: { status: string; override?: unknown } | null;
  plan: unknown;
  recommendation: unknown;
}): PlanStatus {
  if (f.suitability?.status === "unsuitable" && !f.suitability.override) return "unsuitable";
  if (!f.hasLibrary) return "no-library";
  if (f.plan) return "saved";
  if (f.recommendation) return "proposed";
  return "none";
}
