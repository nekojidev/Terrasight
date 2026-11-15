import { cellKey } from "./geo.js";
import { httpJson, withRetry } from "./http.js";
import { readCogWindow, readRasterSoil, readWcsWindow } from "./soilgrids-raster.js";
import {
  SourceError,
  type FieldGeometry,
  type FetchContext,
  type SourceAdapter,
  type SourceResult,
} from "./types.js";

/**
 * SoilGrids 2.0 (ISRIC, 250 m) outside the US: the full soil source for tier B/C, as SSURGO is for the US.
 * Texture is the thickness-weighted mean over 0–100 cm (the crop root zone) and gives a class-typical water capacity and
 * hydrologic group (see texture.ts); organic carbon (ICBM) and pH are 0–30 cm topsoil values.
 */
export interface SoilGridsSummary {
  clayPct: number | null;
  sandPct: number | null;
  siltPct: number | null;
  /** Topsoil (0–30 cm) organic carbon, g/kg. Absent in soil cached before it was added. */
  ocGPerKg?: number | null;
  /** Topsoil (0–30 cm) pH in water. */
  ph?: number | null;
  /** Which path produced the numbers: the REST query, the WCS (250 m) or the COG files (1000 m). */
  via?: "rest" | "wcs" | "cog";
  resolutionM?: number;
  /** Raster paths only: 0 = pixels inside the field, else the radius (m) searched around its centre (SoilGrids has gaps). */
  searchRadiusM?: number;
  /** When a faster path failed first: why. */
  fallbackReason?: string;
}

interface SoilGridsResponse {
  properties?: {
    layers?: Array<{
      name: string;
      depths: Array<{ label: string; values: { mean: number | null } }>;
      unit_measure?: { d_factor?: number };
    }>;
  };
}

/** Layer thickness in cm, used as the weight when averaging depths. */
const THICKNESS: Record<string, number> = {
  "0-5cm": 5,
  "5-15cm": 10,
  "15-30cm": 15,
  "30-60cm": 30,
  "60-100cm": 40,
};
const TOPSOIL = ["0-5cm", "5-15cm", "15-30cm"];

/** Pure: SoilGrids query response → summary (tested with a minimal response). */
export function summariseSoilGrids(json: SoilGridsResponse): SoilGridsSummary {
  const layers = json.properties?.layers ?? [];
  const mean = (name: string, only?: string[]): number | null => {
    const layer = layers.find((l) => l.name === name);
    if (!layer) return null;
    let sum = 0;
    let weight = 0;
    for (const d of layer.depths) {
      const w = THICKNESS[d.label];
      if (!w || (only && !only.includes(d.label)) || d.values.mean === null) continue;
      sum += d.values.mean * w;
      weight += w;
    }
    if (!weight) return null;
    const factor = layer.unit_measure?.d_factor ?? 10; // g/kg → %, dg/kg → g/kg, pH × 10 → pH
    return Math.round((sum / weight / factor) * 10) / 10;
  };
  return {
    clayPct: mean("clay"),
    sandPct: mean("sand"),
    siltPct: mean("silt"),
    ocGPerKg: mean("soc", TOPSOIL),
    ph: mean("phh2o", TOPSOIL),
  };
}

/** REST gets this long before the raster fallback starts; REST + WCS + COG together fit in the 60 s task budget. */
export const SOILGRIDS_REST_MS = 20_000;
export const SOILGRIDS_WCS_MS = 12_000;
export const SOILGRIDS_COG_MS = 24_000;
const hasTexture = (s: SoilGridsSummary): boolean => s.clayPct !== null || s.sandPct !== null || s.siltPct !== null;

export type SoilGridsPath = "rest" | "wcs" | "cog";
export interface SoilGridsOptions {
  /** Start at this path (tests, live checks). The default is rest → wcs → cog. */
  only?: SoilGridsPath;
  restMs?: number;
  wcsMs?: number;
  cogMs?: number;
}

const stage = (ctx: FetchContext, ms: number): FetchContext => ({
  ...ctx,
  signal: AbortSignal.any([ctx.signal, AbortSignal.timeout(ms)]),
});
const why = (e: unknown): string => (e instanceof Error ? e.message : String(e));

