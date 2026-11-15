import { describe, expect, it } from "vitest";
import { cdlCrop, cdlName } from "./cdl-classes.js";
import { cropScapeSeason, parseCropScapeValue, samplePoints, yearList } from "./cdl.js";
import { slopes } from "./dem.js";
import { CRS, cellKey, geometryHash, pointInPolygons, project, projectPolygons } from "./geo.js";
import { mapLimit } from "./http.js";
import { adaptersFor } from "./index.js";
import { parsePower, power, powerCell } from "./power.js";
import { summariseSoil } from "./ssurgo.js";

const square = (cx: number, cy: number, h: number) => [
  [
    [
      [cx - h, cy - h],
      [cx + h, cy - h],
      [cx + h, cy + h],
      [cx - h, cy + h],
      [cx - h, cy - h],
    ],
  ],
];

describe("geometry", () => {
  it("finds points inside a polygon with a hole", () => {
    const withHole = [[square(0, 0, 10)[0]![0]!, square(0, 0, 3)[0]![0]!]];
    expect(pointInPolygons(5, 5, withHole)).toBe(true);
    expect(pointInPolygons(0, 0, withHole)).toBe(false);
    expect(pointInPolygons(20, 0, withHole)).toBe(false);
  });

  it("projects Garden City into CONUS Albers like PostGIS (EPSG:5070)", () => {
    const [x, y] = project(CRS.wgs84, CRS.albers, -100.87, 37.97);
    expect(Math.round(x)).toBeCloseTo(-423586, -1);
    expect(Math.round(y)).toBeCloseTo(1670318, -1);
  });

  it("hashes geometry stably and keys grid cells", () => {
    expect(geometryHash(square(1, 2, 0.01))).toBe(geometryHash(square(1, 2, 0.01)));
    expect(geometryHash(square(1, 2, 0.01))).not.toBe(geometryHash(square(1, 2, 0.02)));
    expect(cellKey(-100.87, 37.97, 0.1)).toBe("-100.9000,38.0000");
  });
});

describe("NASA POWER", () => {
  it("snaps to its grid so neighbouring fields share one request", () => {
    expect(powerCell(-100.87, 37.97)).toEqual(powerCell(-100.8, 38.1));
  });

  it("keys the cache by the same POWER cell, so neighbouring fields reuse one cached series", () => {
    const f = (lon: number, lat: number) => ({ centroid: { lon, lat } }) as Parameters<typeof power.cacheKey>[0];
    const ctx = { today: "2026-11-14" };
    expect(power.cacheKey(f(-100.87, 37.97), ctx)).toBe(power.cacheKey(f(-100.8, 38.1), ctx));
    expect(power.cacheKey(f(-100.87, 37.97), ctx)).not.toBe(power.cacheKey(f(-100.87, 38.6), ctx));
  });

  it("parses values, maps -999 to null and drops the unfilled recent tail", () => {
    const json = {
      geometry: { coordinates: [-100.625, 38, 858] as [number, number, number] },
      properties: {
        parameter: {
          T2M: { "20251101": 5.1, "20251102": -999, "20251103": -999 },
          PRECTOTCORR: { "20251101": 0, "20251102": 2.5, "20251103": -999 },
          T2M_MAX: { "20251101": 10, "20251102": 9, "20251103": -999 },
        },
      },
    };
    const w = parsePower(json, { lon: -100.625, lat: 38 });
    expect(w.dates).toEqual(["2025-11-01", "2025-11-02"]);
    expect(w.values.T2M).toEqual([5.1, null]);
    expect(w.values.PRECTOTCORR).toEqual([0, 2.5]);
    expect(w.elevationM).toBe(858);
  });

  it("reports an empty answer as an error with POWER's message", () => {
    expect(() => parsePower({ messages: ["bad range"] }, { lon: 0, lat: 0 })).toThrow(/bad range/);
  });
});

describe("SSURGO", () => {
  it("area-weights water storage (cm → mm) and picks dominant classes", () => {
    const areas = [
      ["mukey", "area"],
      ["1", "3"],
      ["2", "1"],
    ];
    const attrs = [
      ["mukey", "muname", "aws0150wta", "hydgrpdcd", "drclassdcd", "slopegraddcp"],
      ["1", "Ulysses silt loam", "20", "B", "Well drained", "1"],
      ["2", "Las clay loam", "16", "C", "Somewhat poorly drained", "1"],
    ];
    const s = summariseSoil(areas, attrs);
    expect(s.awsMm).toBe(190);
    expect(s.hydrologicGroup).toBe("B");
    expect(s.mapUnits[0]).toEqual({ mukey: "1", name: "Ulysses silt loam", share: 0.75 });
    expect(s.capability).toBeUndefined(); // no capability columns queried: nothing is invented
    expect(s.bedrockDepthCm).toBeNull();
  });

  it("area-weights the NRCS land capability class (non-irrigated and irrigated) and bedrock depth", () => {
    const areas = [
      ["mukey", "area"],
      ["1", "3"],
      ["2", "1"],
    ];
    const attrs = [
      ["mukey", "muname", "aws0150wta", "hydgrpdcd", "niccdcd", "iccdcd", "brockdepmin"],
      ["1", "Rock outcrop", "2", "D", "7", "", "15"],
      ["2", "Ulysses silt loam", "20", "B", "2", "1", ""],
    ];
    const s = summariseSoil(areas, attrs);
    expect(s.capability).toEqual({
      nonIrrigated: [
        { cls: 2, share: 0.25 },
        { cls: 7, share: 0.75 },
      ],
      irrigated: [{ cls: 1, share: 0.25 }],
    });
    expect(s.bedrockDepthCm).toBe(15);
  });
});

