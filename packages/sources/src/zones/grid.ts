import proj4 from "proj4";
import { bboxOf, pointInPolygons, projectPolygons } from "../geo.js";

/** A north-up raster grid in a UTM zone; cell (row, col) is `res` metres wide, row 0 is the northern edge. */
export interface Grid {
  epsg: number;
  res: number;
  /** Western edge (x) and northern edge (y) of cell (0, 0), in metres. Multiples of `res`. */
  x0: number;
  y0: number;
  width: number;
  height: number;
}

export function utmEpsg(lon: number, lat: number): number {
  const zone = Math.min(60, Math.max(1, Math.floor((lon + 180) / 6) + 1));
  return (lat >= 0 ? 32600 : 32700) + zone;
}

/** proj4 definition of a WGS84 UTM EPSG code (326zz north, 327zz south). */
export function utmDef(epsg: number): string {
  const zone = epsg % 100;
  return `+proj=utm +zone=${zone} ${epsg >= 32700 ? "+south " : ""}+datum=WGS84 +units=m +no_defs`;
}

export const MAX_CELLS = 250_000;

export interface FieldGrid {
  grid: Grid;
  /** 1 where the cell centre lies inside the field. */
  inside: Uint8Array;
  /** Field polygons in the grid's CRS. */
  polygonsUtm: number[][][][];
  insideCount: number;
}

/** Grid over the field in its UTM zone, 10 m cells (coarser, 20/40 m, only for very large fields). */
export function makeFieldGrid(polygons: number[][][][], centroid: { lon: number; lat: number }): FieldGrid {
  const epsg = utmEpsg(centroid.lon, centroid.lat);
  const polygonsUtm = projectPolygons(polygons, utmDef(epsg));
  const [minX, minY, maxX, maxY] = bboxOf(polygonsUtm);
  let res = 10;
  for (;;) {
    const x0 = Math.floor(minX / res) * res;
    const y0 = Math.ceil(maxY / res) * res;
    const width = Math.max(1, Math.ceil((maxX - x0) / res));
    const height = Math.max(1, Math.ceil((y0 - minY) / res));
    if (width * height > MAX_CELLS && res < 40) {
      res *= 2;
      continue;
    }
    const grid: Grid = { epsg, res, x0, y0, width, height };
    const inside = new Uint8Array(width * height);
    let insideCount = 0;
    for (let r = 0; r < height; r++)
      for (let c = 0; c < width; c++) {
        if (pointInPolygons(x0 + (c + 0.5) * res, y0 - (r + 0.5) * res, polygonsUtm)) {
          inside[r * width + c] = 1;
          insideCount += 1;
        }
      }
    return { grid, inside, polygonsUtm, insideCount };
  }
}

/** Lattice corner (col, row; may be fractional) to UTM metres. */
export function cornerXY(grid: Grid, col: number, row: number): [number, number] {
  return [grid.x0 + col * grid.res, grid.y0 - row * grid.res];
}

/** UTM metres of the grid's CRS to [lon, lat]. */
export function toLonLat(epsg: number, x: number, y: number): [number, number] {
  const [lon, lat] = proj4(utmDef(epsg), "EPSG:4326", [x, y]);
  return [lon!, lat!];
}

/** Corners [NW, NE, SE, SW] of the grid as [lon, lat], for placing an image on a web map. */
export function gridCorners(grid: Grid): [number, number][] {
  const pts: [number, number][] = [
    [0, 0],
    [grid.width, 0],
    [grid.width, grid.height],
    [0, grid.height],
  ];
  return pts.map(([c, r]) => {
    const [x, y] = cornerXY(grid, c, r);
    return toLonLat(grid.epsg, x, y);
  });
}
