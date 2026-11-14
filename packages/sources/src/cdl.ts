import { CRS, geometryHash, pointInPolygons, projectPolygons, bboxOf } from "./geo.js";
import { http, mapLimit } from "./http.js";
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
 * USDA Cropland Data Layer per season (RFC §6.1, tier A).
 * - 2008–2021: exact pixel histogram from the Planetary Computer COGs (30 m, masked by the field).
 * - 2022 → latest: CropScape point values on a grid inside the field (its file / stats endpoints time out).
 */
export interface CdlSeason {
  year: number;
  classes: Array<{ code: number; share: number }>;
  majorityCode: number;
  majorityShare: number;
  method: "pixels" | "samples";
  n: number;
}

export interface CdlHistory {
  seasons: CdlSeason[];
}

export const CDL_FIRST_YEAR = 2008;
const PC_LAST_YEAR = 2021;
const SAMPLE_GRID = 4; // up to 4 × 4 = 16 points per season
const CROPSCAPE_ATTEMPTS = 3;
const CROPSCAPE = "https://nassgeodata.gmu.edu/axis2/services/CDLService/GetCDLValue";

function histogram(codes: number[]): Array<{ code: number; share: number }> {
  const counts = new Map<number, number>();
  for (const c of codes) counts.set(c, (counts.get(c) ?? 0) + 1);
  return [...counts.entries()]
    .map(([code, n]) => ({ code, share: Math.round((n / codes.length) * 1000) / 1000 }))
    .sort((a, b) => b.share - a.share);
}

function season(year: number, codes: number[], method: CdlSeason["method"]): CdlSeason | null {
  const valid = codes.filter((c) => c > 0 && c < 255);
  if (!valid.length) return null;
  const classes = histogram(valid);
  return {
    year,
    classes,
    majorityCode: classes[0]!.code,
    majorityShare: classes[0]!.share,
    method,
    n: valid.length,
  };
}

/** Regular grid of sample points inside the field (Albers metres), centre first. */
export function samplePoints(polygonsAlbers: number[][][][], grid = SAMPLE_GRID): Array<[number, number]> {
  const [minX, minY, maxX, maxY] = bboxOf(polygonsAlbers);
  const pts: Array<[number, number]> = [];
  for (let i = 0; i < grid; i++)
    for (let j = 0; j < grid; j++) {
      const x = minX + ((i + 0.5) / grid) * (maxX - minX);
      const y = minY + ((j + 0.5) / grid) * (maxY - minY);
      if (pointInPolygons(x, y, polygonsAlbers)) pts.push([x, y]);
    }
  if (!pts.length) pts.push([(minX + maxX) / 2, (minY + maxY) / 2]);
  return pts;
}

export function parseCropScapeValue(xml: string): number | null {
  const m = /value:\s*(\d+)/.exec(xml);
  return m ? Number(m[1]) : null;
}

async function pcSeasons(
  field: FieldGeometry,
  albers: number[][][][],
  lastYear: number,
  ctx: FetchContext,
): Promise<CdlSeason[]> {
  const items = await stacSearch(
    {
      collections: ["usda-cdl"],
      intersects: { type: "Point", coordinates: [field.centroid.lon, field.centroid.lat] },
    },
    ctx,
    200,
  );
  const byYear = new Map<number, string>();
  for (const it of items) {
    if (!it.id.startsWith("cropland_")) continue;
    const year = Number(String(it.properties.start_datetime ?? "").slice(0, 4));
    const href = it.assets.cropland?.href;
    if (href && year >= CDL_FIRST_YEAR && year <= lastYear) byYear.set(year, href);
  }
  const years = [...byYear.keys()].sort();
  const out = await mapLimit(years, 6, async (year) => {
    const px = await readMasked(await signHref(byYear.get(year)!, ctx), albers, {
      nodata: 0,
      signal: ctx.signal,
    });
    return season(year, px.values, "pixels");
  });
  return out.filter((s): s is CdlSeason => s !== null);
}

