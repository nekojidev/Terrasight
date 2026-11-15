import { fileURLToPath } from "node:url";
import { loadLibrary } from "@terrasight/library";
import { describe, expect, it } from "vitest";
import {
  applyCroplandMask,
  bareMonths,
  classifySeason,
  cropForGroup,
  cropsFromCdl,
  detectIrrigation,
  matchBaseline,
  percentile,
  seasonStats,
  stressYears,
  type SeasonCrop,
} from "./compute.js";

const lib = loadLibrary(fileURLToPath(new URL("../../../../data/", import.meta.url)));

/** 16-day NDVI curve for one year with a peak in `peakMonth`. */
function curve(year: number, peakMonth: number, peak = 0.8, base = 0.15) {
  return Array.from({ length: 23 }, (_, i) => {
    const doy = i * 16 + 1;
    const date = new Date(Date.UTC(year, 0, doy)).toISOString().slice(0, 10);
    const m = doy / 30.4;
    const ndvi = base + (peak - base) * Math.exp(-((m - peakMonth + 0.5) ** 2) / 1.2);
    return { date, ndvi: Math.round(ndvi * 1000) / 1000, coverage: 1, platform: "terra" as const };
  });
}

describe("crops from CDL", () => {
  it("maps majority classes, keeps confidence and double crops", () => {
    const crops = cropsFromCdl(
      {
        seasons: [
          { year: 2024, classes: [], majorityCode: 1, majorityShare: 0.91, method: "pixels", n: 400 },
          { year: 2025, classes: [], majorityCode: 26, majorityShare: 0.62, method: "samples", n: 16 },
          { year: 2023, classes: [], majorityCode: 176, majorityShare: 0.8, method: "pixels", n: 400 },
        ],
      },
      "us-southern-plains",
    );
    expect(crops[0]).toEqual({
      season: 2024,
      mainCrop: "corn",
      secondCrop: null,
      confidence: 0.91,
      source: "cdl",
    });
    expect(crops[1]).toMatchObject({ mainCrop: "winter_wheat", secondCrop: "soybean" });
    expect(crops[2]!.mainCrop).toBe("other:176");
  });
});

describe("tier C classifier (RFC §6.1)", () => {
  it("recognises winter cereal, summer row crop and fallow from the curve shape", () => {
    expect(classifySeason(curve(2024, 5))).toBe("winter");
    expect(classifySeason(curve(2024, 8))).toBe("summer");
    expect(classifySeason(curve(2024, 8, 0.3))).toBe("fallow");
  });
  it("uses the regional baseline to name the crop", () => {
    expect(cropForGroup("summer", ["winter_wheat", "sunflower"])).toBe("sunflower");
    expect(cropForGroup("summer", [])).toBe("corn");
    expect(cropForGroup("winter", ["winter_barley"])).toBe("winter_barley");
  });
});

describe("bare months and stress years", () => {
  it("lists months below the bare-soil threshold", () => {
    const months = bareMonths({ points: curve(2024, 8), pixelSizeM: 250 }, 2024);
    expect(months).toContain("2024-01");
    expect(months).not.toContain("2024-08");
  });

  it("flags dry, hot and low-NDVI seasons against the field's own distribution", () => {
    const stats = Array.from({ length: 10 }, (_, i) => ({
      season: 2010 + i,
      precipMm: 450 + i * 5,
      heatDays: 10 + i,
      ndviPeak: 0.8,
    }));
    stats[2] = { season: 2012, precipMm: 250, heatDays: 45, ndviPeak: 0.4 };
    const stress = stressYears(stats);
    expect(stress.find((s) => s.season === 2012)?.reasons.sort()).toEqual(["dry", "hot", "low_ndvi"]);
  });

  it("computes percentiles by interpolation", () => {
    expect(percentile([1, 2, 3, 4, 5], 0.5)).toBe(3);
    expect(percentile([10, 20], 0.1)).toBe(11);
  });

  it("sums precipitation and heat days per calendar season from daily weather", () => {
    const dates = Array.from({ length: 365 }, (_, i) =>
      new Date(Date.UTC(2023, 0, 1 + i)).toISOString().slice(0, 10),
    );
    const weather = {
      dates,
      cell: { lon: 0, lat: 0 },
      elevationM: null,
      values: { PRECTOTCORR: dates.map(() => 1), T2M_MAX: dates.map((_, i) => (i < 20 ? 38 : 25)) } as never,
    };
    expect(seasonStats(weather, null, [2023])[0]).toMatchObject({ precipMm: 365, heatDays: 20 });
  });
});