/** REST, then the WCS (250 m), then the COG files (1000 m). A working fallback is a success, not a failure. */
export async function fetchSoilGrids(
  field: FieldGeometry,
  ctx: FetchContext,
  opts: SoilGridsOptions = {},
): Promise<SourceResult<SoilGridsSummary>> {
  const attribution = (via: SoilGridsPath) =>
    `ISRIC SoilGrids 2.0, ${via === "cog" ? "1000 m" : "250 m"} (CC BY 4.0)`;
  const result = (summary: SoilGridsSummary, via: SoilGridsPath, fallbackReason?: string) => ({
    status: "done" as const,
    payload: {
      ...summary,
      via,
      resolutionM: via === "cog" ? 1000 : 250,
      ...(fallbackReason ? { fallbackReason } : {}),
    },
    dataDate: null,
    attribution: attribution(via),
  });
  const notes: string[] = [];
  let outage = false; // a path failed for a reason other than "SoilGrids has no pixel here"
  const note = (path: string, e: unknown): void => {
    notes.push(`${path} ${why(e)}`);
    if (!(e instanceof SourceError && !e.retryable)) outage = true;
  };

  if (!opts.only || opts.only === "rest") {
    try {
      const props = ["clay", "sand", "silt", "soc", "phh2o"].map((p) => `property=${p}`).join("&");
      const depths = Object.keys(THICKNESS)
        .map((d) => `depth=${d}`)
        .join("&");
      const json = await httpJson<SoilGridsResponse>(
        `https://rest.isric.org/soilgrids/v2.0/properties/query?lon=${field.centroid.lon}&lat=${field.centroid.lat}&${props}&${depths}&value=mean`,
        { signal: ctx.signal, fetch: ctx.fetch, timeoutMs: opts.restMs ?? SOILGRIDS_REST_MS },
      );
      const summary = summariseSoilGrids(json);
      if (hasTexture(summary)) return result(summary, "rest");
      notes.push("REST has no value for this exact pixel"); // SoilGrids masks some pixels; neighbours may have data
    } catch (e) {
      note("REST", e);
      if (opts.only === "rest") throw e;
    }
  }

  if (!opts.only || opts.only === "wcs") {
    try {
      const c = stage(ctx, opts.wcsMs ?? SOILGRIDS_WCS_MS);
      const soil = await readRasterSoil(field, (prop, depth, centre) =>
        withRetry(() => readWcsWindow(prop, depth, centre, c), { attempts: 2, baseMs: 300, signal: c.signal }),
      );
      const summary = summariseSoilGrids({ properties: { layers: soil.layers } });
      if (hasTexture(summary))
        return result({ ...summary, searchRadiusM: soil.radiusM }, "wcs", notes.join("; ") || undefined);
      notes.push("WCS has no texture here");
    } catch (e) {
      note("WCS", e);
      if (opts.only === "wcs") throw e;
    }
  }

  try {
    const c = stage(ctx, opts.cogMs ?? SOILGRIDS_COG_MS);
    // files.isric.org drops parallel range requests (about 0.7 s each), hence one at a time + retries.
    const soil = await readRasterSoil(
      field,
      (prop, depth, centre) =>
        withRetry(() => readCogWindow(prop, depth, centre, c), { attempts: 3, baseMs: 300, signal: c.signal }),
      1,
    );
    const summary = summariseSoilGrids({ properties: { layers: soil.layers } });
    if (hasTexture(summary))
      return result({ ...summary, searchRadiusM: soil.radiusM }, "cog", notes.join("; ") || undefined);
    notes.push("COG has no texture here");
  } catch (e) {
    note("COG", e);
  }
  // Every path failed: retryable when any of them looked like an outage, not when SoilGrids simply has no pixel.
  throw new SourceError(
    outage ? `could not be read (${notes.join("; ")})` : "returned no soil data for this location",
    outage,
  );
}

export const soilgrids: SourceAdapter<SoilGridsSummary> = {
  id: "soilgrids",
  appliesTo: (field) => field.country !== "US",
  // v2: 0–100 cm texture plus organic carbon and pH (older cached entries have only 0–30 cm texture).
  cacheKey: (field) => `${cellKey(field.centroid.lon, field.centroid.lat, 0.0025)}:v2`,
  fetch: (field, ctx) => fetchSoilGrids(field, ctx),
};
