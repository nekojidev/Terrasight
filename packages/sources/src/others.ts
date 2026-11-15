import { cellKey } from "./geo.js";
import { httpJson } from "./http.js";
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

export const soilgrids: SourceAdapter<SoilGridsSummary> = {
  id: "soilgrids",
  appliesTo: (field) => field.country !== "US",
  // v2: 0–100 cm texture plus organic carbon and pH (older cached entries have only 0–30 cm texture).
  cacheKey: (field) => `${cellKey(field.centroid.lon, field.centroid.lat, 0.0025)}:v2`,
  async fetch(field: FieldGeometry, ctx: FetchContext): Promise<SourceResult<SoilGridsSummary>> {
    const props = ["clay", "sand", "silt", "soc", "phh2o"].map((p) => `property=${p}`).join("&");
    const depths = Object.keys(THICKNESS)
      .map((d) => `depth=${d}`)
      .join("&");
    const json = await httpJson<SoilGridsResponse>(
      `https://rest.isric.org/soilgrids/v2.0/properties/query?lon=${field.centroid.lon}&lat=${field.centroid.lat}&${props}&${depths}&value=mean`,
      { signal: ctx.signal, fetch: ctx.fetch, timeoutMs: 45_000 },
    );
    const summary = summariseSoilGrids(json);
    if (summary.clayPct === null && summary.sandPct === null && summary.siltPct === null)
      throw new SourceError("returned no soil data for this location", false);
    return {
      status: "done",
      payload: summary,
      dataDate: null,
      attribution: "ISRIC SoilGrids 2.0, 250 m (CC BY 4.0)",
    };
  },
};
