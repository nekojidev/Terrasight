import { describe, expect, it } from "vitest";
import {
  buildZoneRaster,
  classifyPixels,
  fillNearest,
  majorityFilter,
  mergeSmall,
  NotEnoughSeasons,
  percentileRanks,
  ZONE_STRONG,
  ZONE_VARIABLE,
  ZONE_WEAK,
} from "./classify.js";
import { zonePolygons } from "./geometry.js";
import { makeFieldGrid } from "./grid.js";
import { encodePng, ndviColour, ndviImage } from "./png.js";
import { polygonCells, polygonize } from "./polygonize.js";
import { ndviFromBands, peakOf, seasonWindow, toScenes } from "./s2.js";

const W = 12;
const H = 8;
const ALL = new Uint8Array(W * H).fill(1);

/** Synthetic field: left third always good, right third always poor, middle flips between years. */
function seasonRaster(year: number): Float32Array {
  const v = new Float32Array(W * H);
  for (let r = 0; r < H; r++)
    for (let c = 0; c < W; c++) {
      const noise = ((r * 7 + c * 13 + year) % 5) * 0.001;
      let base: number;
      if (c < 4) base = 0.8;
      else if (c >= 8) base = 0.3;
      else base = year % 2 === 0 ? 0.85 : 0.25; // swaps position: sometimes best, sometimes worst
      v[r * W + c] = base + noise;
    }
  return v;
}
const SEASONS = [2019, 2020, 2021, 2022, 2023, 2024, 2025].map((s) => ({ season: s, values: seasonRaster(s) }));

describe("percentileRanks", () => {
  it("ranks inside cells in (0, 1), ties share a rank, outside and NaN stay NaN", () => {
    const r = percentileRanks([5, 1, 3, 3, NaN, 9], new Uint8Array([1, 1, 1, 1, 1, 0]));
    expect(r[1]).toBeCloseTo(0.125); // lowest of 4 valid
    expect(r[2]).toBeCloseTo(0.5); // tie of ranks 2 and 3 -> 2.5 / 4... mean rank 2.5
    expect(r[3]).toBeCloseTo(0.5);
    expect(r[0]).toBeCloseTo(0.875);
    expect(Number.isNaN(r[4]!)).toBe(true);
    expect(Number.isNaN(r[5]!)).toBe(true);
  });
});

describe("classification of a synthetic raster", () => {
  it("finds always-strong, always-weak and year-dependent zones", () => {
    const out = buildZoneRaster({ seasons: SEASONS, inside: ALL, width: W, height: H });
    const at = (r: number, c: number) => out.cls[r * W + c];
    for (let r = 0; r < H; r++) {
      expect(at(r, 1)).toBe(ZONE_STRONG);
      expect(at(r, 10)).toBe(ZONE_WEAK);
      expect(at(r, 6)).toBe(ZONE_VARIABLE);
    }
    expect(out.stats.strong.cells + out.stats.variable.cells + out.stats.weak.cells).toBe(W * H);
    expect(out.seasons.every((s) => s.used)).toBe(true);
  });

  it("refuses to build from fewer than 5 usable seasons", () => {
    expect(() =>
      buildZoneRaster({ seasons: SEASONS.slice(0, 4), inside: ALL, width: W, height: H }),
    ).toThrow(NotEnoughSeasons);
    // a season that is mostly cloud does not count
    const cloudy = new Float32Array(W * H).fill(NaN);
    cloudy[0] = 0.5;
    expect(() =>
      buildZoneRaster({
        seasons: [...SEASONS.slice(0, 4), { season: 2030, values: cloudy }],
        inside: ALL,
        width: W,
        height: H,
      }),
    ).toThrow(/4 seasons/);
  });

  it("classifies pixels from mean and variability of their ranks", () => {
    const ranks = [0.9, 0.8, 0.85, 0.9, 0.95].map((v) => new Float32Array([v, 1 - v, 0.5]));
    const px = classifyPixels(ranks, new Uint8Array([1, 1, 1]));
    expect(Array.from(px.cls)).toEqual([ZONE_STRONG, ZONE_WEAK, ZONE_VARIABLE]);
  });

  it("majority filter removes a speck, fill takes the nearest class, small fragments merge", () => {
    const w = 5;
    const h = 5;
    const cls = new Uint8Array(w * h).fill(1);
    cls[12] = 3; // speck in the middle
    const inside = new Uint8Array(w * h).fill(1);
    expect(majorityFilter(cls, inside, w, h, 1)[12]).toBe(1);
    const holes = new Uint8Array(w * h).fill(0);
    holes[0] = 2;
    holes[24] = 3;
    const filled = fillNearest(holes, w, h);
    expect(filled.every((v) => v === 2 || v === 3)).toBe(true);
    expect(filled[1]).toBe(2);
    expect(filled[23]).toBe(3);
    expect(mergeSmall(cls, w, h, 3)[12]).toBe(1);
  });
});

