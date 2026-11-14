import { cellKey } from "./geo.js";
import { httpJson } from "./http.js";
import {
  SourceError,
  type FieldGeometry,
  type FetchContext,
  type SourceAdapter,
  type SourceResult,
} from "./types.js";

/** SoilGrids 250 m (ISRIC) outside the US: texture at 0–30 cm as a rough water-capacity input (tier B/C). */
export interface SoilGridsSummary {
  clayPct: number | null;
  sandPct: number | null;
  siltPct: number | null;
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

export const soilgrids: SourceAdapter<SoilGridsSummary> = {
  id: "soilgrids",
  appliesTo: (field) => field.country !== "US",
  cacheKey: (field) => cellKey(field.centroid.lon, field.centroid.lat, 0.0025),
  async fetch(field: FieldGeometry, ctx: FetchContext): Promise<SourceResult<SoilGridsSummary>> {
    const props = ["clay", "sand", "silt"].map((p) => `property=${p}`).join("&");
    const depths = ["0-5cm", "5-15cm", "15-30cm"].map((d) => `depth=${d}`).join("&");
    const json = await httpJson<SoilGridsResponse>(
      `https://rest.isric.org/soilgrids/v2.0/properties/query?lon=${field.centroid.lon}&lat=${field.centroid.lat}&${props}&${depths}&value=mean`,
      { signal: ctx.signal, fetch: ctx.fetch, timeoutMs: 30_000 },
    );
    const layers = json.properties?.layers ?? [];
    const mean = (name: string): number | null => {
      const layer = layers.find((l) => l.name === name);
      const vals = layer?.depths.map((d) => d.values.mean).filter((v): v is number => v !== null) ?? [];
      if (!vals.length) return null;
      const factor = layer?.unit_measure?.d_factor ?? 10; // g/kg → %
      return Math.round((vals.reduce((a, b) => a + b, 0) / vals.length / factor) * 10) / 10;
    };
    const summary = { clayPct: mean("clay"), sandPct: mean("sand"), siltPct: mean("silt") };
    const any = Object.values(summary).some((v) => v !== null);
    if (!any) throw new SourceError("returned no soil data for this location", false);
    return {
      status: "done",
      payload: summary,
      dataDate: null,
      attribution: "ISRIC SoilGrids 2.0 (CC BY 4.0)",
    };
  },
};
