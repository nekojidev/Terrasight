import { fromUrl, type GeoTIFFImage } from "geotiff";
import { bboxOf, pointInPolygons } from "./geo.js";

export interface MaskedPixels {
  values: number[];
  /** Pixels whose centre lies inside the field. */
  inside: number;
  width: number;
  height: number;
  /** Pixel size in raster units. */
  resolution: [number, number];
}

/**
 * Reads the window of a (Cloud Optimized) GeoTIFF that covers `polygons` (already in the raster's CRS)
 * and returns the values of pixels whose centres fall inside. Only the needed byte ranges are fetched.
 */
export async function readMasked(
  url: string,
  polygons: number[][][][],
  opts: { band?: number; nodata?: number; signal?: AbortSignal; image?: GeoTIFFImage } = {},
): Promise<MaskedPixels> {
  const image = opts.image ?? (await (await fromUrl(url, { allowFullFile: false }, opts.signal)).getImage());
  const [ox, oy] = image.getOrigin() as [number, number];
  const [rx, ry] = image.getResolution() as [number, number]; // ry is negative for north-up rasters
  const [minX, minY, maxX, maxY] = bboxOf(polygons);
  const col0 = Math.max(0, Math.floor((minX - ox) / rx));
  const col1 = Math.min(image.getWidth(), Math.ceil((maxX - ox) / rx) + 1);
  const row0 = Math.max(0, Math.floor((maxY - oy) / ry));
  const row1 = Math.min(image.getHeight(), Math.ceil((minY - oy) / ry) + 1);
  if (col1 <= col0 || row1 <= row0)
    return { values: [], inside: 0, width: 0, height: 0, resolution: [rx, ry] };

  const rasters = await image.readRasters({
    window: [col0, row0, col1, row1],
    samples: [opts.band ?? 0],
    signal: opts.signal,
  });
  const data = rasters[0] as ArrayLike<number>;
  const width = col1 - col0;
  const height = row1 - row0;
  const values: number[] = [];
  let inside = 0;
  for (let r = 0; r < height; r++) {
    const y = oy + (row0 + r + 0.5) * ry;
    for (let c = 0; c < width; c++) {
      const x = ox + (col0 + c + 0.5) * rx;
      if (!pointInPolygons(x, y, polygons)) continue;
      inside += 1;
      const v = data[r * width + c]!;
      if (opts.nodata === undefined || v !== opts.nodata) values.push(v);
    }
  }
  return { values, inside, width, height, resolution: [rx, ry] };
}

/** Reads the full window (not masked) as a 2-D grid, e.g. for slope from a DEM. */
export async function readWindowGrid(
  url: string,
  bbox: [number, number, number, number],
  opts: { signal?: AbortSignal; padPixels?: number } = {},
): Promise<{ grid: number[][]; originX: number; originY: number; resX: number; resY: number }> {
  const image = await (await fromUrl(url, { allowFullFile: false }, opts.signal)).getImage();
  const [ox, oy] = image.getOrigin() as [number, number];
  const [rx, ry] = image.getResolution() as [number, number];
  const pad = opts.padPixels ?? 1;
  const col0 = Math.max(0, Math.floor((bbox[0] - ox) / rx) - pad);
  const col1 = Math.min(image.getWidth(), Math.ceil((bbox[2] - ox) / rx) + pad);
  const row0 = Math.max(0, Math.floor((bbox[3] - oy) / ry) - pad);
  const row1 = Math.min(image.getHeight(), Math.ceil((bbox[1] - oy) / ry) + pad);
  const data = (
    await image.readRasters({ window: [col0, row0, col1, row1], samples: [0], signal: opts.signal })
  )[0] as ArrayLike<number>;
  const width = col1 - col0;
  const grid: number[][] = [];
  for (let r = 0; r < row1 - row0; r++)
    grid.push(Array.from({ length: width }, (_, c) => data[r * width + c]!));
  return { grid, originX: ox + col0 * rx, originY: oy + row0 * ry, resX: rx, resY: ry };
}
