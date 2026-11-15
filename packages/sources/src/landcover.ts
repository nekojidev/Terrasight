import type { CdlHistory } from "./cdl.js";
import { bboxOf, geometryHash, projectPolygons } from "./geo.js";
import { mapLimit, withRetry, type RetryOptions } from "./http.js";
import { signHref, stacSearch, type StacItem } from "./planetary.js";
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
  /** Share of valid pixels per land-cover class (0–1), for the land suitability check. Absent in older cache entries. */
  shares?: Partial<Record<LandCoverClass, number>>;
}

export type LandCoverClass = "built" | "water" | "flooded" | "trees" | "bare" | "snow" | "rangeland" | "crops";

/** io-lulc-annual-v02 class values (1 water, 2 trees, 4 flooded vegetation, 5 crops, 7 built area, 8 bare ground, 9 snow / ice, 11 rangeland). */
const IO_CLASSES: Record<number, LandCoverClass> = {
  1: "water",
  2: "trees",
  4: "flooded",
  5: "crops",
  7: "built",
  8: "bare",
  9: "snow",
  11: "rangeland",
};

/** USDA CDL non-crop class codes → land-cover class (NASS cdl_codes); every other code is a crop. */
const CDL_CLASSES: Record<number, LandCoverClass> = {
  111: "water",
  83: "water",
  112: "snow",
  121: "built",
  122: "built",
  123: "built",
  124: "built",
  82: "built",
  131: "bare",
  65: "bare",
  141: "trees",
  142: "trees",
  143: "trees",
  63: "trees",
  87: "flooded",
  190: "flooded",
  195: "flooded",
  152: "rangeland",
  176: "rangeland",
  64: "rangeland",
};

/** US fields: land-cover class shares per season from the CDL pixel histogram (the US has no Esri adapter). */
export function landCoverFromCdl(
  cdl: CdlHistory,
): Array<{ year: number; shares: Partial<Record<LandCoverClass, number>> }> {
  return cdl.seasons.map((s) => {
    const shares: Partial<Record<LandCoverClass, number>> = {};
    for (const c of s.classes) {
      const cls = CDL_CLASSES[c.code] ?? "crops";
      shares[cls] = Math.round(((shares[cls] ?? 0) + c.share) * 1000) / 1000;
    }
    return { year: s.year, shares };
  });
}

export interface CroplandHistory {
  product: string;
  seasons: CroplandSeason[];
  /** Years the product has nothing for at this location (no item, or only cloud / no-data pixels): not an error. */
  noDataYears?: number[];
}

/** Last year of io-lulc-annual-v02 at the time of writing; a year without an item up to here is reported as "no data". */
export const CROPLAND_LAST_YEAR = 2023;

/** What happened to one season. `failed` is only for real read errors (after retries). */
export type SeasonOutcome =
  | { year: number; state: "ok"; cropShare: number; n: number; shares?: Partial<Record<LandCoverClass, number>> }
  | { year: number; state: "nodata" }
  | { year: number; state: "failed"; error: string };

const itemYear = (it: StacItem): number =>
  Number(String(it.properties.start_datetime ?? it.properties.datetime ?? "").slice(0, 4));

/**
 * Reads every season: items are grouped by year (a field on a tile border has two items per year), each tile is read
 * with retries and backoff, and a year with no item or no valid pixels is "nodata", not a failure. Pure apart from
 * `read` (injected so tests need no network).
 */
export async function readSeasons(
  items: StacItem[],
  read: (item: StacItem) => Promise<number[]>,
  opts: { concurrency?: number; retry?: RetryOptions } = {},
): Promise<SeasonOutcome[]> {
  const byYear = new Map<number, StacItem[]>();
  for (const it of items) {
    const year = itemYear(it);
    if (!year) continue;
    byYear.set(year, [...(byYear.get(year) ?? []), it]);
  }
  const years = new Set<number>(byYear.keys());
  for (let y = CROPLAND_FIRST_YEAR; y <= CROPLAND_LAST_YEAR; y++) years.add(y);
  const ordered = [...years].sort((a, b) => a - b);
  return mapLimit(ordered, opts.concurrency ?? 3, async (year): Promise<SeasonOutcome> => {
    const tiles = byYear.get(year) ?? [];
    if (!tiles.length) return { year, state: "nodata" };
    const values: number[] = [];
    for (const tile of tiles) {
      try {
        values.push(...(await withRetry(() => read(tile), { attempts: 3, baseMs: 500, ...opts.retry })));
      } catch (e) {
        return { year, state: "failed", error: (e as Error).message };
      }
    }
    const s = cropShare(values);
    return s ? { year, state: "ok", ...s } : { year, state: "nodata" };
  });
}

