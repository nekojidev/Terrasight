import type { PestModel } from "@terrasight/library";
import { describe, expect, it } from "vitest";
import { combine, confidence, evaluate, modelApplies, snapshotHash, winterWheatStage } from "./index.js";
import type { DailyWeather, EvalInputs } from "./types.js";

const threshold = (value: number | null, unit: string) => ({
  value,
  unit,
  verified: true,
  source: {
    title: "Test source",
    publisher: "K-State",
    url: "https://example.org",
    accessed: "2026-11-14",
    appliesTo: [],
    type: "extension" as const,
  },
  verifiedBy: "t",
  verifiedAt: "2026-11-14",
  reviewedBy: null,
});

function inputs(over: Partial<EvalInputs> = {}): EvalInputs {
  return {
    fieldId: "f",
    tier: "A",
    regionId: "us-southern-plains",
    season: 2026,
    crops: [
      {
        season: 2023,
        mainCrop: "sorghum",
        secondCrop: null,
        confidence: 0.95,
        source: "cdl",
        isOverride: false,
      },
      {
        season: 2024,
        mainCrop: "corn",
        secondCrop: null,
        confidence: 0.95,
        source: "cdl",
        isOverride: false,
      },
      {
        season: 2025,
        mainCrop: "corn",
        secondCrop: null,
        confidence: 0.95,
        source: "cdl",
        isOverride: false,
      },
    ],
    nextCrop: { season: 2026, crop: "corn", source: "recommended" },
    record: {
      crop: { value: null, source: "unknown" },
      sowingDate: { value: null, source: "unknown" },
      emergenceDate: { value: null, source: "unknown" },
    },
    weather: [],
    ndvi: [],
    planningDeadline: "2026-04-20",
    scouted: [],
    ...over,
  };
}

const rootworm: PestModel = {
  pest: "western_corn_rootworm",
  enabled: true,
  phase: "hackathon",
  irreversible: false,
  planning: true,
  stageWindow: null,
  tree: { kind: "host_repeat", host: ["corn", "silage_corn"], seasons: { ref: "repeatSeasons" } },
  thresholds: { repeatSeasons: threshold(1, "seasons") },
  keyNumbers: ["hostSeasonsInRow", "hostSeasonsInPlan"],
  scoutAction: null,
};

/** Daily series with a constant temperature per year, plus an override for some years. */
function weather(fromYear: number, toDate: string, temp: (date: string) => number): DailyWeather[] {
  const out: DailyWeather[] = [];
  for (
    let t = Date.parse(`${fromYear}-01-01T00:00:00Z`);
    t <= Date.parse(`${toDate}T00:00:00Z`);
    t += 86_400_000
  ) {
    const date = new Date(t).toISOString().slice(0, 10);
    const c = temp(date);
    out.push({ date, tminC: c - 5, tmaxC: c + 5, tmeanC: c, precipMm: 0, origin: "power" });
  }
  return out;
}

describe("host_repeat (rootworm planning item)", () => {
  it("is high when corn follows two corn seasons and the next crop is corn again", () => {
    const r = evaluate(rootworm, inputs(), "2025-11-14");
    expect(r.level).toBe("high");
    expect(r.planning).toBe(true);
    expect(r.deadline).toBe("2026-04-20");
    expect(r.keyNumbers).toEqual([
      { id: "hostSeasonsInRow", value: 2, unit: "seasons", weight: 1 },
      { id: "hostSeasonsInPlan", value: 1, unit: "seasons", weight: 0.5 },
    ]);
    expect(r.citations[0]).toMatchObject({ threshold: "repeatSeasons", publisher: "K-State" });
  });

  it("is low when the next crop is not a host, moderate when it isn't chosen", () => {
    expect(
      evaluate(
        rootworm,
        inputs({ nextCrop: { season: 2026, crop: "alfalfa", source: "plan" } }),
        "2025-11-14",
      ).level,
    ).toBe("low");
    const r = evaluate(
      rootworm,
      inputs({ nextCrop: { season: 2026, crop: null, source: "unknown" } }),
      "2025-11-14",
    );
    expect(r.level).toBe("moderate");
    expect(r.unknowns).toContain("crop for 2026 not chosen yet");
  });

  it("is low when last season was not corn", () => {
    const crops = inputs().crops.map((c) => (c.season === 2025 ? { ...c, mainCrop: "soybean" } : c));
    expect(evaluate(rootworm, inputs({ crops }), "2025-11-14").level).toBe("low");
  });

  it("names the missing season when history stops early (CDL lag)", () => {
    const r = evaluate(
      rootworm,
      inputs({ nextCrop: { season: 2027, crop: "corn", source: "plan" } }),
      "2026-11-14",
    );
    expect(r.unknowns).toContain("crop for 2026 not known yet");
  });

  it("keeps a planning item without a date instead of inventing a scouting window", () => {
    const r = evaluate(rootworm, inputs({ planningDeadline: null }), "2025-11-14");
    expect(r.deadline).toBeNull();
    expect(r.unknowns).toContain("planning deadline not set");
  });

  it("is unknown, not low, without any history", () => {
    const r = evaluate(rootworm, inputs({ crops: [] }), "2025-11-14");
    expect(r.level).toBe("unknown");
    expect(r.confidence).toBe("low");
  });
});