describe("polygonize", () => {
  it("polygon areas add up to the number of cells of the class (holes, diagonal pinch, several parts)", () => {
    const w = 10;
    const h = 8;
    const cls = new Uint8Array(w * h).fill(1);
    // a 3x3 hole of class 2 with a cell of class 1 inside it, a diagonal pinch of class 2, an isolated cell
    for (let r = 1; r <= 3; r++) for (let c = 1; c <= 3; c++) cls[r * w + c] = 2;
    cls[2 * w + 2] = 1;
    cls[5 * w + 5] = 2;
    cls[6 * w + 6] = 2;
    cls[0 * w + 9] = 2;
    for (const code of [1, 2]) {
      const cells = cls.reduce((s, v) => s + (v === code ? 1 : 0), 0);
      const polys = polygonize(cls, w, h, code);
      expect(polys.reduce((s, p) => s + polygonCells(p), 0)).toBeCloseTo(cells, 9);
    }
    // class 2: ring with the island cell as a hole, two pinched cells (right-most turn: 2 rings), one corner cell
    expect(polygonize(cls, w, h, 2)).toHaveLength(4);
    const ring = polygonize(cls, w, h, 2).find((p) => p.holes.length)!;
    expect(ring.holes).toHaveLength(1);
    expect(polygonCells(ring)).toBe(8);
  });

  it("zone areas in metres add up to the field area and the grid covers the field", () => {
    const lon = -100.88;
    const lat = 37.97;
    const dLat = 0.0045;
    const dLon = dLat / Math.cos((lat * Math.PI) / 180);
    const ring = [
      [lon - dLon, lat - dLat],
      [lon + dLon, lat - dLat],
      [lon + dLon, lat + dLat],
      [lon - dLon, lat + dLat],
      [lon - dLon, lat - dLat],
    ];
    const fg = makeFieldGrid([[ring]], { lon, lat });
    const { width, height } = fg.grid;
    // classify by column thirds so every class has a boundary
    const cls = new Uint8Array(width * height);
    for (let r = 0; r < height; r++)
      for (let c = 0; c < width; c++) cls[r * width + c] = c < width / 3 ? 1 : c < (2 * width) / 3 ? 2 : 3;
    const zones = zonePolygons(cls, fg.grid);
    expect(Object.keys(zones).sort()).toEqual(["strong", "variable", "weak"]);
    const planar = (rings: number[][][]) => {
      // lon/lat shoelace scaled by local metres per degree
      const kx = 111_320 * Math.cos((lat * Math.PI) / 180);
      const ky = 110_574;
      let a = 0;
      rings.forEach((rg, i) => {
        let s = 0;
        for (let k = 0; k < rg.length - 1; k++)
          s += rg[k]![0]! * kx * (rg[k + 1]![1]! * ky) - rg[k + 1]![0]! * kx * (rg[k]![1]! * ky);
        a += (i === 0 ? 1 : -1) * Math.abs(s / 2);
      });
      return a;
    };
    const total = Object.values(zones)
      .flatMap((mp) => mp)
      .reduce((s, p) => s + planar(p), 0);
    const gridArea = width * height * fg.grid.res ** 2;
    expect(total / gridArea).toBeCloseTo(1, 2);
    expect(gridArea).toBeGreaterThanOrEqual(fg.insideCount * fg.grid.res ** 2);
    expect(fg.insideCount * fg.grid.res ** 2).toBeGreaterThan(0.9 * 1e4 * 2 * dLat * 110_574 * 2 * dLon * 111_320 * Math.cos((lat * Math.PI) / 180) * 1e-4);
  });
});

describe("Sentinel-2 helpers", () => {
  it("masks by SCL and removes the processing-baseline offset", () => {
    // SCL: 4 vegetation, 9 cloud, 5 bare; DN with +1000 offset (baseline 5)
    const ndvi = ndviFromBands([1000 + 500, 1000 + 500, 1000 + 2000], [1000 + 4500, 1000 + 4500, 1000 + 2000], [4, 9, 5], 5);
    expect(ndvi[0]).toBeCloseTo((0.45 - 0.05) / (0.45 + 0.05));
    expect(Number.isNaN(ndvi[1]!)).toBe(true);
    expect(ndvi[2]).toBeCloseTo(0);
    // older baseline: no offset
    expect(ndviFromBands([500], [4500], [4], 3)[0]).toBeCloseTo(0.8);
  });

  it("takes the 90th percentile per pixel and needs 3 clear observations", () => {
    const obs = [0.2, 0.4, 0.6, 0.8, 1.0].map((v) => new Float32Array([v, NaN]));
    obs[0]![1] = 0.3;
    obs[1]![1] = 0.4;
    const peak = peakOf(obs, 2);
    expect(peak[0]).toBeCloseTo(1.0);
    expect(Number.isNaN(peak[1]!)).toBe(true);
  });

  it("keeps one scene per acquisition and the right growing-season window", () => {
    const item = (id: string, cloud: number) => ({
      id,
      properties: {
        datetime: "2023-07-14T17:29:01Z",
        "proj:epsg": 32614,
        "s2:mgrs_tile": "14SLH",
        "s2:processing_baseline": "05.10",
        "eo:cloud_cover": cloud,
      },
      assets: { B04: { href: "b4" }, B08: { href: "b8" }, SCL: { href: "scl" } },
    });
    const scenes = toScenes([item("a", 20), item("b", 21)]);
    expect(scenes).toHaveLength(1);
    expect(scenes[0]!.baselineMajor).toBe(5);
    expect(seasonWindow(2022, 50)).toEqual(["2022-04-15", "2022-09-30"]);
    expect(seasonWindow(2022, -34)).toEqual(["2022-11-01", "2023-03-31"]);
  });
});

describe("png", () => {
  it("writes a valid PNG signature, IHDR size and a transparent outside", () => {
    const img = ndviImage([0.2, 0.9, NaN, 0.5], new Uint8Array([1, 1, 1, 0]), 2, 2);
    expect(img[3]).toBeGreaterThan(0);
    expect(img[11]).toBe(0); // NaN
    expect(img[15]).toBe(0); // outside
    const png = encodePng(2, 2, img);
    expect(png.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
    expect(png.readUInt32BE(16)).toBe(2);
    expect(png.readUInt32BE(20)).toBe(2);
    expect(ndviColour(-1)).toEqual(ndviColour(0));
  });
});
