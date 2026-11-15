import { fromArrayBuffer, fromUrl } from "geotiff";
import { http, mapLimit } from "./http.js";
import { pointInPolygons } from "./geo.js";
import { SourceError, type FieldGeometry } from "./types.js";

/**
 * SoilGrids from ISRIC's rasters, the fallback when the REST query is slow or down. SoilGrids grids are in the
 * Interrupted Goode Homolosine projection (EPSG:152160, 250 m); proj4js has no `igh`, so the forward projection
 * is implemented here (verified against the rasters: WCS and COG values agree with each other at US and UA points).
 */

const R = 6378137;
const D = Math.PI / 180;
/** Latitude where Goode's Mollweide caps meet the sinusoidal belt, 40°44'11.8". */
const PHI0 = (40 + 44 / 60 + 11.8 / 3600) * D;
/** Central meridian (deg) of the 12 land lobes of `+proj=igh`. */
const CENTRAL = [-100, 30, -100, 30, -160, -60, 20, 140, -160, -60, 20, 140];

function mollweideTheta(phi: number): number {
  if (Math.abs(Math.abs(phi) - Math.PI / 2) < 1e-12) return Math.sign(phi) * (Math.PI / 2);
  const c = Math.PI * Math.sin(phi);
  let theta = phi;
  for (let i = 0; i < 50; i++) {
    const delta = (2 * theta + Math.sin(2 * theta) - c) / (2 + 2 * Math.cos(2 * theta));
    theta -= delta;
    if (Math.abs(delta) < 1e-12) break;
  }
  return theta;
}
const Y_SHIFT = Math.SQRT2 * Math.sin(mollweideTheta(PHI0)) - PHI0;

/** lon/lat (WGS84, degrees) → Interrupted Goode Homolosine metres (land version, as SoilGrids). */
export function ighForward(lon: number, lat: number): [number, number] {
  const phi = lat * D;
  let zone: number;
  if (phi >= PHI0) zone = lon <= -40 ? 1 : 2;
  else if (phi >= 0) zone = lon <= -40 ? 3 : 4;
  else if (phi >= -PHI0) zone = lon <= -100 ? 5 : lon <= -20 ? 6 : lon <= 80 ? 7 : 8;
  else zone = lon <= -100 ? 9 : lon <= -20 ? 10 : lon <= 80 ? 11 : 12;
  const cm = CENTRAL[zone - 1]!;
  const dl = (lon - cm) * D;
  let x: number;
  let y: number;
  if (zone <= 2 || zone >= 9) {
    const theta = mollweideTheta(phi);
    x = ((2 * Math.SQRT2) / Math.PI) * dl * Math.cos(theta);
    y = Math.SQRT2 * Math.sin(theta) - Math.sign(phi) * Y_SHIFT;
  } else {
    x = dl * Math.cos(phi);
    y = phi;
  }
  return [(x + cm * D) * R, y * R];
}

export type RasterPath = "wcs" | "cog";

/** A window of one SoilGrids layer in IGH metres: row-major values, `null` = no data. */
export interface LayerWindow {
  originX: number;
  originY: number;
  pixel: number;
  width: number;
  height: number;
  values: Array<number | null>;
}

export interface WindowStat {
  mean: number | null;
  /** 0 when the pixels inside the field were used, else the radius (m) of the neighbourhood search. */
  radiusM: number;
  pixels: number;
}

/** Search radii (m) around the centroid used when no valid pixel falls inside the field (SoilGrids has many gaps). */
export const SEARCH_RADII = [750, 1500, 3000];
export const WINDOW_HALF_M = 3000;

/**
 * Mean of the valid pixels inside the field; if none, of the valid pixels within the smallest radius (around the
 * centroid) that has any. `polygons` and `centre` are in the same CRS as the window.
 */
