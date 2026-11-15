import { geometryHash } from "./geo.js";
import { httpJson } from "./http.js";
import {
  SourceError,
  type FieldGeometry,
  type FetchContext,
  type SourceAdapter,
  type SourceResult,
} from "./types.js";

/** OpenET Ensemble monthly evapotranspiration for the field (US): irrigation detection and model check (RFC §6.2). */
export interface EtSeries {
  months: Array<{ month: string; etMm: number }>;
  /** Calendar-year sums for complete years. */
  annual: Array<{ year: number; etMm: number }>;
  /** Which product the numbers come from (absent = OpenET, from before WaPOR was added). */
  basis?: "openet" | "wapor";
}

const API = "https://openet-api.org/raster/timeseries/polygon";
/** The API accepts at most 10 years per request. */
const YEARS = 10;

export function openetAdapter(apiKey: string | undefined): SourceAdapter<EtSeries | null> {
  return {
    id: "openet",
    appliesTo: (f) => f.country === "US",
    cacheKey: (field, { today }) => `${geometryHash(field.polygons)}:${today.slice(0, 4)}`,
    async fetch(field: FieldGeometry, ctx: FetchContext): Promise<SourceResult<EtSeries | null>> {
      if (!apiKey) {
        return {
          status: "failed",
          payload: null,
          dataDate: null,
          attribution: "OpenET",
          reason: "OpenET is not configured (OPENET_API_KEY not set)",
        };
      }
      const lastYear = Number(ctx.today.slice(0, 4)) - 1;
      const outer = field.polygons[0]?.[0];
      if (!outer) throw new SourceError("field has no outline", false);
      const rows = await httpJson<Array<{ time: string; et: number }> | { detail?: string }>(API, {
        method: "POST",
        headers: { Authorization: apiKey, "Content-Type": "application/json" },
        body: JSON.stringify({
          date_range: [`${lastYear - YEARS + 1}-01-01`, `${lastYear}-12-31`],
          interval: "monthly",
          geometry: outer.flatMap(([lon, lat]) => [Number(lon!.toFixed(6)), Number(lat!.toFixed(6))]),
          model: "Ensemble",
          variable: "ET",
          reference_et: "gridMET",
          reducer: "mean",
          units: "mm",
          file_format: "JSON",
        }),
        signal: ctx.signal,
        fetch: ctx.fetch,
        timeoutMs: 120_000,
      });
      if (!Array.isArray(rows))
        throw new SourceError(`returned an error (${rows.detail ?? "unknown"})`, false);
      const months = rows
        .filter((r) => Number.isFinite(r.et))
        .map((r) => ({ month: r.time.slice(0, 7), etMm: Math.round(r.et * 10) / 10 }));
      const byYear = new Map<number, number[]>();
      for (const m of months) {
        const y = Number(m.month.slice(0, 4));
        byYear.set(y, [...(byYear.get(y) ?? []), m.etMm]);
      }
      const annual = [...byYear.entries()]
        .filter(([, v]) => v.length === 12)
        .map(([year, v]) => ({ year, etMm: Math.round(v.reduce((a, b) => a + b, 0)) }))
        .sort((a, b) => a.year - b.year);
      return {
        status: months.length ? "done" : "failed",
        payload: { months, annual },
        dataDate: months.length ? `${months.at(-1)!.month}-01` : null,
        attribution: "OpenET Ensemble (openetdata.org)",
        ...(months.length ? {} : { reason: "OpenET returned no months for this field" }),
      };
    },
  };
}
