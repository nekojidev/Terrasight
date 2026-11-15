import type { DataBasisItem, Localised } from "@terrasight/shared";
import type { EngineResult } from "@terrasight/scenario-engine";
import type { PriceSource } from "./price-resolution.js";

/** What a rotation run really used (EP-10, S-10.12): built only from the run's own inputs and result. */
export interface RunBasisInput {
  /** `EngineResult.weather` of the run. */
  weather: EngineResult["weather"];
  /** First and last day of the bootstrap's first and last season window, and the last day of the newest weather. */
  firstDate: string | null;
  lastBootstrapDate: string | null;
  lastDate: string | null;
  /** The 2022 stress was simulated (2022 is in the history and margins exist). */
  stress2022: boolean;
  soilBasis: "ssurgo" | "soilgrids" | "default";
  /** Crop seasons that defined the current rotation, with the source of each. */
  history: Array<{ season: number; source: string }>;
}

const rank = { NASA: 0, USDA: 1, ESA: 2, other: 3 } as const;

/** Data basis of a rotation run: POWER weather years, crop history (CDL or MODIS estimate), soil. Nothing else. */
export function runDataBasis(i: RunBasisInput): DataBasisItem[] {
  const out: DataBasisItem[] = [];
  out.push({
    dataset: "NASA POWER",
    agency: "NASA",
    from: i.firstDate,
    to: i.lastBootstrapDate,
    lastDate: i.lastDate,
    supports: i.stress2022 ? ["weather-years", "stress-2022"] : ["weather-years"],
  });
  const span = (source: string) => {
    const years = i.history.filter((h) => h.source === source).map((h) => h.season);
    return years.length
      ? { from: `${Math.min(...years)}-01-01`, to: `${Math.max(...years)}-12-31`, lastDate: null }
      : null;
  };
  const cdl = span("cdl");
  if (cdl)
    out.push({ dataset: "USDA Cropland Data Layer", agency: "USDA", ...cdl, supports: ["crop-history"] });
  const ndvi = span("ndvi");
  if (ndvi)
    out.push({ dataset: "MODIS NDVI (MOD13Q1)", agency: "NASA", ...ndvi, supports: ["crop-estimate"] });
  const lpis = span("lpis");
  if (lpis)
    out.push({
      dataset: "Ukraine field-parcel register (LPIS)",
      agency: "other",
      ...lpis,
      supports: ["crop-history"],
    });
  if (i.soilBasis === "ssurgo")
    out.push({
      dataset: "USDA SSURGO",
      agency: "USDA",
      from: null,
      to: null,
      lastDate: null,
      supports: ["soil-water"],
    });
  else if (i.soilBasis === "soilgrids")
    out.push({
      dataset: "ISRIC SoilGrids",
      agency: "other",
      from: null,
      to: null,
      lastDate: null,
      supports: ["soil-water"],
    });
  return out.sort((a, b) => rank[a.agency] - rank[b.agency]);
}

interface RegionCropPrice {
  source?: string;
  asOf?: string;
}

/**
 * Where the prices of the run come from, in words, derived from the sources of the crops that were used: the company's
 * own values, or the library values "typed in" from the cited reports (never presented as a live market feed).
 */
export function priceBasisText(
  label: PriceSource | "mixed" | null,
  usedCrops: string[],
  regionCrops: Record<string, RegionCropPrice>,
): Localised | null {
  if (!label) return null;
  const company = { en: "your company prices", uk: "ціни вашої компанії" };
  if (label === "company") return company;
  const entries = [...new Set(usedCrops)].flatMap((c) => (regionCrops[c] ? [regionCrops[c]!] : []));
  const years = [...new Set(entries.map((e) => e.asOf).filter((a): a is string => !!a))].sort();
  const text = entries.map((e) => e.source ?? "").join(" ");
  const nass = /NASS/.test(text);
  const budgets = /K-State|KSU/.test(text) || /UNL/.test(text);
  const bits = [
    nass ? `USDA NASS Crop Values ${years.join(", ")} report` : null,
    budgets ? `K-State and UNL crop budgets (costs and yields)` : null,
  ].filter((b): b is string => !!b);
  const sources = [...new Set(entries.map((e) => e.source).filter((s): s is string => !!s))];
  const en = bits.length
    ? `Values typed in from the ${bits.join(" and from the ")}`
    : `Values typed in from: ${sources.join("; ") || "the price library"}`;
  const uk = bits.length
    ? `Значення вручну внесені зі звіту USDA NASS Crop Values ${years.join(", ")} та бюджетів K-State і UNL (витрати й урожайність)`
    : `Значення вручну внесені з: ${sources.join("; ") || "бібліотеки цін"}`;
  return label === "mixed"
    ? { en: `${en}; and ${company.en}`, uk: `${uk}; та ${company.uk}` }
    : { en, uk };
}
