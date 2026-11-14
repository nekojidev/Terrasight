import { createHash } from "node:crypto";
import proj4 from "proj4";

export const CRS = {
  wgs84: "EPSG:4326",
  /** USDA CDL: CONUS Albers Equal Area (EPSG:5070). */
  albers:
    "+proj=aea +lat_0=23 +lon_0=-96 +lat_1=29.5 +lat_2=45.5 +x_0=0 +y_0=0 +datum=NAD83 +units=m +no_defs",
  /** MODIS sinusoidal grid. */
  sinusoidal: "+proj=sinu +lon_0=0 +x_0=0 +y_0=0 +R=6371007.181 +units=m +no_defs",
} as const;

export function project(from: string, to: string, lon: number, lat: number): [number, number] {
  const [x, y] = proj4(from, to, [lon, lat]);
  return [x!, y!];
}

export function projectPolygons(polygons: number[][][][], to: string): number[][][][] {
  return polygons.map((poly) =>
    poly.map((ring) => ring.map(([lon, lat]) => project(CRS.wgs84, to, lon!, lat!))),
  );
}

/** Even-odd ray casting over every ring (outer rings and holes) of a MultiPolygon. */
export function pointInPolygons(x: number, y: number, polygons: number[][][][]): boolean {
  let inside = false;
  for (const poly of polygons) {
    for (const ring of poly) {
      for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const [xi, yi] = ring[i]!;
        const [xj, yj] = ring[j]!;
        if (yi! > y !== yj! > y && x < ((xj! - xi!) * (y - yi!)) / (yj! - yi!) + xi!) inside = !inside;
      }
    }
  }
  return inside;
}

export function bboxOf(polygons: number[][][][]): [number, number, number, number] {
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  for (const poly of polygons)
    for (const ring of poly)
      for (const [x, y] of ring) {
        minX = Math.min(minX, x!);
        minY = Math.min(minY, y!);
        maxX = Math.max(maxX, x!);
        maxY = Math.max(maxY, y!);
      }
  return [minX, minY, maxX, maxY];
}

/** Stable hash of the geometry (rounded to ~1 cm) for cache keys. */
export function geometryHash(polygons: number[][][][]): string {
  const rounded = polygons.map((p) => p.map((r) => r.map(([x, y]) => [x!.toFixed(7), y!.toFixed(7)])));
  return createHash("sha256").update(JSON.stringify(rounded)).digest("hex").slice(0, 16);
}

/** Grid cell key for sharing weather between fields (Tech Design §8.3). */
export function cellKey(lon: number, lat: number, step: number): string {
  const snap = (v: number) => (Math.round(v / step) * step).toFixed(4);
  return `${snap(lon)},${snap(lat)}`;
}
