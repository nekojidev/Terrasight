import { geometryHash, project, projectPolygons, CRS } from "./geo.js";
import { mapLimit } from "./http.js";
import { readMasked } from "./raster.js";
import type { EtSeries } from "./openet.js";
import {
  SourceError,
  type FieldGeometry,
  type FetchContext,
  type SourceAdapter,
  type SourceResult,
} from "./types.js";

/**
 * FAO WaPOR v3 actual evapotranspiration and interception, monthly, 300 m, global, 2018 → (public Google Cloud
 * COGs, no key). The global alternative to OpenET for irrigation detection and water use outside the US (RFC §6.2).
 * 300 m pixels are coarser than most fields: the value is the mean of the pixels whose centres lie in the field, or
 * the pixel under the centroid for a smaller field. Different model from OpenET: an estimate, labelled as such.
 */
export const WAPOR_FIRST_YEAR = 2018;
const BASE = "https://storage.googleapis.com/fao-gismgr-wapor-3-data/DATA/WAPOR-3/MOSAICSET/L1-UTM-AETI-M";
const SCALE = 0.1; // mm per count
const NODATA = -9999;
const BANDS = "CDEFGHJKLMNPQRSTUVWX";

/** WaPOR L1 tile id: UTM zone + latitude band, e.g. Poltava (34.55 E, 49.6 N) → "36U". */
export function waporTile(lon: number, lat: number): string {
  const zone = Math.floor((lon + 180) / 6) + 1;
  const band = BANDS[Math.min(BANDS.length - 1, Math.max(0, Math.floor((lat + 80) / 8)))]!;
  return `${zone}${band}`;
}

export function waporUrl(tile: string, month: string): string {
  return `${BASE}/WAPOR-3.L1-UTM-AETI-M.${tile}.${month}.tif`;
}

export function utmFor(tile: string): string {
  const zone = Number(tile.slice(0, -1));
  const north = tile.slice(-1) >= "N";
  return `+proj=utm +zone=${zone}${north ? "" : " +south"} +datum=WGS84 +units=m +no_defs`;
}

/** Monthly means to the same shape OpenET returns: months plus calendar-year sums of complete years. */
export function toEtSeries(months: Array<{ month: string; etMm: number }>): EtSeries {
  const byYear = new Map<number, number[]>();
  for (const m of months) {
    const y = Number(m.month.slice(0, 4));
    byYear.set(y, [...(byYear.get(y) ?? []), m.etMm]);
  }
  const annual = [...byYear.entries()]
    .filter(([, v]) => v.length === 12)
    .map(([year, v]) => ({ year, etMm: Math.round(v.reduce((a, b) => a + b, 0)) }))
    .sort((a, b) => a.year - b.year);
  return { months, annual, basis: "wapor" };
}

export function monthRange(today: string): string[] {
  const out: string[] = [];
  const [ty, tm] = today.split("-").map(Number) as [number, number];
  for (let y = WAPOR_FIRST_YEAR; y <= ty; y++)
    for (let m = 1; m <= 12; m++) {
      if (y === ty && m >= tm) break; // the current month is never complete
      out.push(`${y}-${String(m).padStart(2, "0")}`);
    }
  return out;
}

export const wapor: SourceAdapter<EtSeries> = {
  id: "wapor",
  appliesTo: (field) => field.country === "UA",
  cacheKey: (field, { today }) => `${geometryHash(field.polygons)}:${today.slice(0, 7)}`,
  async fetch(field: FieldGeometry, ctx: FetchContext): Promise<SourceResult<EtSeries>> {
    const tile = waporTile(field.centroid.lon, field.centroid.lat);
    const proj = utmFor(tile);
    const polygons = projectPolygons(field.polygons, proj);
    const [cx, cy] = project(CRS.wgs84, proj, field.centroid.lon, field.centroid.lat);
    // A field smaller than one pixel: use the 300 m cell that holds its centroid.
    const around = [
      [
        [
          [cx - 150, cy - 150],
          [cx + 150, cy - 150],
          [cx + 150, cy + 150],
          [cx - 150, cy + 150],
          [cx - 150, cy - 150],
        ],
      ],
    ];

    const monthsWanted = monthRange(ctx.today);
    const read = await mapLimit(monthsWanted, 6, async (month) => {
      const url = waporUrl(tile, month);
      try {
        let px = await readMasked(url, polygons, { nodata: NODATA, signal: ctx.signal });
        if (!px.values.length) px = await readMasked(url, around, { nodata: NODATA, signal: ctx.signal });
        if (!px.values.length) return null;
        const mean = px.values.reduce((a, b) => a + b, 0) / px.values.length;
        return { month, etMm: Math.round(mean * SCALE * 10) / 10 };
      } catch {
        return null; // month not published (the newest ones lag) or a transient error
      }
    });
    const months = read.filter((m): m is { month: string; etMm: number } => m !== null);
    if (months.length < 12) throw new SourceError("returned no evapotranspiration for this field", true);
    const payload = toEtSeries(months);
    const missing = monthsWanted.length - months.length;
    return {
      status: missing > 6 ? "partial" : "done",
      payload,
      dataDate: `${months.at(-1)!.month}-01`,
      attribution: "FAO WaPOR v3 actual evapotranspiration, 300 m (CC BY 4.0), pixel-averaged",
      ...(missing > 6 ? { reason: `${missing} months could not be read` } : {}),
    };
  },
};
