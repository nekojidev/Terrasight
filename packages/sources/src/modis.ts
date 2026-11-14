import { CRS, geometryHash, projectPolygons } from "./geo.js";
import { mapLimit } from "./http.js";
import { signHref, stacSearch, type StacItem } from "./planetary.js";
import { readMasked } from "./raster.js";
import {
  SourceError,
  type FieldGeometry,
  type FetchContext,
  type SourceAdapter,
  type SourceResult,
} from "./types.js";

/** MODIS 16-day NDVI series for the field (MOD13Q1 Terra + MYD13Q1 Aqua, 250 m), 2000 → latest. */
export interface NdviPoint {
  /** Composite start date, ISO. */
  date: string;
  /** Mean NDVI of good pixels inside the field, −1…1. */
  ndvi: number;
  /** Share of field pixels that were usable (quality, clouds). */
  coverage: number;
  platform: "terra" | "aqua";
}

export interface NdviSeries {
  points: NdviPoint[];
  pixelSizeM: number;
}

const SCALE = 0.0001;
const NODATA = -3000;
/** Below this share of usable pixels a composite is dropped as cloudy / poor quality. */
const MIN_COVERAGE = 0.5;
const CONCURRENCY = 8;

function compositeDate(item: StacItem): string {
  return String(item.properties.start_datetime ?? item.properties.datetime ?? "").slice(0, 10);
}

export const modis: SourceAdapter<NdviSeries> = {
  id: "modis",
  appliesTo: () => true,
  cacheKey: (field, { today }) => `${geometryHash(field.polygons)}:${today.slice(0, 7)}`,
  async fetch(field: FieldGeometry, ctx: FetchContext): Promise<SourceResult<NdviSeries>> {
    const items = await stacSearch(
      {
        collections: ["modis-13Q1-061"],
        intersects: { type: "Point", coordinates: [field.centroid.lon, field.centroid.lat] },
        datetime: `2000-02-18/${ctx.today}`,
        sortby: [{ field: "datetime", direction: "asc" }],
      },
      ctx,
    );
    if (!items.length) throw new SourceError("returned no MODIS composites for this location", false);
    const polygons = projectPolygons(field.polygons, CRS.sinusoidal);
    // Fields smaller than a 250 m pixel may contain no pixel centre: then use the pixel under the centroid.
    const [cx, cy] = projectPolygons(
      [[[[field.centroid.lon, field.centroid.lat]]]],
      CRS.sinusoidal,
    )[0]![0]![0]!;
    const centrePixel = [
      [
        [
          [cx! - 120, cy! - 120],
          [cx! + 120, cy! - 120],
          [cx! + 120, cy! + 120],
          [cx! - 120, cy! + 120],
          [cx! - 120, cy! - 120],
        ],
      ],
    ];
    const read = async (href: string) => {
      const r = await readMasked(href, polygons, { signal: ctx.signal });
      return r.inside > 0 ? r : readMasked(href, centrePixel, { signal: ctx.signal });
    };
    let failed = 0;

    const points = await mapLimit(items, CONCURRENCY, async (item): Promise<NdviPoint | null> => {
      const ndviAsset = item.assets["250m_16_days_NDVI"];
      const relAsset = item.assets["250m_16_days_pixel_reliability"];
      if (!ndviAsset || !relAsset) return null;
      try {
        const [ndvi, rel] = await Promise.all([
          read(await signHref(ndviAsset.href, ctx)),
          read(await signHref(relAsset.href, ctx)),
        ]);
        let sum = 0,
          n = 0;
        for (let i = 0; i < ndvi.values.length; i++) {
          const v = ndvi.values[i]!;
          const q = rel.values[i];
          if (v === NODATA || q === undefined || q > 1) continue; // reliability 0 good, 1 marginal
          sum += v * SCALE;
          n += 1;
        }
        const coverage = ndvi.inside ? n / ndvi.inside : 0;
        if (n === 0 || coverage < MIN_COVERAGE) return null;
        return {
          date: compositeDate(item),
          ndvi: Math.round((sum / n) * 1000) / 1000,
          coverage: Math.round(coverage * 100) / 100,
          platform: item.id.startsWith("MYD") ? "aqua" : "terra",
        };
      } catch {
        failed += 1;
        return null;
      }
    });

    const series = points
      .filter((p): p is NdviPoint => p !== null)
      .sort((a, b) => a.date.localeCompare(b.date));
    const status = series.length === 0 ? "failed" : failed / items.length > 0.1 ? "partial" : "done";
    return {
      status,
      payload: { points: series, pixelSizeM: 250 },
      dataDate: series.at(-1)?.date ?? null,
      attribution: "NASA MODIS MOD13Q1/MYD13Q1 v6.1 via Microsoft Planetary Computer",
      ...(status === "done"
        ? {}
        : { reason: `${failed} of ${items.length} NDVI composites could not be read` }),
    };
  },
};