/** Outcomes → adapter result: partial (with the exact years) only when a read really failed. */
export function summariseCropland(outcomes: SeasonOutcome[]): SourceResult<CroplandHistory> {
  const ok = outcomes.filter((o): o is Extract<SeasonOutcome, { state: "ok" }> => o.state === "ok");
  const failed = outcomes.filter((o) => o.state === "failed").map((o) => o.year);
  const noData = outcomes.filter((o) => o.state === "nodata").map((o) => o.year);
  if (!ok.length) {
    if (failed.length) throw new SourceError(`could not read land cover for ${failed.join(", ")}`, true);
    throw new SourceError("has no land cover data for this field", false);
  }
  const parts = [
    failed.length ? `${failed.length} season(s) could not be read: ${failed.join(", ")}` : "",
    noData.length ? `no data for ${noData.join(", ")}` : "",
  ].filter(Boolean);
  return {
    status: failed.length ? "partial" : "done",
    payload: {
      product: "Esri / Impact Observatory 10 m annual land cover",
      seasons: ok.map(({ year, cropShare, n, shares }) => ({ year, cropShare, n, ...(shares ? { shares } : {}) })),
      ...(noData.length ? { noDataYears: noData } : {}),
    },
    dataDate: `${ok.at(-1)!.year}-12-31`,
    attribution: "Esri / Impact Observatory 10 m Annual Land Use Land Cover (CC BY 4.0, Planetary Computer)",
    ...(parts.length ? { reason: parts.join("; ") } : {}),
  };
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

export function cropShare(values: number[]): {
  cropShare: number;
  n: number;
  shares: Partial<Record<LandCoverClass, number>>;
} | null {
  const valid = values.filter((v) => v > 0 && v !== 10); // 0 = no data, 10 = clouds
  if (!valid.length) return null;
  const crops = valid.filter((v) => v === IO_CROPS).length;
  const counts = new Map<LandCoverClass, number>();
  for (const v of valid) {
    const c = IO_CLASSES[v];
    if (c) counts.set(c, (counts.get(c) ?? 0) + 1);
  }
  const shares = Object.fromEntries(
    [...counts.entries()].map(([c, n]) => [c, Math.round((n / valid.length) * 1000) / 1000]),
  ) as Partial<Record<LandCoverClass, number>>;
  return { cropShare: Math.round((crops / valid.length) * 1000) / 1000, n: valid.length, shares };
}

async function searchTiles(field: FieldGeometry, ctx: FetchContext, datetime?: string): Promise<StacItem[]> {
  // Only the tiles that intersect the field (a bbox polygon, so a field on a UTM tile border gets both tiles).
  const [w, s, e, n] = bboxOf(field.polygons);
  return stacSearch(
    {
      collections: ["io-lulc-annual-v02"],
      ...(datetime ? { datetime } : {}),
      intersects: {
        type: "Polygon",
        coordinates: [
          [
            [w, s],
            [e, s],
            [e, n],
            [w, n],
            [w, s],
          ],
        ],
      },
    },
    ctx,
    100,
  );
}

async function readTile(field: FieldGeometry, ctx: FetchContext, it: StacItem): Promise<number[]> {
  const proj = utmProj(it.id);
  const href = it.assets.data?.href;
  if (!proj || !href) throw new SourceError("returned a tile without a readable asset", false);
  const signal = AbortSignal.any([ctx.signal, AbortSignal.timeout(30_000)]);
  const px = await readMasked(await signHref(href, ctx), projectPolygons(field.polygons, proj), { nodata: 0, signal });
  return px.values; // empty when the window lies outside the tile
}

/**
 * The add-field preview's quick land-cover check: only the latest season, one STAC search and its tiles, no
 * caching (a few seconds). Null when the product has nothing for the outline.
 */
export async function fetchLatestLandCover(
  field: FieldGeometry,
  ctx: FetchContext,
): Promise<{ year: number; shares: Partial<Record<LandCoverClass, number>>; n: number } | null> {
  const items = await searchTiles(
    field,
    ctx,
    `${CROPLAND_LAST_YEAR}-01-01T00:00:00Z/${CROPLAND_LAST_YEAR}-12-31T23:59:59Z`,
  );
  const values: number[] = [];
  for (const it of items) {
    if (itemYear(it) !== CROPLAND_LAST_YEAR) continue;
    values.push(...(await readTile(field, ctx, it)));
  }
  const s = cropShare(values);
  return s ? { year: CROPLAND_LAST_YEAR, shares: s.shares, n: s.n } : null;
}

export const cropland: SourceAdapter<CroplandHistory> = {
  id: "cropland",
  appliesTo: (field) => field.country !== null && field.country !== "US",
  cacheKey: (field, { today }) => `${geometryHash(field.polygons)}:${today.slice(0, 4)}:v2`,
  async fetch(field: FieldGeometry, ctx: FetchContext): Promise<SourceResult<CroplandHistory>> {
    const items = await searchTiles(field, ctx);
    const outcomes = await readSeasons(items, (it) => readTile(field, ctx, it));
    return summariseCropland(outcomes);
  },
};
