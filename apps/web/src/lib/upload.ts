"use client";

import type { LngLat } from "@/lib/map-style";

/** First polygon's outer ring from an uploaded GeoJSON, KML or zipped Shapefile (S-02.01). Parsed in the browser. */
export async function ringFromFile(file: File): Promise<LngLat[]> {
  const name = file.name.toLowerCase();
  let geojson: unknown;
  if (name.endsWith(".zip")) {
    const shp = (await import("shpjs")).default;
    geojson = await shp(await file.arrayBuffer());
  } else if (name.endsWith(".kml")) {
    const { kml } = await import("@tmcw/togeojson");
    geojson = kml(new DOMParser().parseFromString(await file.text(), "text/xml"));
  } else {
    geojson = JSON.parse(await file.text());
  }
  const ring = firstRing(geojson);
  if (!ring) throw new Error("no polygon");
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

/** "37.97, -100.87" → [lon, lat]; null if the text isn't coordinates. */
export function parseCoordinates(text: string): LngLat | null {
  const m = /^\s*(-?\d+(?:\.\d+)?)\s*[,;\s]\s*(-?\d+(?:\.\d+)?)\s*$/.exec(text);
  if (!m) return null;
  const lat = Number(m[1]);
  const lon = Number(m[2]);
  return Math.abs(lat) <= 90 && Math.abs(lon) <= 180 ? [lon, lat] : null;
}
