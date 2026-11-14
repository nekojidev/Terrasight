/** Field outline thumbnails: a simplified outline projected to a 0–100 SVG box (aspect ratio kept, centred). */

type Ring = number[][];

/** Outer rings of a (Multi)Polygon GeoJSON string, as produced by ST_AsGeoJSON. */
function outerRings(geojson: string): Ring[] {
  const g = JSON.parse(geojson) as { type: string; coordinates: unknown };
  if (g.type === "Polygon") return [(g.coordinates as Ring[])[0]!];
  if (g.type === "MultiPolygon") return (g.coordinates as Ring[][]).map((p) => p[0]!);
  return [];
}

/** SVG path data ("M x y L … Z") in a 0–100 box, or null for an empty/degenerate outline. */
export function thumbPath(geojson: string | null): string | null {
  if (!geojson) return null;
  const rings = outerRings(geojson).filter((r) => r && r.length >= 4);
  if (!rings.length) return null;
  const all = rings.flat();
  const lat0 = all.reduce((s, p) => s + p[1]!, 0) / all.length;
  const k = Math.cos((lat0 * Math.PI) / 180);
  const xs = all.map((p) => p[0]! * k);
  const ys = all.map((p) => p[1]!);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  const w = Math.max(...xs) - minX;
  const h = Math.max(...ys) - minY;
  const span = Math.max(w, h);
  if (!(span > 0)) return null;
  const s = 100 / span;
  const ox = (100 - w * s) / 2;
  const oy = (100 - h * s) / 2;
  const n = (v: number) => String(Math.round(v * 10) / 10);
  return rings
    .map((r) => {
      const pts = r.slice(0, -1).map((p) => `${n(ox + (p[0]! * k - minX) * s)} ${n(oy + (maxY(ys) - p[1]!) * s)}`);
      return `M${pts.join("L")}Z`;
    })
    .join("");
}

function maxY(ys: number[]): number {
  let m = -Infinity;
  for (const y of ys) if (y > m) m = y;
  return m;
}
