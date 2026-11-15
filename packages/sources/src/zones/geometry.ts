import { toLonLat, type Grid } from "./grid.js";
import { ZONE_NAMES, type ZoneName } from "./classify.js";
import { polygonize, type Pt } from "./polygonize.js";

/**
 * MultiPolygon (GeoJSON coordinates, [lon, lat]) of each zone present in the classified grid.
 * The polygons tile the whole grid rectangle; the API clips them to the field outline afterwards, so zone areas add
 * up to the field area.
 */
export function zonePolygons(cls: Uint8Array, grid: Grid): Partial<Record<ZoneName, number[][][][]>> {
  const out: Partial<Record<ZoneName, number[][][][]>> = {};
  const toLL = (p: Pt): [number, number] =>
    toLonLat(grid.epsg, grid.x0 + p[0] * grid.res, grid.y0 - (grid.height - p[1]) * grid.res);
  for (const code of [1, 2, 3] as const) {
    const polys = polygonize(cls, grid.width, grid.height, code);
    if (!polys.length) continue;
    out[ZONE_NAMES[code]] = polys.map((p) => [p.outer.map(toLL), ...p.holes.map((hole) => hole.map(toLL))]);
  }
  return out;
}