export function windowMean(
  win: LayerWindow,
  polygons: number[][][][],
  centre: [number, number],
): WindowStat {
  const px: Array<{ x: number; y: number; v: number }> = [];
  for (let r = 0; r < win.height; r++) {
    for (let c = 0; c < win.width; c++) {
      const v = win.values[r * win.width + c];
      if (v === null || v === undefined) continue;
      px.push({ x: win.originX + (c + 0.5) * win.pixel, y: win.originY - (r + 0.5) * win.pixel, v });
    }
  }
  const avg = (list: typeof px): number => list.reduce((a, p) => a + p.v, 0) / list.length;
  const inside = px.filter((p) => pointInPolygons(p.x, p.y, polygons));
  if (inside.length) return { mean: avg(inside), radiusM: 0, pixels: inside.length };
  for (const radiusM of SEARCH_RADII) {
    const near = px.filter((p) => Math.hypot(p.x - centre[0], p.y - centre[1]) <= radiusM);
    if (near.length) return { mean: avg(near), radiusM, pixels: near.length };
  }
  return { mean: null, radiusM: SEARCH_RADII.at(-1)!, pixels: 0 };
}

/** Parses a GeoTIFF (as bytes) into a LayerWindow; `noData` values become null. */
export async function parseWindow(buffer: ArrayBuffer, noData: (v: number) => boolean): Promise<LayerWindow> {
  const image = await (await fromArrayBuffer(buffer)).getImage();
  const [ox, oy] = image.getOrigin() as [number, number];
  const [rx] = image.getResolution() as [number, number];
  const data = (await image.readRasters({ samples: [0] }))[0] as ArrayLike<number>;
  return {
    originX: ox,
    originY: oy,
    pixel: Math.abs(rx),
    width: image.getWidth(),
    height: image.getHeight(),
    values: Array.from(data, (v) => (noData(v) ? null : v)),
  };
}

export const PROPERTIES = ["clay", "sand", "silt", "soc", "phh2o"] as const;
/** Read after the five above, best effort: a missing coarse-fragment layer never fails the soil. */
export const EXTRA_PROPERTIES = ["cfvo"] as const;
export const DEPTHS = ["0-5cm", "5-15cm", "15-30cm", "30-60cm", "60-100cm"] as const;
export type SoilProperty = (typeof PROPERTIES)[number];

const WCS = "https://maps.isric.org/mapserv";
const COG = "https://files.isric.org/soilgrids/latest/data_aggregated/1000m";

export function wcsUrl(prop: string, depth: string, centre: [number, number], half = WINDOW_HALF_M): string {
  const [x, y] = centre;
  return (
    `${WCS}?map=/map/${prop}.map&SERVICE=WCS&VERSION=2.0.1&REQUEST=GetCoverage` +
    `&COVERAGEID=${prop}_${depth}_mean&FORMAT=image/tiff` +
    `&SUBSET=x(${Math.round(x - half)},${Math.round(x + half)})&SUBSET=y(${Math.round(y - half)},${Math.round(y + half)})` +
    `&SUBSETTINGCRS=http://www.opengis.net/def/crs/EPSG/0/152160`
  );
}

export function cogUrl(prop: string, depth: string): string {
  return `${COG}/${prop}/${prop}_${depth}_mean_1000.tif`;
}

interface RasterCtx {
  signal: AbortSignal;
  fetch: typeof fetch;
}

/** WCS GetCoverage of one layer (tiny GeoTIFF). The WCS fills no-data with 0, which is never a real value here. */
export async function readWcsWindow(
  prop: string,
  depth: string,
  centre: [number, number],
  ctx: RasterCtx,
  timeoutMs = 15_000,
): Promise<LayerWindow> {
  const res = await http(wcsUrl(prop, depth, centre), { signal: ctx.signal, fetch: ctx.fetch, timeoutMs });
  const buffer = await res.arrayBuffer();
  const magic = new Uint8Array(buffer.slice(0, 4));
  const tiff = (magic[0] === 0x49 && magic[1] === 0x49) || (magic[0] === 0x4d && magic[1] === 0x4d);
  if (!tiff) throw new SourceError("WCS answered with an error document instead of a GeoTIFF", true);
  return parseWindow(buffer, (v) => v === 0);
}

