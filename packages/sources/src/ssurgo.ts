import { geometryHash } from "./geo.js";
import { httpJson } from "./http.js";
import {
  SourceError,
  type FieldGeometry,
  type FetchContext,
  type SourceAdapter,
  type SourceResult,
} from "./types.js";

/** Soil properties for the field, area-weighted over SSURGO map units (Tech Design §13). */
export interface SoilSummary {
  /** Available water storage 0–150 cm, mm (from cm; FAO-56 TAW input). */
  awsMm: number | null;
  /** Available water storage 0–100 cm (≈ crop root zone), mm. Optional: absent in soil cached before it was added. */
  aws100Mm?: number | null;
  /** Dominant hydrologic soil group (SCS-CN). */
  hydrologicGroup: string | null;
  drainageClass: string | null;
  /** Representative slope, %. */
  slopePct: number | null;
  mapUnits: Array<{ mukey: string; name: string; share: number }>;
  /** Where the numbers come from (absent = SSURGO). SoilGrids values are class-typical estimates. */
  basis?: "ssurgo" | "soilgrids";
  /** Topsoil organic carbon, g/kg (SoilGrids 0–30 cm), the ICBM input outside the US. */
  organicCarbonGPerKg?: number | null;
  /** Topsoil pH in water (SoilGrids 0–30 cm). */
  ph?: number | null;
}

const SDA = "https://sdmdataaccess.sc.egov.usda.gov/Tabular/post.rest";

function wkt(polygons: number[][][][]): string {
  const ring = (r: number[][]) => `(${r.map(([x, y]) => `${x!.toFixed(7)} ${y!.toFixed(7)}`).join(",")})`;
  const parts = polygons.map((p) => `(${p.map(ring).join(",")})`);
  return parts.length === 1 ? `POLYGON${parts[0]}` : `MULTIPOLYGON(${parts.join(",")})`;
}

interface SdaTable {
  Table?: string[][];
}

async function sda(query: string, ctx: FetchContext): Promise<string[][]> {
  const json = await httpJson<SdaTable>(SDA, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ format: "JSON+COLUMNNAME", query }),
    signal: ctx.signal,
    fetch: ctx.fetch,
  });
  return json.Table ?? [];
}

export function summariseSoil(areas: string[][], attrs: string[][]): SoilSummary {
  const [, ...areaRows] = areas;
  const [header, ...attrRows] = attrs;
  if (!areaRows.length) throw new SourceError("returned no map units for this field", false);
  const col = (name: string) => header?.indexOf(name) ?? -1;
  const byKey = new Map(attrRows.map((r) => [r[col("mukey")]!, r]));
  const total = areaRows.reduce((s, r) => s + Number(r[1]), 0);
  const units = areaRows
    .map((r) => ({ mukey: r[0]!, share: Number(r[1]) / total, attrs: byKey.get(r[0]!) }))
    .sort((a, b) => b.share - a.share);

  const weighted = (name: string, factor = 1): number | null => {
    let sum = 0,
      w = 0;
    for (const u of units) {
      const v = u.attrs?.[col(name)];
      if (v === undefined || v === null || v === "") continue;
      sum += Number(v) * factor * u.share;
      w += u.share;
    }
    return w > 0 ? sum / w : null;
  };
  const dominant = (name: string): string | null => {
    const shares = new Map<string, number>();
    for (const u of units) {
      const v = u.attrs?.[col(name)];
      if (v) shares.set(v, (shares.get(v) ?? 0) + u.share);
    }
    return [...shares.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  };

  return {
    awsMm: weighted("aws0150wta", 10), // SSURGO reports cm
    aws100Mm: weighted("aws0100wta", 10),
    hydrologicGroup: dominant("hydgrpdcd"),
    drainageClass: dominant("drclassdcd"),
    slopePct: weighted("slopegraddcp"),
    mapUnits: units.map((u) => ({
      mukey: u.mukey,
      name: u.attrs?.[col("muname")] ?? "",
      share: Math.round(u.share * 1000) / 1000,
    })),
  };
}

export const ssurgo: SourceAdapter<SoilSummary> = {
  id: "ssurgo",
  appliesTo: (field) => field.country === "US",
  cacheKey: (field) => geometryHash(field.polygons),
  async fetch(field: FieldGeometry, ctx: FetchContext): Promise<SourceResult<SoilSummary>> {
    const g = wkt(field.polygons);
    const areas = await sda(
      `SELECT M.mukey, SUM(M.mupolygongeo.STIntersection(geometry::STGeomFromText('${g}',4326)).STArea()) AS area ` +
        `FROM mupolygon M WHERE M.mupolygongeo.STIntersects(geometry::STGeomFromText('${g}',4326)) = 1 GROUP BY M.mukey`,
      ctx,
    );
    const keys = areas.slice(1).map((r) => `'${r[0]!.replace(/\D/g, "")}'`);
    const attrs = keys.length
      ? await sda(
          `SELECT mukey, muname, aws0150wta, aws0100wta, hydgrpdcd, drclassdcd, slopegraddcp FROM muaggatt WHERE mukey IN (${keys.join(",")})`,
          ctx,
        )
      : [];
    const soil = summariseSoil(areas, attrs);
    const complete = soil.awsMm !== null && soil.hydrologicGroup !== null;
    return {
      status: complete ? "done" : "partial",
      payload: soil,
      dataDate: null,
      attribution: "USDA NRCS Soil Survey (SSURGO) via Soil Data Access",
      ...(complete ? {} : { reason: "Some soil properties are missing for this field" }),
    };
  },
};
