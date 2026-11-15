import type { DataBasisItem } from "@terrasight/shared";

/** An evidence item as stored on the recommendation (citations carry `kind: "citation"` and are skipped). */
export interface BasisEvidence {
  kind?: string;
  source?: string;
  from?: string;
  to?: string;
  series?: Array<{ date: string; dd: number; forecast?: boolean }>;
}

export interface BasisCrop {
  season: number;
  source: string;
  isOverride: boolean;
}

export interface BasisInput {
  evidence: BasisEvidence[];
  /** Crop seasons the evaluators could read (snapshot crops, or the field's saved seasons). */
  crops: BasisCrop[];
  /** Weather rows of the input snapshot: only dates and origins matter here. */
  weather: Array<{ date: string; origin: "power" | "observed" | "forecast" }>;
  /** Sentinel-2 observations of the snapshot (ISO dates). */
  ndviDates: string[];
  powerDataDate: string | null;
  /** Last data date of each source from the field's latest gather tasks: "power", "modis", "cdl", … */
  gathered: Partial<Record<string, string | null>>;
}

const iso = (d: string | undefined, end: boolean): string | null => {
  if (!d) return null;
  if (/^\d{4}$/.test(d)) return end ? `${d}-12-31` : `${d}-01-01`;
  return /^\d{4}-\d{2}-\d{2}/.test(d) ? d.slice(0, 10) : null;
};

const min = (a: string | null, b: string | null) => (a === null ? b : b === null ? a : a < b ? a : b);
const max = (a: string | null, b: string | null) => (a === null ? b : b === null ? a : a > b ? a : b);

function nextDay(d: string): string {
  return new Date(Date.parse(`${d}T00:00:00Z`) + 864e5).toISOString().slice(0, 10);
}

type Acc = Omit<DataBasisItem, "supports"> & { supports: Set<string> };

/**
 * "What NASA data contributed here" (EP-10, S-10.12): one item per dataset that really fed this recommendation, from
 * its evidence, the input snapshot and the field's gather tasks. A dataset that is not in the evidence never appears.
 * NASA datasets come first.
 */
export function buildDataBasis(input: BasisInput): DataBasisItem[] {
  const items = new Map<string, Acc>();
  const add = (
    dataset: string,
    agency: DataBasisItem["agency"],
    from: string | null,
    to: string | null,
    lastDate: string | null,
    supports: string[],
  ) => {
    const cur = items.get(dataset);
    if (!cur) {
      items.set(dataset, { dataset, agency, from, to, lastDate, supports: new Set(supports) });
      return;
    }
    cur.from = min(cur.from, from);
    cur.to = max(cur.to, to);
    cur.lastDate = max(cur.lastDate, lastDate);
    for (const s of supports) cur.supports.add(s);
  };

  const powerLast =
    input.powerDataDate ??
    input.gathered.power ??
    input.weather.filter((w) => w.origin === "power").reduce<string | null>((m, w) => max(m, w.date), null);

  for (const e of input.evidence) {
    if (e.kind === "citation" || !e.source) continue;
    const s = e.source;
    const from = iso(e.from, false);
    const to = iso(e.to, true);

    if (/POWER/i.test(s)) {
      const supports = /base [\d.]+ °C|degree/i.test(s)
        ? ["degree-days"]
        : /FAO-56|water balance/i.test(s)
          ? ["soil-water"]
          : ["weather-years"];
      // POWER ends at its last day; later days of the same evidence come from Open-Meteo.
      add("NASA POWER", "NASA", from, min(to, powerLast), powerLast, supports);
    }
    if (/Open-Meteo|NWS/i.test(s)) {
      const rows = input.weather.filter(
        (w) => w.origin !== "power" && (!from || w.date >= from) && (!to || w.date <= to),
      );
      const forecast =
        /forecast/i.test(s) || e.series?.some((p) => p.forecast) === true || rows.some((w) => w.origin === "forecast");
      const last = rows.reduce<string | null>((m, w) => max(m, w.date), null);
      add(
        /NWS/i.test(s) ? "Open-Meteo / NOAA NWS forecast" : "Open-Meteo",
        "other",
        max(from, powerLast ? nextDay(powerLast) : null),
        to,
        last,
        forecast ? ["forecast"] : [],
      );
    }
    if (/SSURGO/i.test(s)) add("USDA SSURGO", "USDA", null, null, null, ["soil-water"]);
    if (/SoilGrids/i.test(s)) add("ISRIC SoilGrids", "other", null, null, null, ["soil-water"]);
    if (/Sentinel/i.test(s)) {
      const seen = input.ndviDates.filter((d) => (!from || d >= from) && (!to || d <= to)).sort();
      add("Copernicus Sentinel-2 NDVI", "ESA", from, to, seen.at(-1) ?? to, ["green-bridge"]);
    }
    if (/Crop history/i.test(s)) {
      const y0 = Number(e.from);
      const y1 = Number(e.to);
      const read = input.crops.filter(
        (c) => !c.isOverride && (!Number.isFinite(y0) || c.season >= y0) && (!Number.isFinite(y1) || c.season <= y1),
      );
      const seasons = (source: string) => read.filter((c) => c.source === source).map((c) => c.season);
      const cdl = seasons("cdl");
      const ndvi = seasons("ndvi");
      if (cdl.length)
        add(
          "USDA Cropland Data Layer",
          "USDA",
          `${Math.min(...cdl)}-01-01`,
          `${Math.max(...cdl)}-12-31`,
          input.gathered.cdl ?? null,
          ["crop-history"],
        );
      if (ndvi.length)
        add(
          "MODIS NDVI (MOD13Q1)",
          "NASA",
          `${Math.min(...ndvi)}-01-01`,
          `${Math.max(...ndvi)}-12-31`,
          input.gathered.modis ?? null,
          ["crop-estimate"],
        );
    }
  }

  const rank = { NASA: 0, USDA: 1, ESA: 2, other: 3 } as const;
  return [...items.values()]
    .sort((a, b) => rank[a.agency] - rank[b.agency])
    .map((i) => ({ ...i, supports: [...i.supports] }));
}
