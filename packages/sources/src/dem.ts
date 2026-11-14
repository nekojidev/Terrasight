import { geometryHash, pointInPolygons } from "./geo.js";
import { signHref, stacSearch } from "./planetary.js";
import { readWindowGrid } from "./raster.js";
import {
  SourceError,
  type FieldGeometry,
  type FetchContext,
  type SourceAdapter,
  type SourceResult,
} from "./types.js";

/** Slope and elevation of the field from Copernicus DEM GLO-30 (RFC §16: mean slope stored with the field). */
export interface Terrain {
  meanSlopePct: number;
  maxSlopePct: number;
  meanElevationM: number;
  cells: number;
}

const EARTH_M_PER_DEG = 111_320;

/** Horn's method on a grid in degrees; returns slope % per interior cell. */
export function slopes(grid: number[][], resXDeg: number, resYDeg: number, latDeg: number): number[][] {
  const dx = Math.abs(resXDeg) * EARTH_M_PER_DEG * Math.cos((latDeg * Math.PI) / 180);
  const dy = Math.abs(resYDeg) * EARTH_M_PER_DEG;
  const out: number[][] = grid.map((row) => row.map(() => NaN));
  for (let r = 1; r < grid.length - 1; r++) {
    for (let c = 1; c < grid[r]!.length - 1; c++) {
      const z = (rr: number, cc: number) => grid[rr]![cc]!;
      const dzdx =
        (z(r - 1, c + 1) +
          2 * z(r, c + 1) +
          z(r + 1, c + 1) -
          (z(r - 1, c - 1) + 2 * z(r, c - 1) + z(r + 1, c - 1))) /
        (8 * dx);
      const dzdy =
        (z(r + 1, c - 1) +
          2 * z(r + 1, c) +
          z(r + 1, c + 1) -
          (z(r - 1, c - 1) + 2 * z(r - 1, c) + z(r - 1, c + 1))) /
        (8 * dy);
      out[r]![c] = Math.sqrt(dzdx * dzdx + dzdy * dzdy) * 100;
    }
  }
  return out;
}

export const dem: SourceAdapter<Terrain> = {
  id: "dem",
  appliesTo: () => true,
  cacheKey: (field) => geometryHash(field.polygons),
  async fetch(field: FieldGeometry, ctx: FetchContext): Promise<SourceResult<Terrain>> {
    const items = await stacSearch(
      {
        collections: ["cop-dem-glo-30"],
        intersects: { type: "Point", coordinates: [field.centroid.lon, field.centroid.lat] },
      },
      ctx,
      5,
    );
    const href = items[0]?.assets.data?.href;
    if (!href) throw new SourceError("returned no elevation tile for this location", false);
    const { grid, originX, originY, resX, resY } = await readWindowGrid(
      await signHref(href, ctx),
      field.bbox,
      { signal: ctx.signal, padPixels: 2 },
    );
    const s = slopes(grid, resX, resY, field.centroid.lat);
    let sum = 0,
      max = 0,
      elev = 0,
      n = 0;
    for (let r = 0; r < grid.length; r++)
      for (let c = 0; c < grid[r]!.length; c++) {
        const x = originX + (c + 0.5) * resX;
        const y = originY + (r + 0.5) * resY;
        const v = s[r]![c]!;
        if (Number.isNaN(v) || !pointInPolygons(x, y, field.polygons)) continue;
        sum += v;
        max = Math.max(max, v);
        elev += grid[r]![c]!;
        n += 1;
      }
    if (!n) throw new SourceError("covers too few elevation cells for this field", false);
    const round = (v: number) => Math.round(v * 10) / 10;
    return {
      status: "done",
      payload: {
        meanSlopePct: round(sum / n),
        maxSlopePct: round(max),
        meanElevationM: Math.round(elev / n),
        cells: n,
      },
      dataDate: null,
      attribution: "Copernicus DEM GLO-30 (© DLR, Airbus) via Microsoft Planetary Computer",
    };
  },
};
