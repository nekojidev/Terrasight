import { geometryHash, projectPolygons } from "./geo.js";
import { mapLimit } from "./http.js";
import { signHref, stacSearch } from "./planetary.js";
import { readMasked } from "./raster.js";
import {
  SourceError,
  type FieldGeometry,
  type FetchContext,
  type SourceAdapter,
  type SourceResult,
} from "./types.js";

/**
 * Cropland per season outside the US (tier B/C, Ukraine first): the share of the field's 10 m pixels that the
 * Esri / Impact Observatory annual land cover (Sentinel-2, 2017 → 2023, Planetary Computer, CC BY 4.0) maps as "Crops".
 * It says whether a season was cropland, NOT which crop: the crop type stays an NDVI estimate (RFC §6.1).
 */
export interface CroplandSeason {
  year: number;
  /** Share of valid pixels classed "Crops" (0–1). */
  cropShare: number;
  n: number;
}

export interface CroplandHistory {
  product: string;
  seasons: CroplandSeason[];
}

export const CROPLAND_FIRST_YEAR = 2017;
/** Class value of "Crops" in io-lulc-annual-v02. */
const IO_CROPS = 5;
/** A season counts as cropland at or above this share of pixels. */
export const CROPLAND_MIN_SHARE = 0.5;
/** Below this share the NDVI crop guess is dropped: the satellite map sees grass, forest or built-up land. */
export const NOT_CROPLAND_SHARE = 0.2;

/** "36U" → UTM zone 36 north (the item ids of io-lulc-annual-v02 are `{zone}{band}-{year}`). */
export function utmProj(tileId: string): string | null {
  const m = /^(\d{1,2})([C-X])-/.exec(tileId);
  if (!m) return null;
  const north = m[2]! >= "N";
  return `+proj=utm +zone=${Number(m[1])}${north ? "" : " +south"} +datum=WGS84 +units=m +no_defs`;
}

export function cropShare(values: number[]): { cropShare: number; n: number } | null {
  const valid = values.filter((v) => v > 0 && v !== 10); // 0 = no data, 10 = clouds
  if (!valid.length) return null;
  const crops = valid.filter((v) => v === IO_CROPS).length;
  return { cropShare: Math.round((crops / valid.length) * 1000) / 1000, n: valid.length };
}

export const cropland: SourceAdapter<CroplandHistory> = {
  id: "cropland",
  appliesTo: (field) => field.country !== null && field.country !== "US",
  cacheKey: (field, { today }) => `${geometryHash(field.polygons)}:${today.slice(0, 4)}`,
  async fetch(field: FieldGeometry, ctx: FetchContext): Promise<SourceResult<CroplandHistory>> {
    const items = await stacSearch(
      {
        collections: ["io-lulc-annual-v02"],
        intersects: { type: "Point", coordinates: [field.centroid.lon, field.centroid.lat] },
      },
      ctx,
      50,
    );
    const seasons = await mapLimit(items, 4, async (it) => {
      const year = Number(String(it.properties.start_datetime ?? it.properties.datetime ?? "").slice(0, 4));
      const proj = utmProj(it.id);
      const href = it.assets.data?.href;
      if (!proj || !href || !year) return null;
      try {
        const px = await readMasked(await signHref(href, ctx), projectPolygons(field.polygons, proj), {
          nodata: 0,
          signal: ctx.signal,
        });
        const s = cropShare(px.values);
        return s ? { year, ...s } : null;
      } catch {
        return null;
      }
    });
    const ok = seasons.filter((s): s is CroplandSeason => s !== null).sort((a, b) => a.year - b.year);
    if (!ok.length) throw new SourceError("returned no land cover for this field", true);
    return {
      status: ok.length < items.length ? "partial" : "done",
      payload: { product: "Esri / Impact Observatory 10 m annual land cover", seasons: ok },
      dataDate: `${ok.at(-1)!.year}-12-31`,
      attribution:
        "Esri / Impact Observatory 10 m Annual Land Use Land Cover (CC BY 4.0, Planetary Computer)",
      ...(ok.length < items.length
        ? { reason: `${items.length - ok.length} season(s) could not be read` }
        : {}),
    };
  },
};