describe("irrigation detection (RFC §6.2)", () => {
  const stats = Array.from({ length: 6 }, (_, i) => ({
    season: 2018 + i,
    precipMm: 450,
    heatDays: 20,
    ndviPeak: 0.85,
  }));

  it("calls a field irrigated when ET clearly exceeds rain plus soil storage in most years", () => {
    const et = { months: [], annual: stats.map((s) => ({ year: s.season, etMm: 760 })) };
    const d = detectIrrigation(
      et,
      stats,
      { awsMm: 220, hydrologicGroup: "B", drainageClass: null, slopePct: 1, mapUnits: [] },
      null,
    );
    expect(d).toMatchObject({ status: "irrigated", method: "openet", confidence: 1 });
  });

  it("labels the method wapor when the ET series comes from WaPOR (Ukraine)", () => {
    const et = {
      months: [],
      annual: stats.map((s) => ({ year: s.season, etMm: 760 })),
      basis: "wapor" as const,
    };
    const soil = {
      awsMm: 240,
      aws100Mm: 160,
      hydrologicGroup: "C",
      drainageClass: null,
      slopePct: null,
      mapUnits: [],
    };
    expect(detectIrrigation(et, stats, soil, null)).toMatchObject({ status: "irrigated", method: "wapor" });
  });

  it("uses root-zone storage, not the full profile (Pivot 12, Finney County KS, live 2016–2025)", () => {
    const years = [
      [2016, 898, 503],
      [2017, 847, 619],
      [2018, 900, 619],
      [2019, 847, 472],
      [2020, 885, 383],
      [2021, 877, 452],
      [2022, 910, 284],
      [2023, 1069, 588],
      [2024, 1079, 450],
      [2025, 1103, 532],
    ] as const;
    const st = years.map(([season, , precipMm]) => ({ season, precipMm, heatDays: 40, ndviPeak: 0.85 }));
    const et = { months: [], annual: years.map(([year, etMm]) => ({ year, etMm })) };
    const soil = { awsMm: 318, hydrologicGroup: "B", drainageClass: null, slopePct: 1, mapUnits: [] };
    expect(detectIrrigation(et, st, soil, null).status).toBe("irrigated");
    expect(detectIrrigation(et, st, { ...soil, aws100Mm: 205 }, null).status).toBe("irrigated");
  });

  it("calls a field dryland when ET stays within rain plus storage", () => {
    const et = { months: [], annual: stats.map((s) => ({ year: s.season, etMm: 430 })) };
    expect(detectIrrigation(et, stats, null, null).status).toBe("dryland");
  });

  it("returns unknown with low agreement, so the agronomist is asked", () => {
    const et = { months: [], annual: stats.map((s, i) => ({ year: s.season, etMm: i % 2 ? 760 : 430 })) };
    expect(
      detectIrrigation(
        et,
        stats,
        { awsMm: 220, hydrologicGroup: null, drainageClass: null, slopePct: null, mapUnits: [] },
        null,
      ).status,
    ).toBe("unknown");
  });

  it("falls back to NDVI through dry summers outside the US", () => {
    const ndvi = { points: stats.flatMap((s) => curve(s.season, 8, 0.82)), pixelSizeM: 250 };
    expect(detectIrrigation(null, stats, null, ndvi)).toMatchObject({ status: "irrigated", method: "ndvi" });
  });
});

describe("current rotation match (RFC §6.3)", () => {
  const seasons = (crops: string[]): SeasonCrop[] =>
    crops.map((c, i) => ({
      season: 2020 + i,
      mainCrop: c,
      secondCrop: null,
      confidence: 0.9,
      source: "cdl",
    }));

  it("matches a baseline with a cyclic shift", () => {
    const m = matchBaseline(
      seasons(["winter_wheat", "sorghum", "corn", "corn", "winter_wheat", "sorghum"]),
      lib,
      "us-southern-plains",
    );
    expect(m).toMatchObject({ rotationId: "us-sp-corn2-wheat-sorghum", label: "baseline", share: 1 });
  });

  it("labels an unusual history 'Detected from history'", () => {
    const m = matchBaseline(
      seasons(["potato", "sugar_beet", "potato", "pea", "potato", "sugar_beet"]),
      lib,
      "us-southern-plains",
    );
    expect(m).toMatchObject({ rotationId: null, label: "detected" });
    expect(m.detected).toHaveLength(6);
  });

  it("needs at least 4 seasons and a library region", () => {
    expect(matchBaseline(seasons(["corn", "corn"]), lib, "us-southern-plains").label).toBe("detected");
    expect(matchBaseline(seasons(["corn", "corn", "corn", "corn"]), lib, null).label).toBe("detected");
  });
});

describe("cropland mask (outside the US)", () => {
  const ndviCrop = (season: number): SeasonCrop => ({
    season,
    mainCrop: "winter_wheat",
    secondCrop: null,
    confidence: 0.5,
    source: "ndvi",
  });
  const mask = (cropShares: Record<number, number>) => ({
    product: "test",
    seasons: Object.entries(cropShares).map(([year, cropShare]) => ({
      year: Number(year),
      cropShare,
      n: 100,
    })),
  });

  it("drops the crop guess for a season the land cover shows as not cropland", () => {
    expect(applyCroplandMask([ndviCrop(2020)], mask({ 2020: 0.05 }))).toEqual([]);
  });

  it("raises confidence where cropland is confirmed and keeps the crop an NDVI estimate", () => {
    const [c] = applyCroplandMask([ndviCrop(2021)], mask({ 2021: 0.9 }));
    expect(c).toMatchObject({ season: 2021, source: "ndvi", confidence: 0.6 });
  });

  it("leaves uncertain seasons, seasons outside the product, CDL seasons and a missing mask alone", () => {
    const cdl: SeasonCrop = { ...ndviCrop(2019), source: "cdl", confidence: 0.9 };
    expect(applyCroplandMask([ndviCrop(2022)], mask({ 2022: 0.35 }))[0]!.confidence).toBe(0.5);
    expect(applyCroplandMask([ndviCrop(2010)], mask({ 2022: 0 }))).toEqual([ndviCrop(2010)]);
    expect(applyCroplandMask([cdl], mask({ 2019: 0 }))).toEqual([cdl]);
    expect(applyCroplandMask([ndviCrop(2020)], null)).toEqual([ndviCrop(2020)]);
  });
});
