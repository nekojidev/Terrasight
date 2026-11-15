"use client";

import type { LngLat } from "@/lib/map-style";

/** Largest outline file we read in the browser. */
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
const FORMATS = [".geojson", ".json", ".kml", ".zip"];

/** Why a file was refused; the UI turns each code into "what is wrong" and "what to do". */
export type UploadErrorCode = "format" | "too-big" | "unreadable" | "no-polygon" | "too-few" | "self-intersect";

export class UploadError extends Error {
  constructor(public readonly code: UploadErrorCode) {
    super(code);
    this.name = "UploadError";
  }
}

/** Reads the file, reporting 0..1 while it loads (a large Shapefile zip can take a while on a phone). */
function readFile(file: File, onProgress?: (fraction: number) => void): Promise<ArrayBuffer> {
  if (typeof FileReader === "undefined") return file.arrayBuffer();
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onprogress = (e) => e.lengthComputable && onProgress?.(e.loaded / e.total);
    r.onload = () => resolve(r.result as ArrayBuffer);
    r.onerror = () => reject(r.error ?? new Error("read"));
    r.readAsArrayBuffer(file);
  });
}

/**
 * First polygon's outer ring from an uploaded GeoJSON, KML or zipped Shapefile (S-02.01). Parsed in the browser.
 * `onProgress` gets a fraction 0..1 (reading is the first 70%, parsing the rest). Throws `UploadError`.
 */
export async function ringFromFile(file: File, onProgress?: (fraction: number) => void): Promise<LngLat[]> {
  const name = file.name.toLowerCase();
  if (!FORMATS.some((f) => name.endsWith(f))) throw new UploadError("format");
  if (file.size > MAX_UPLOAD_BYTES) throw new UploadError("too-big");
  let geojson: unknown;
  try {
    const buf = await readFile(file, (f) => onProgress?.(f * 0.7));
    onProgress?.(0.7);
    if (name.endsWith(".zip")) {
      const shp = (await import("shpjs")).default;
      geojson = await shp(buf);
    } else if (name.endsWith(".kml")) {
      const { kml } = await import("@tmcw/togeojson");
      geojson = kml(new DOMParser().parseFromString(new TextDecoder().decode(buf), "text/xml"));
    } else {
      geojson = JSON.parse(new TextDecoder().decode(buf));
    }
  } catch {
    throw new UploadError("unreadable");
  }
  onProgress?.(0.95);
  const ring = firstRing(geojson);
  if (!ring) throw new UploadError("no-polygon");
  if (ring.length < 3) throw new UploadError("too-few");
  if (selfIntersects(ring)) throw new UploadError("self-intersect");
  onProgress?.(1);
  return ring;
}

function firstRing(node: unknown): LngLat[] | null {
  if (!node || typeof node !== "object") return null;
  if (Array.isArray(node)) {
    for (const n of node) {
      const r = firstRing(n);
      if (r) return r;
    }
    return null;
  }
  const o = node as { type?: string; coordinates?: unknown; geometry?: unknown; features?: unknown[] };
  if (o.type === "Polygon") return openRing((o.coordinates as number[][][])[0]!);
  if (o.type === "MultiPolygon") return openRing((o.coordinates as number[][][][])[0]![0]!);
  if (o.type === "Feature") return firstRing(o.geometry);
  if (o.type === "FeatureCollection") return firstRing(o.features);
  return null;
}

/** Drop the closing vertex; the map closes the ring itself. */
function openRing(ring: number[][]): LngLat[] {
  const pts = ring.map(([lon, lat]) => [lon!, lat!] as LngLat);
  const [a, b] = [pts[0], pts.at(-1)];
  return a && b && a[0] === b[0] && a[1] === b[1] ? pts.slice(0, -1) : pts;
}

const cross = (o: LngLat, a: LngLat, b: LngLat) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);

/** True when two non-adjacent edges of the closed ring cross (a "bow-tie"). Skipped above 3,000 points. */
export function selfIntersects(ring: LngLat[]): boolean {
  const n = ring.length;
  if (n < 4 || n > 3000) return false;
  for (let i = 0; i < n; i++) {
    const a = ring[i]!;
    const b = ring[(i + 1) % n]!;
    for (let j = i + 1; j < n; j++) {
      if (j === i + 1 || (i === 0 && j === n - 1)) continue;
      const c = ring[j]!;
      const d = ring[(j + 1) % n]!;
      if (cross(a, b, c) * cross(a, b, d) < 0 && cross(c, d, a) * cross(c, d, b) < 0) return true;
    }
  }
  return false;
}

/** "37.97, -100.87" → [lon, lat]; null if the text isn't coordinates. */
export function parseCoordinates(text: string): LngLat | null {
  const m = /^\s*(-?\d+(?:\.\d+)?)\s*[,;\s]\s*(-?\d+(?:\.\d+)?)\s*$/.exec(text);
  if (!m) return null;
  const lat = Number(m[1]);
  const lon = Number(m[2]);
  return Math.abs(lat) <= 90 && Math.abs(lon) <= 180 ? [lon, lat] : null;
}

export type AddFieldMode = "file" | "draw";
const MODE_KEY = "terrasight.addField.mode";

function visitStore(): Storage | null {
  try {
    return typeof sessionStorage === "undefined" ? null : sessionStorage;
  } catch {
    return null;
  }
}

/** The add-field mode chosen earlier in this visit (session only); "Upload a file" when none, or when storage is blocked. */
export function readAddFieldMode(store: Pick<Storage, "getItem"> | null = visitStore()): AddFieldMode {
  try {
    return store?.getItem(MODE_KEY) === "draw" ? "draw" : "file";
  } catch {
    return "file";
  }
}

export function writeAddFieldMode(mode: AddFieldMode, store: Pick<Storage, "setItem"> | null = visitStore()): void {
  try {
    store?.setItem(MODE_KEY, mode);
  } catch {
    /* private window or blocked storage: the default applies next time */
  }
}
