import { fromUrl } from "geotiff";
import proj4 from "proj4";
import { mapLimit } from "../http.js";
import { signHref, stacSearch, type StacItem } from "../planetary.js";
import type { FetchContext } from "../types.js";
import { utmDef, type FieldGrid, type Grid } from "./grid.js";

/**
 * Cloud-masked Sentinel-2 L2A NDVI on the field grid, read from Cloud Optimized GeoTIFFs on Microsoft
 * Planetary Computer (`sentinel-2-l2a`). Only the byte ranges under the field are fetched.
 */
export const S2_COLLECTION = "sentinel-2-l2a";
/** SCL classes kept: 4 vegetation, 5 not vegetated (bare soil). Cloud, shadow, cirrus, snow, water, no data are dropped. */
export const CLEAR_SCL = new Set([4, 5]);
export const S2_ATTRIBUTION =
  "Contains modified Copernicus Sentinel-2 L2A data (ESA) via Microsoft Planetary Computer";

export interface Scene {
  id: string;
  /** ISO datetime. */
  datetime: string;
  epsg: number;
  /** Processing baseline major version; >= 4 adds a +1000 offset to the digital numbers. */
  baselineMajor: number;
  cloud: number;
  hrefs: { B04: string; B08: string; SCL: string };
}

/** Distinct acquisitions (the archive holds reprocessed copies of the same scene), least cloudy first. */
export function toScenes(items: StacItem[]): Scene[] {
  const byKey = new Map<string, Scene>();
  for (const it of items) {
    const p = it.properties as Record<string, unknown>;
    const epsg = Number(p["proj:epsg"] ?? String(p["proj:code"] ?? "").replace("EPSG:", ""));
    const b04 = it.assets.B04?.href;
    const b08 = it.assets.B08?.href;
    const scl = it.assets.SCL?.href;
    if (!epsg || !b04 || !b08 || !scl || !p.datetime) continue;
    const dt = String(p.datetime);
    const key = `${p["s2:mgrs_tile"] ?? ""}|${dt.slice(0, 19)}`;
    const baseline = Number(String(p["s2:processing_baseline"] ?? "5").split(".")[0]);
    const scene: Scene = {
      id: it.id,
      datetime: dt,
      epsg,
      baselineMajor: Number.isFinite(baseline) ? baseline : 5,
      cloud: Number(p["eo:cloud_cover"] ?? 100),
      hrefs: { B04: b04, B08: b08, SCL: scl },
    };
    if (!byKey.has(key)) byKey.set(key, scene);
  }
  return [...byKey.values()].sort((a, b) => a.cloud - b.cloud);
}

/** Growing-season window (inclusive ISO dates) searched for the peak: Apr 15 - Sep 30, or Nov 1 - Mar 31 in the south. */
export function seasonWindow(season: number, lat: number): [string, string] {
  return lat >= 0 ? [`${season}-04-15`, `${season}-09-30`] : [`${season}-11-01`, `${season + 1}-03-31`];
}

interface Sampled {
  data: ArrayLike<number>;
}

/**
 * Nearest-neighbour samples of a GeoTIFF band at the centre of every grid cell (0 where the image has no data or
 * does not reach). Works at any native resolution (10 m bands, 20 m SCL) and across UTM zones.
 */
export async function sampleToGrid(
  href: string,
  grid: Grid,
  itemEpsg: number,
  signal: AbortSignal,
): Promise<Sampled> {
  const image = await (await fromUrl(href, { allowFullFile: false }, signal)).getImage();
  const [ox, oy] = image.getOrigin() as [number, number];
  const [rx, ry] = image.getResolution() as [number, number];
  const same = itemEpsg === grid.epsg;
  const conv = same ? null : proj4(utmDef(grid.epsg), utmDef(itemEpsg));
  const n = grid.width * grid.height;
  const xs = new Float64Array(n);
  const ys = new Float64Array(n);
  let minX = Infinity,
    maxX = -Infinity,
    minY = Infinity,
    maxY = -Infinity;
  for (let r = 0; r < grid.height; r++)
    for (let c = 0; c < grid.width; c++) {
      let x = grid.x0 + (c + 0.5) * grid.res;
      let y = grid.y0 - (r + 0.5) * grid.res;
      if (conv) [x, y] = conv.forward([x, y]) as [number, number];
      const i = r * grid.width + c;
      xs[i] = x;
      ys[i] = y;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  const col0 = Math.max(0, Math.floor((minX - ox) / rx) - 1);
  const col1 = Math.min(image.getWidth(), Math.ceil((maxX - ox) / rx) + 2);
  const row0 = Math.max(0, Math.floor((maxY - oy) / ry) - 1);
  const row1 = Math.min(image.getHeight(), Math.ceil((minY - oy) / ry) + 2);
  const out = new Uint16Array(n);
  if (col1 <= col0 || row1 <= row0) return { data: out };
  const win = (await image.readRasters({ window: [col0, row0, col1, row1], samples: [0], signal }))[0] as ArrayLike<number>;
  const ww = col1 - col0;
  for (let i = 0; i < n; i++) {
    const col = Math.floor((xs[i]! - ox) / rx) - col0;
    const row = Math.floor((ys[i]! - oy) / ry) - row0;
    if (col < 0 || row < 0 || col >= ww || row >= row1 - row0) continue;
    out[i] = win[row * ww + col]!;
  }
  return { data: out };
}

/** NDVI from digital numbers (with the post-2022 +1000 offset removed); NaN where not clear. */
export function ndviFromBands(
  red: ArrayLike<number>,
  nir: ArrayLike<number>,
  scl: ArrayLike<number>,
  baselineMajor: number,
): Float32Array {
  const offset = baselineMajor >= 4 ? 1000 : 0;
  const out = new Float32Array(red.length).fill(NaN);
  for (let i = 0; i < red.length; i++) {
    if (!CLEAR_SCL.has(scl[i]!) || red[i]! === 0 || nir[i]! === 0) continue;
    const r = Math.max(0, red[i]! - offset) / 10_000;
    const n = Math.max(0, nir[i]! - offset) / 10_000;
    if (r + n <= 0) continue;
    out[i] = Math.min(1, Math.max(-0.2, (n - r) / (n + r)));
  }
  return out;
}

/** Share of the field's cells that are clear in the scene's SCL. */
export function clearShare(scl: ArrayLike<number>, inside: Uint8Array): number {
  let total = 0;
  let clear = 0;
  for (let i = 0; i < inside.length; i++) {
    if (!inside[i]) continue;
    total += 1;
    if (CLEAR_SCL.has(scl[i]!)) clear += 1;
  }
  return total ? clear / total : 0;
}

/** NDVI of one scene on the field grid, or null if too little of the field is clear (saves the band reads). */
export async function sceneNdvi(
  scene: Scene,
  fg: FieldGrid,
  ctx: FetchContext,
  minClear: number,
): Promise<{ ndvi: Float32Array; clear: number } | null> {
  const sclHref = await signHref(scene.hrefs.SCL, ctx);
  const scl = (await sampleToGrid(sclHref, fg.grid, scene.epsg, ctx.signal)).data;
  const clear = clearShare(scl, fg.inside);
  if (clear < minClear) return null;
  const [b04, b08] = await Promise.all([signHref(scene.hrefs.B04, ctx), signHref(scene.hrefs.B08, ctx)]);
  const [red, nir] = await Promise.all([
    sampleToGrid(b04, fg.grid, scene.epsg, ctx.signal),
    sampleToGrid(b08, fg.grid, scene.epsg, ctx.signal),
  ]);
  return { ndvi: ndviFromBands(red.data, nir.data, scl, scene.baselineMajor), clear };
}

/** q-quantile of a sorted array (nearest rank). */
export function quantileSorted(sorted: number[], q: number): number {
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(q * sorted.length) - 1))]!;
}