describe("confidence rule (RFC §10.3)", () => {
  it("starts from the tier and drops one step per estimated input", () => {
    expect(confidence("A", 0, false)).toBe("high");
    expect(confidence("A", 1, false)).toBe("medium");
    expect(confidence("A", 5, false)).toBe("low");
    expect(confidence("B", 0, false)).toBe("medium");
    expect(confidence("C", 0, false)).toBe("low");
  });
  it("caps pest and disease at medium until scouted", () => {
    expect(confidence("A", 0, true)).toBe("medium");
    expect(evaluate(rootworm, inputs(), "2025-11-14").confidence).toBe("medium");
    expect(evaluate(rootworm, inputs({ scouted: ["western_corn_rootworm"] }), "2025-11-14").confidence).toBe(
      "high",
    );
  });
  it("drops a step for an unconfirmed crop season", () => {
    const crops = inputs().crops.map((c) => (c.season === 2024 ? { ...c, confidence: 0.5 } : c));
    const r = evaluate(rootworm, inputs({ crops, scouted: ["western_corn_rootworm"] }), "2025-11-14");
    expect(r.confidence).toBe("medium");
    expect(r.unknowns).toContain("Estimated: crop in 2024 not confirmed");
  });
});

describe("combinators", () => {
  it("all: a known low settles it; otherwise unknown wins", () => {
    expect(combine("all", ["high", "low"])).toBe("low");
    expect(combine("all", ["high", "unknown"])).toBe("unknown");
    expect(combine("all", ["low", "unknown"])).toBe("low");
    expect(combine("all", ["high", "moderate"])).toBe("moderate");
  });
  it("max: high wins over unknown; unknown is never shown as low", () => {
    expect(combine("max", ["high", "unknown"])).toBe("high");
    expect(combine("max", ["low", "unknown"])).toBe("unknown");
    expect(combine("max", ["low", "moderate"])).toBe("moderate");
  });
  it("gate: the second node only matters when the first fires", () => {
    const gated: PestModel = { ...rootworm, tree: { gate: [rootworm.tree, { kind: "weather_window" }] } };
    expect(evaluate(gated, inputs(), "2025-11-14").level).toBe("unknown");
    const crops = inputs().crops.map((c) => (c.season === 2025 ? { ...c, mainCrop: "soybean" } : c));
    expect(evaluate(gated, inputs({ crops }), "2025-11-14").level).toBe("low");
  });
});

const byd: PestModel = {
  pest: "barley_yellow_dwarf",
  enabled: true,
  phase: "hackathon",
  irreversible: true,
  planning: false,
  stageWindow: { crop: "winter_wheat", from: "emergence", to: "dormancy" },
  tree: {
    all: [
      {
        kind: "climate_anomaly",
        variable: "air_temp_mean",
        window: "autumn",
        percentile: { ref: "warmPercentile" },
      },
      {
        kind: "degree_days",
        temp: "air",
        baseC: { ref: "baseC" },
        biofix: "emergence",
        stages: { risk: { ref: "riskDD" } },
      },
    ],
  },
  thresholds: {
    baseC: threshold(3, "°C"),
    warmPercentile: threshold(75, "percentile"),
    riskDD: threshold(300, "°C·d"),
  },
  keyNumbers: ["autumnPercentile", "daysSinceEmergence", "degreeDays"],
  scoutAction: null,
};