describe("CDL", () => {
  it("names missing seasons as ranges", () => {
    expect(yearList([2023])).toBe("2023");
    expect(yearList([2024, 2022, 2023])).toBe("2022–2024");
    expect(yearList([2022, 2024, 2025])).toBe("2022, 2024–2025");
  });

  it("retries CropScape points and keeps a season when most points answer", async () => {
    let calls = 0;
    const ok = (v: number) =>
      new Response(`<Result>{x: 0, y: 0, value: ${v}, category: "x"}</Result>`, { status: 200 });
    // Every point fails once (503), then answers; one point keeps failing.
    const seen = new Map<string, number>();
    const fetch = (async (url: string) => {
      calls++;
      const n = (seen.get(url) ?? 0) + 1;
      seen.set(url, n);
      if (url.includes("x=3.0") || n === 1) return new Response("busy", { status: 503 });
      return ok(24);
    }) as unknown as typeof globalThis.fetch;
    const ctx = { signal: new AbortController().signal, fetch, today: "2026-11-15" };
    const points: Array<[number, number]> = [
      [0, 0],
      [1, 0],
      [2, 0],
      [3, 0],
    ];
    const s = await cropScapeSeason(2023, points, ctx as never);
    expect(s?.majorityCode).toBe(24);
    expect(s?.n).toBe(3);
    expect(calls).toBe(3 * 2 + 3);
  }, 20_000);

  it("parses CropScape point values", () => {
    expect(parseCropScapeValue('<Result>{x: -1, y: 2, value: 24, category: "Winter Wheat"}</Result>')).toBe(
      24,
    );
    expect(parseCropScapeValue("<Error/>")).toBeNull();
  });

  it("maps classes to library crops, including double crops and regional canola", () => {
    expect(cdlCrop(1)).toBe("corn");
    expect(cdlCrop(24)).toBe("winter_wheat");
    expect(cdlCrop(26)).toEqual({ main: "winter_wheat", second: "soybean" });
    expect(cdlCrop(31, "us-southern-plains")).toBe("winter_canola");
    expect(cdlCrop(31, "us-northern-plains")).toBe("spring_canola");
    expect(cdlCrop(176)).toBeNull();
    expect(cdlName(176)).toBe("Grassland / pasture");
  });

  it("samples a grid inside the field and falls back to the centre", () => {
    const albers = projectPolygons(square(-100.98, 37.99, 0.004), CRS.albers);
    expect(samplePoints(albers)).toHaveLength(16);
    const tiny = [
      [
        [
          [0, 0],
          [1, 0],
          [1, 1],
          [0, 1],
          [0, 0],
        ],
      ],
    ];
    expect(samplePoints(tiny, 1)).toEqual([[0.5, 0.5]]);
  });
});

describe("DEM slope (Horn)", () => {
  it("is 0 on flat ground and ~10 % on a 10 % ramp", () => {
    const flat = Array.from({ length: 4 }, () => Array(4).fill(800));
    expect(slopes(flat, 1 / 3600, -1 / 3600, 0)[1]![1]).toBe(0);
    const step = (1 / 3600) * 111320; // ~30.9 m per cell at the equator
    const ramp = Array.from({ length: 4 }, () => Array.from({ length: 4 }, (_, c) => c * step * 0.1));
    expect(slopes(ramp, 1 / 3600, -1 / 3600, 0)[1]![1]).toBeCloseTo(10, 1);
  });
});

describe("registry", () => {
  const field = (country: string) => ({
    polygons: square(0, 0, 0.01),
    centroid: { lon: 0, lat: 0 },
    bbox: [-0.01, -0.01, 0.01, 0.01] as [number, number, number, number],
    country,
  });
  it("uses US-only sources only in the US", () => {
    expect(adaptersFor(field("US")).map((a) => a.id)).toEqual([
      "power",
      "cdl",
      "ssurgo",
      "modis",
      "dem",
      "sentinel2",
      "openet",
    ]);
    expect(adaptersFor(field("UA")).map((a) => a.id)).toEqual([
      "power",
      "soilgrids",
      "modis",
      "dem",
      "sentinel2",
      "cropland",
      "wapor",
    ]);
  });
});

describe("mapLimit", () => {
  it("keeps order and never exceeds the limit", async () => {
    let active = 0,
      peak = 0;
    const out = await mapLimit([1, 2, 3, 4, 5, 6], 2, async (n) => {
      active++;
      peak = Math.max(peak, active);
      await new Promise((r) => setTimeout(r, 5));
      active--;
      return n * 2;
    });
    expect(out).toEqual([2, 4, 6, 8, 10, 12]);
    expect(peak).toBe(2);
  });
});