/** Per-pixel peak: the 90th percentile of the clear observations (robust to residual haze), >= `minObs` of them. */
export function peakOf(obs: Float32Array[], n: number, minObs = 3, q = 0.9): Float32Array {
  const out = new Float32Array(n).fill(NaN);
  const buf: number[] = [];
  for (let i = 0; i < n; i++) {
    buf.length = 0;
    for (const o of obs) {
      const v = o[i]!;
      if (!Number.isNaN(v)) buf.push(v);
    }
    if (buf.length < minObs) continue;
    buf.sort((a, b) => a - b);
    out[i] = quantileSorted(buf, q);
  }
  return out;
}

export interface SeasonPeak {
  season: number;
  peak: Float32Array;
  /** Scenes that contributed (clear enough over the field). */
  scenes: number;
  /** Scenes listed for the window. */
  listed: number;
}

export const MAX_SCENES_PER_SEASON = 40;
export const MIN_FIELD_CLEAR = 0.3;

/** Peak-season NDVI of one season: every usable scene of the window, per-pixel 90th percentile. */
export async function seasonPeak(
  fg: FieldGrid,
  bbox: [number, number, number, number],
  lat: number,
  season: number,
  ctx: FetchContext,
): Promise<SeasonPeak> {
  const [from, to] = seasonWindow(season, lat);
  const items = await stacSearch(
    {
      collections: [S2_COLLECTION],
      bbox,
      datetime: `${from}T00:00:00Z/${to}T23:59:59Z`,
      query: { "eo:cloud_cover": { lt: 80 } },
    },
    ctx,
  );
  const scenes = toScenes(items).slice(0, MAX_SCENES_PER_SEASON);
  const reads = await mapLimit(scenes, 6, async (s) => {
    try {
      return await sceneNdvi(s, fg, ctx, MIN_FIELD_CLEAR);
    } catch (e) {
      if (ctx.signal.aborted) throw e;
      return null; // one unreadable scene does not sink the season
    }
  });
  const obs = reads.filter((r): r is NonNullable<typeof r> => r !== null).map((r) => r.ndvi);
  return {
    season,
    peak: peakOf(obs, fg.grid.width * fg.grid.height),
    scenes: obs.length,
    listed: scenes.length,
  };
}

export interface LatestNdvi {
  date: string;
  sceneId: string;
  ndvi: Float32Array;
  /** Share of the field covered by clear pixels. */
  clear: number;
}

export const LATEST_MIN_CLEAR = 0.85;

/** The most recent (nearly) cloud-free scene over the field within `lookbackDays`; null when there is none. */
export async function latestNdvi(
  fg: FieldGrid,
  bbox: [number, number, number, number],
  ctx: FetchContext,
  lookbackDays = 150,
): Promise<LatestNdvi | null> {
  const from = new Date(Date.parse(`${ctx.today}T00:00:00Z`) - lookbackDays * 864e5).toISOString().slice(0, 10);
  const items = await stacSearch(
    {
      collections: [S2_COLLECTION],
      bbox,
      datetime: `${from}T00:00:00Z/${ctx.today}T23:59:59Z`,
      query: { "eo:cloud_cover": { lt: 60 } },
    },
    ctx,
  );
  const scenes = toScenes(items)
    .sort((a, b) => b.datetime.localeCompare(a.datetime))
    .slice(0, 12);
  for (const s of scenes) {
    const r = await sceneNdvi(s, fg, ctx, LATEST_MIN_CLEAR).catch(() => null);
    if (r) return { date: s.datetime.slice(0, 10), sceneId: s.id, ndvi: r.ndvi, clear: r.clear };
  }
  return null;
}
