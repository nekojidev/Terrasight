import type { EngineInput } from "@terrasight/scenario-engine";

export type PriceSource = "company" | "library";

/** The company's own entry for a crop (workspace_crop_prices), as the resolution needs it. */
export interface CompanyPrice {
  crop: string;
  pricePerT: number;
  variableCostPerHa: number;
  yieldRefTHa: number | null;
  irrigated: boolean | null;
  currency: string;
}

/** A library price entry (data/prices.json) reduced to what is used here. */
export interface LibraryPrice {
  verified: boolean;
  price: number | null;
  irrigated: { variableCost: number | null; yieldRef: number | null };
  dryland: { variableCost: number | null; yieldRef: number | null } | null;
}

export interface ResolvedPrices {
  prices: EngineInput["prices"];
  /** Where each priced crop's numbers come from. */
  sources: Record<string, PriceSource>;
  /** Yields (t/ha) for crops without a full price: company yield or a verified library yield. */
  yieldRefs: Record<string, number>;
  /** Crops the company priced but for which no yield exists anywhere (the user's yield is required). */
  needYield: string[];
}

/** The company's row for a field: an exact irrigation match wins over an "any" row. */
function companyRow(rows: CompanyPrice[], crop: string, irrigated: boolean): CompanyPrice | undefined {
  const mine = rows.filter((r) => r.crop === crop && (r.irrigated === null || r.irrigated === irrigated));
  return mine.find((r) => r.irrigated === irrigated) ?? mine[0];
}

/** Library numbers for the field's irrigation kind; null unless the entry is verified and complete. */
function libraryNumbers(e: LibraryPrice | undefined, irrigated: boolean) {
  if (!e?.verified) return null;
  const irr = e.irrigated;
  const dry = e.dryland ?? irr;
  const pick = irrigated && irr.variableCost != null ? irr : dry.variableCost != null ? dry : irr;
  return { price: e.price, variableCost: pick.variableCost, yieldRef: pick.yieldRef };
}

/**
 * Price precedence per crop: the company's own price (in the workspace currency) > a verified library price
 * (only when the workspace currency is the library's: no FX conversion) > missing. A company price without a
 * yield takes a verified library yield; with none it is "needYield", never a guess (the oblast averages in
 * data/ua-yields.json are context only).
 */
export function resolvePrices(args: {
  crops: string[];
  irrigated: boolean;
  currency: string;
  libraryCurrency: string;
  company: CompanyPrice[];
  library: Record<string, LibraryPrice>;
}): ResolvedPrices {
  const out: ResolvedPrices = { prices: {}, sources: {}, yieldRefs: {}, needYield: [] };
  const libOk = args.currency === args.libraryCurrency;
  for (const crop of args.crops) {
    const own = companyRow(args.company, crop, args.irrigated);
    const lib = libraryNumbers(args.library[crop], args.irrigated);
    const libYield = lib?.yieldRef ?? null;
    if (own && own.currency === args.currency) {
      const y = own.yieldRefTHa ?? libYield;
      if (y != null) {
        out.prices[crop] = { price: own.pricePerT, variableCost: own.variableCostPerHa, yieldRef: y };
        out.sources[crop] = "company";
        continue;
      }
      out.needYield.push(crop);
      continue;
    }
    if (libOk && lib && lib.price != null && lib.variableCost != null && lib.yieldRef != null) {
      out.prices[crop] = { price: lib.price, variableCost: lib.variableCost, yieldRef: lib.yieldRef };
      out.sources[crop] = "library";
      continue;
    }
    const y = own?.yieldRefTHa ?? libYield;
    if (y != null) out.yieldRefs[crop] = y;
  }
  return out;
}

/** Page-level label: all numbers from the company, all from the library, or both. */
export function priceLabel(sources: Record<string, PriceSource>, used: string[]): PriceSource | "mixed" | null {
  const set = new Set(used.map((c) => sources[c]).filter((s): s is PriceSource => !!s));
  return set.size === 0 ? null : set.size === 1 ? [...set][0]! : "mixed";
}
