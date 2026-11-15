import { describe, expect, it } from "vitest";
import { adaptersFor } from "./index.js";
import { cropShare, utmProj } from "./landcover.js";
import { summariseSoilGrids } from "./others.js";
import { soilSummaryFromGrids } from "./texture.js";
import { monthRange, toEtSeries, utmFor, waporTile, waporUrl } from "./wapor.js";
import type { FieldGeometry } from "./types.js";

const field = (country: string | null): FieldGeometry => ({
  polygons: [
    [
      [
        [34.5, 49.5],
        [34.6, 49.5],
        [34.6, 49.6],
        [34.5, 49.6],
        [34.5, 49.5],
      ],
    ],
  ],
  centroid: { lon: 34.55, lat: 49.55 },
  bbox: [34.5, 49.5, 34.6, 49.6],
  country,
});

describe("Ukraine source selection", () => {
  it("adds cropland, WaPOR and SoilGrids for UA, and not the US-only sources", () => {
    const ids = adaptersFor(field("UA")).map((a) => a.id);
    expect(ids).toEqual(expect.arrayContaining(["power", "soilgrids", "modis", "cropland", "wapor"]));
    expect(ids).not.toContain("cdl");
    expect(ids).not.toContain("ssurgo");
    expect(ids).not.toContain("openet");
  });

  it("keeps the US on CDL, SSURGO and OpenET, without WaPOR", () => {
    const ids = adaptersFor(field("US")).map((a) => a.id);
    expect(ids).toEqual(expect.arrayContaining(["cdl", "ssurgo", "openet"]));
    expect(ids).not.toContain("wapor");
    expect(ids).not.toContain("soilgrids");
  });

  it("does not run WaPOR outside Ukraine yet (EU gets cropland and SoilGrids only)", () => {
    const ids = adaptersFor(field("DE")).map((a) => a.id);
    expect(ids).toContain("cropland");
    expect(ids).not.toContain("wapor");
  });
});

describe("WaPOR v3", () => {
  it("names the UTM tile like the catalogue (Poltava is 36U, Odesa 36T)", () => {
    expect(waporTile(34.55, 49.6)).toBe("36U");
    expect(waporTile(30.7, 46.6)).toBe("36T");
    expect(waporTile(24.0, 49.8)).toBe("35U");
  });

  it("builds the public COG url", () => {
    expect(waporUrl("36U", "2022-07")).toBe(
      "https://storage.googleapis.com/fao-gismgr-wapor-3-data/DATA/WAPOR-3/MOSAICSET/L1-UTM-AETI-M/WAPOR-3.L1-UTM-AETI-M.36U.2022-07.tif",
    );
    expect(utmFor("36U")).toContain("+zone=36");
    expect(utmFor("36U")).not.toContain("+south");
  });

  it("lists complete months from 2018 and never the current one", () => {
    const m = monthRange("2026-11-15");
    expect(m[0]).toBe("2018-01");
    expect(m.at(-1)).toBe("2026-10");
    expect(m).toHaveLength(8 * 12 + 10);
  });

  it("sums only complete calendar years into the annual series and tags the basis", () => {
    const months = [
      ...Array.from({ length: 12 }, (_, i) => ({
        month: `2023-${String(i + 1).padStart(2, "0")}`,
        etMm: 30,
      })),
      ...Array.from({ length: 5 }, (_, i) => ({ month: `2024-${String(i + 1).padStart(2, "0")}`, etMm: 50 })),
    ];
    const s = toEtSeries(months);
    expect(s.annual).toEqual([{ year: 2023, etMm: 360 }]);
    expect(s.basis).toBe("wapor");
  });
});

describe("land cover", () => {
  it("derives the UTM projection from the tile id", () => {
    expect(utmProj("36U-2021")).toContain("+zone=36");
    expect(utmProj("36U-2021")).not.toContain("+south");
    expect(utmProj("21H-2020")).toContain("+south");
    expect(utmProj("garbage")).toBeNull();
  });

  it("counts the Crops class (5) among valid pixels, ignoring no-data and clouds", () => {
    expect(cropShare([5, 5, 5, 7, 0, 10])).toEqual({ cropShare: 0.75, n: 4 });
    expect(cropShare([0, 0, 10])).toBeNull();
  });
});

describe("SoilGrids", () => {
  const layer = (name: string, means: number[], d_factor: number) => ({
    name,
    unit_measure: { d_factor },
    depths: ["0-5cm", "5-15cm", "15-30cm", "30-60cm", "60-100cm"].map((label, i) => ({
      label,
      values: { mean: means[i] ?? null },
    })),
  });
  const json = {
    properties: {
      layers: [
        layer("clay", [250, 250, 250, 350, 350], 10),
        layer("sand", [300, 300, 300, 300, 300], 10),
        layer("silt", [450, 450, 450, 350, 350], 10),
        layer("soc", [200, 150, 100, 50, 30], 10),
        layer("phh2o", [65, 66, 68, 70, 72], 10),
      ],
    },
  };

  it("weights depths by thickness: texture over 0–100 cm, carbon and pH over the topsoil", () => {
    const s = summariseSoilGrids(json);
    expect(s.clayPct).toBe(32); // (25×5 + 25×10 + 25×15 + 35×30 + 35×40) / 100
    expect(s.sandPct).toBe(30);
    expect(s.siltPct).toBe(38); // (45×30 + 35×70) / 100
    expect(s.ocGPerKg).toBe(13.3); // (20×5 + 15×10 + 10×15) / 30
    expect(s.ph).toBe(6.7); // (6.5×5 + 6.6×10 + 6.8×15) / 30
  });

  it("gives an SSURGO-shaped soil flagged as an estimate", () => {
    const soil = soilSummaryFromGrids(summariseSoilGrids(json))!;
    expect(soil.basis).toBe("soilgrids");
    expect(soil.aws100Mm).toBe(160); // clay loam
    expect(soil.awsMm).toBe(240);
    expect(soil.hydrologicGroup).toBe("C");
    expect(soil.organicCarbonGPerKg).toBe(13.3);
    expect(soilSummaryFromGrids({ clayPct: null, sandPct: null, siltPct: null })).toBeNull();
  });
});