describe("BYD: warm autumn + degree days from emergence, frost deadline", () => {
  const record = {
    crop: { value: "winter_wheat", source: "confirmed" as const },
    sowingDate: { value: "2025-09-20", source: "confirmed" as const },
    emergenceDate: { value: "2025-09-30", source: "confirmed" as const },
  };
  // 2000–2024 autumns at 12 °C, 2025 at 15 °C (warmest); forecast frost on 2025-11-18.
  const w = weather(2000, "2025-11-14", (d) => (d.startsWith("2025") ? 15 : 12));
  const forecast: DailyWeather[] = ["2025-11-15", "2025-11-16", "2025-11-17", "2025-11-18"].map(
    (date, i) => ({
      date,
      tminC: i === 3 ? -3 : 2,
      tmaxC: 12,
      tmeanC: 7,
      precipMm: 0,
      origin: "forecast",
      forecastDay: i + 1,
    }),
  );

  it("is high in the warmest autumn with enough degree days, deadline = first forecast frost", () => {
    const r = evaluate(byd, inputs({ record, weather: [...w, ...forecast] }), "2025-11-14");
    expect(r.level).toBe("high");
    expect(r.deadline).toBe("2025-11-18");
    expect(r.irreversible).toBe(true);
    expect(r.keyNumbers.find((k) => k.id === "autumnPercentile")?.value).toBe(100);
    // 46 days × (15 − 3) °C = 552 °C·d
    expect(r.keyNumbers.find((k) => k.id === "degreeDays")?.value).toBe(552);
  });

  it("is low in an ordinary autumn", () => {
    const cool = weather(2000, "2025-11-14", (d) => (d.startsWith("2025") ? 11 : 12));
    expect(evaluate(byd, inputs({ record, weather: cool }), "2025-11-14").level).toBe("low");
  });

  it("is unknown without an emergence date, and says so", () => {
    const r = evaluate(byd, inputs({ weather: w }), "2025-11-14");
    expect(r.level).toBe("unknown");
    expect(r.unknowns).toContain("emergence date is missing");
  });

  it("runs only inside the winter-wheat stage window", () => {
    const i = inputs({ record });
    expect(winterWheatStage(i, "2025-11-14")).toBe("emergence");
    expect(modelApplies(byd, { crop: "winter_wheat", stage: winterWheatStage(i, "2025-11-14") })).toBe(true);
    expect(modelApplies(byd, { crop: "corn", stage: "emergence" })).toBe(false);
    expect(modelApplies(byd, { crop: "winter_wheat", stage: winterWheatStage(i, "2026-05-10") })).toBe(false);
  });
});

describe("green_bridge (wheat streak mosaic: volunteer not dead 2 weeks before sowing)", () => {
  const wsm: PestModel = {
    pest: "wheat_streak_mosaic",
    enabled: true,
    phase: "hackathon",
    irreversible: false,
    planning: false,
    stageWindow: { crop: "winter_wheat", from: "previous_harvest", to: "dormancy" },
    tree: {
      kind: "green_bridge",
      bufferM: { ref: "bufferM" },
      greenNdvi: { ref: "greenNdvi" },
      daysBeforeSowing: { ref: "daysBeforeSowing" },
    },
    thresholds: {
      bufferM: threshold(805, "m"),
      greenNdvi: threshold(0.3, "NDVI"),
      daysBeforeSowing: threshold(14, "days"),
    },
    keyNumbers: ["greenDaysBeforeSowing", "sowingDate"],
    scoutAction: null,
  };
  const crops = [
    {
      season: 2025,
      mainCrop: "winter_wheat",
      secondCrop: null,
      confidence: 0.9,
      source: "cdl",
      isOverride: false,
    },
  ];
  const record = {
    crop: { value: "winter_wheat", source: "confirmed" as const },
    sowingDate: { value: "2025-09-15", source: "confirmed" as const },
    emergenceDate: { value: null, source: "unknown" as const },
  };

  it("is high when the field was still green in the 14 days before sowing", () => {
    const ndvi = [
      { date: "2025-08-10", mean: 0.42 },
      { date: "2025-09-05", mean: 0.38 },
    ];
    const r = evaluate(wsm, inputs({ season: 2026, crops, record, ndvi }), "2025-11-14");
    expect(r.level).toBe("high");
    expect(r.keyNumbers[0]).toMatchObject({ id: "greenDaysBeforeSowing", value: 10 });
    expect(r.unknowns).toContain("Volunteer patches smaller than 10 m may not show in Sentinel-2 NDVI");
    expect(r.unknowns).toContain("Volunteer on neighbouring land within 805 m is not checked");
  });

  it("is low when volunteer was green earlier but dead 2 weeks before sowing", () => {
    const ndvi = [
      { date: "2025-08-10", mean: 0.42 },
      { date: "2025-09-05", mean: 0.15 },
    ];
    expect(evaluate(wsm, inputs({ season: 2026, crops, record, ndvi }), "2025-11-14").level).toBe("low");
  });

  it("is low after a non-wheat crop, unknown without images in the window", () => {
    expect(
      evaluate(
        wsm,
        inputs({ season: 2026, crops: [{ ...crops[0]!, mainCrop: "corn" }], record }),
        "2025-11-14",
      ).level,
    ).toBe("low");
    expect(
      evaluate(
        wsm,
        inputs({ season: 2026, crops, record, ndvi: [{ date: "2025-08-01", mean: 0.5 }] }),
        "2025-11-14",
      ).level,
    ).toBe("unknown");
  });
});