/** One CropScape point value; a retryable failure (timeout, 5xx, network) is tried again after a short pause. */
async function cropScapeValue(
  year: number,
  [x, y]: [number, number],
  ctx: FetchContext,
): Promise<number | null> {
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await http(`${CROPSCAPE}?year=${year}&x=${x.toFixed(1)}&y=${y.toFixed(1)}`, {
        signal: ctx.signal,
        fetch: ctx.fetch,
        timeoutMs: 30_000,
      });
      return parseCropScapeValue(await res.text());
    } catch (e) {
      const retryable = e instanceof SourceError && e.retryable;
      if (!retryable || attempt >= CROPSCAPE_ATTEMPTS || ctx.signal.aborted) throw e;
      await new Promise((r) => setTimeout(r, 1_000 * attempt));
    }
  }
}

/**
 * A season from CropScape sample points. A point that still fails after its retries is left out: the season is
 * kept while at least half of the points answered (the majority crop is still well sampled), else it is missing.
 */
export async function cropScapeSeason(
  year: number,
  points: Array<[number, number]>,
  ctx: FetchContext,
): Promise<CdlSeason | null> {
  const codes = await mapLimit(points, 4, (p) => cropScapeValue(year, p, ctx).catch(() => undefined));
  const answered = codes.filter((c) => c !== undefined);
  if (answered.length < Math.ceil(points.length / 2)) return null;
  return season(
    year,
    answered.filter((c): c is number => c !== null),
    "samples",
  );
}

/** "2023", "2022–2024", "2022, 2024" — the missing seasons for the source status line. */
export function yearList(years: number[]): string {
  const sorted = [...years].sort((a, b) => a - b);
  const runs: string[] = [];
  for (let i = 0; i < sorted.length;) {
    let j = i;
    while (j + 1 < sorted.length && sorted[j + 1] === sorted[j]! + 1) j++;
    runs.push(j === i ? `${sorted[i]}` : `${sorted[i]}–${sorted[j]}`);
    i = j + 1;
  }
  return runs.join(", ");
}

export const cdl: SourceAdapter<CdlHistory> = {
  id: "cdl",
  appliesTo: (field) => field.country === "US",
  cacheKey: (field, { today }) => `${geometryHash(field.polygons)}:${today.slice(0, 4)}`,
  async fetch(field: FieldGeometry, ctx: FetchContext): Promise<SourceResult<CdlHistory>> {
    const albers = projectPolygons(field.polygons, CRS.albers);
    const thisYear = Number(ctx.today.slice(0, 4));
    // The CDL for a year is published early the next year; the current season is never available.
    const recentYears = Array.from({ length: thisYear - 1 - PC_LAST_YEAR }, (_, i) => PC_LAST_YEAR + 1 + i);
    const points = samplePoints(albers);

    const [historic, recent] = await Promise.all([
      pcSeasons(field, albers, PC_LAST_YEAR, ctx).catch(() => [] as CdlSeason[]),
      mapLimit(recentYears, 2, (y) => cropScapeSeason(y, points, ctx).catch(() => null)),
    ]);
    const seasons = [...historic, ...recent.filter((s): s is CdlSeason => s !== null)].sort(
      (a, b) => a.year - b.year,
    );
    if (!seasons.length) throw new SourceError("returned no crop history", true);
    const have = new Set(seasons.map((s) => s.year));
    const missingYears = Array.from(
      { length: thisYear - CDL_FIRST_YEAR },
      (_, i) => CDL_FIRST_YEAR + i,
    ).filter((y) => !have.has(y));
    const recentMissing = missingYears.filter((y) => y > PC_LAST_YEAR);
    const reason = missingYears.length
      ? recentMissing.length === missingYears.length
        ? `CropScape did not respond for ${yearList(recentMissing)}; we will try again tomorrow, or press Retry`
        : `${missingYears.length === 1 ? "1 season is" : `${missingYears.length} seasons are`} missing (${yearList(missingYears)})`
      : undefined;
    return {
      status: missingYears.length ? "partial" : "done",
      payload: { seasons },
      dataDate: `${seasons.at(-1)!.year}-12-31`,
      attribution: "USDA NASS Cropland Data Layer (CropScape; Planetary Computer for 2008–2021)",
      ...(reason ? { reason } : {}),
    };
  },
};
