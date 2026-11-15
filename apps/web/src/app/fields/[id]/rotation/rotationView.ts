/** Pure view logic of the rotation screen: which notice shows, how reliable the pick is, where prices come from. */
import type { YearSetComparison, YearSetId, YearSetRanking } from "@terrasight/shared";

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

/* ------------------------------------------------------------------------------------------------------------------
 * Sensitivity to the weather years (EP-10, S-10.06, T10). Fixed rules over the comparison data, no AI. Every sentence
 * is derived from the sets' own rankings, never from the `bestChanges` flag alone, so no change can be stated that the
 * data does not contain.
 * ---------------------------------------------------------------------------------------------------------------- */

/** The sets that carry a ranking, in the fixed display order. A set without options counts as missing. */
export function usableSets(cmp: YearSetComparison, order: readonly YearSetId[]): YearSetRanking[] {
  const list = Array.isArray(cmp.sets) ? cmp.sets : [];
  return order.flatMap((id) => {
    const s = list.find((x) => x.id === id);
    return s && s.options.length > 0 ? [s] : [];
  });
}

/** The rank-1 option of a set, read from the options themselves (falls back to `best`). */
export function bestOf(s: YearSetRanking): string {
  return s.options.find((o) => o.rank === 1)?.id ?? s.best;
}

const orderOf = (s: YearSetRanking): string =>
  [...s.options]
    .sort((a, b) => a.rank - b.rank)
    .map((o) => o.id)
    .join("|");

export type YearSetFinding =
  | { kind: "none" }
  | {
      kind: "same";
      /** Same rank order of all options in every set (not only the same winner). */
      sameOrder: boolean;
      /** All the sets were calculated. */
      complete: boolean;
    }
  | {
      kind: "changes";
      allBest: string;
      changed: Array<{ set: YearSetId; best: string }>;
      /** The current rotation won in 1981–2000, not in the last 15 years, and ranks `rank` there. */
      currentNote: { rank: number } | null;
      complete: boolean;
    };

/** What the sets show. Needs "all" (the recommendation's basis) and one more set; otherwise nothing is stated. */
export function findYearSets(
  cmp: YearSetComparison,
  order: readonly YearSetId[],
  currentId: string,
): YearSetFinding {
  const sets = usableSets(cmp, order);
  const all = sets.find((s) => s.id === "all");
  if (!all || sets.length < 2) return { kind: "none" };
  const complete = sets.length === order.length;
  const allBest = bestOf(all);
  const changed = sets
    .filter((s) => s.id !== "all" && bestOf(s) !== allBest)
    .map((s) => ({ set: s.id, best: bestOf(s) }));
  if (changed.length === 0)
    return { kind: "same", sameOrder: sets.every((s) => orderOf(s) === orderOf(all)), complete };
  const early = sets.find((s) => s.id === "climate-1981-2000");
  const late = sets.find((s) => s.id === "last-15");
  const rank = late?.options.find((o) => o.id === currentId)?.rank;
  const currentNote =
    early && late && bestOf(early) === currentId && bestOf(late) !== currentId && rank !== undefined
      ? { rank }
      : null;
  return { kind: "changes", allBest, changed, currentNote, complete };
}