describe("sowing_before (planting before the Best Pest Management Planting Date)", () => {
  const byd: PestModel = {
    pest: "barley_yellow_dwarf",
    enabled: true,
    phase: "hackathon",
    irreversible: true,
    planning: false,
    stageWindow: { crop: "winter_wheat", from: "emergence", to: "dormancy" },
    tree: { kind: "sowing_before", before: { ref: "bpmpDate" } },
    thresholds: { bpmpDate: threshold(910, "MMDD") },
    keyNumbers: ["daysBeforeBpmp", "sowingDate"],
    scoutAction: null,
  };
  const rec = (date: string, source: "confirmed" | "regional" = "confirmed") => ({
    crop: { value: "winter_wheat", source: "confirmed" as const },
    sowingDate: { value: date, source },
    emergenceDate: { value: null, source: "unknown" as const },
  });
  const frost: DailyWeather = {
    date: "2025-11-18",
    tminC: -3,
    tmaxC: 8,
    tmeanC: 2,
    precipMm: 0,
    origin: "forecast",
    forecastDay: 4,
  };

  it("is high when sown before the date; the deadline is the first forecast freeze", () => {
    const r = evaluate(byd, inputs({ record: rec("2025-09-01"), weather: [frost] }), "2025-11-14");
    expect(r.level).toBe("high");
    expect(r.deadline).toBe("2025-11-18");
    expect(r.keyNumbers[0]).toMatchObject({ id: "daysBeforeBpmp", value: 9 });
  });
  it("is low when sown on or after the date", () => {
    expect(evaluate(byd, inputs({ record: rec("2025-09-10") }), "2025-11-14").level).toBe("low");
    expect(evaluate(byd, inputs({ record: rec("2025-10-01") }), "2025-11-14").level).toBe("low");
  });
  it("drops a confidence step for an estimated sowing date and is unknown without one", () => {
    const r = evaluate(
      byd,
      inputs({ tier: "A", scouted: ["barley_yellow_dwarf"], record: rec("2025-09-01", "regional") }),
      "2025-11-14",
    );
    expect(r.confidence).toBe("medium");
    const none = { ...rec("2025-09-01"), sowingDate: { value: null, source: "unknown" as const } };
    expect(evaluate(byd, inputs({ record: none }), "2025-11-14").level).toBe("unknown");
  });
});

describe("regional thresholds (RFC §11.3)", () => {
  it("uses a value only in the regions its source covers", () => {
    const ks = {
      ...threshold(1, "seasons"),
      source: { ...threshold(1, "seasons").source, appliesTo: ["us-southern-plains"] },
    };
    const m = { ...rootworm, thresholds: { repeatSeasons: ks } };
    expect(evaluate(m, inputs({ regionId: "us-southern-plains" }), "2025-11-14").level).toBe("high");
    const r = evaluate(m, inputs({ regionId: "eu-central" }), "2025-11-14");
    expect(r.level).toBe("unknown");
    expect(r.unknowns).toContain("threshold seasons is missing");
  });
});

describe("input snapshot hash", () => {
  it("is stable across key order and changes with inputs", () => {
    const a = inputs();
    const b = JSON.parse(JSON.stringify(a, Object.keys(a).sort())) as EvalInputs;
    expect(snapshotHash(a, "2025-11-14", "v1")).toBe(snapshotHash({ ...b, ...a }, "2025-11-14", "v1"));
    expect(snapshotHash(a, "2025-11-14", "v1")).not.toBe(
      snapshotHash(inputs({ tier: "B" }), "2025-11-14", "v1"),
    );
  });
});