/** 1000 m COG on files.isric.org, read with range requests (no-data −32768). */
export async function readCogWindow(
  prop: string,
  depth: string,
  centre: [number, number],
  ctx: RasterCtx,
  half = WINDOW_HALF_M,
): Promise<LayerWindow> {
  const image = await (await fromUrl(cogUrl(prop, depth), { allowFullFile: false }, ctx.signal)).getImage();
  const [ox, oy] = image.getOrigin() as [number, number];
  const [rx, ry] = image.getResolution() as [number, number];
  const col0 = Math.max(0, Math.floor((centre[0] - half - ox) / rx));
  const col1 = Math.min(image.getWidth(), Math.ceil((centre[0] + half - ox) / rx) + 1);
  const row0 = Math.max(0, Math.floor((centre[1] + half - oy) / ry));
  const row1 = Math.min(image.getHeight(), Math.ceil((centre[1] - half - oy) / ry) + 1);
  if (col1 <= col0 || row1 <= row0) throw new SourceError("lies outside the SoilGrids grid", false);
  const data = (
    await image.readRasters({ window: [col0, row0, col1, row1], samples: [0], signal: ctx.signal })
  )[0] as ArrayLike<number>;
  return {
    originX: ox + col0 * rx,
    originY: oy + row0 * ry,
    pixel: Math.abs(rx),
    width: col1 - col0,
    height: row1 - row0,
    values: Array.from(data, (v) => (v === -32768 ? null : v)),
  };
}

export interface RasterSoil {
  layers: Array<{
    name: string;
    depths: Array<{ label: string; values: { mean: number | null } }>;
    unit_measure: { d_factor: number };
  }>;
  radiusM: number;
  pixels: number;
}

/**
 * All 5 properties × 5 depths through `readWindow` (≤ `concurrency` in flight), reduced per layer by `windowMean`.
 * Fails (retryable) when a request fails, or when texture (clay/sand/silt) has no valid pixel at all.
 */
export async function readRasterSoil(
  field: FieldGeometry,
  readWindow: (prop: string, depth: string, centre: [number, number]) => Promise<LayerWindow>,
  concurrency = 6,
  withExtra = true,
): Promise<RasterSoil> {
  const centre = ighForward(field.centroid.lon, field.centroid.lat);
  const polygons = field.polygons.map((poly) => poly.map((ring) => ring.map(([lon, lat]) => ighForward(lon!, lat!))));
  const jobs = PROPERTIES.flatMap((prop) => DEPTHS.map((depth) => ({ prop, depth })));
  const stats: Array<{ prop: string; depth: string; stat: WindowStat }> = await mapLimit(jobs, concurrency, async ({ prop, depth }) => ({
    prop,
    depth,
    stat: windowMean(await readWindow(prop, depth, centre), polygons, centre),
  }));
  const extraJobs = withExtra ? EXTRA_PROPERTIES.flatMap((prop) => DEPTHS.map((depth) => ({ prop, depth }))) : [];
  const extra = await mapLimit(extraJobs, concurrency, async ({ prop, depth }) => {
    try {
      return { prop, depth, stat: windowMean(await readWindow(prop, depth, centre), polygons, centre) };
    } catch {
      return { prop, depth, stat: { mean: null, radiusM: 0, pixels: 0 } };
    }
  });
  stats.push(...extra);
  const layers: RasterSoil["layers"] = [...PROPERTIES, ...(withExtra ? EXTRA_PROPERTIES : [])].map((name) => ({
    name,
    unit_measure: { d_factor: 10 },
    depths: stats
      .filter((s) => s.prop === name)
      .map((s) => ({ label: s.depth, values: { mean: s.stat.mean } })),
  }));
  const clay = stats.filter((s) => s.prop === "clay" && s.stat.mean !== null);
  if (!clay.length) throw new SourceError("has no SoilGrids pixels near this location", false);
  return {
    layers,
    radiusM: Math.max(...clay.map((s) => s.stat.radiusM)),
    pixels: Math.min(...clay.map((s) => s.stat.pixels)),
  };
}
