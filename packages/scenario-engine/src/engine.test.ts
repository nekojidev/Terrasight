import { readFileSync } from "node:fs";
import type { WeatherDay } from "@terrasight/simulator";
import { describe, expect, it } from "vitest";
import {
  overlap,
  pestPressure,
  planSeasons,
  rank,
  runScenarios,
  splitRotations,
  unevaluableCrops,
  weatherRuns,
  withEt0,
  yieldRange,
  percentile,
  type EngineInput,
  type Rotation,
} from "./engine.js";
import { Pcg32 } from "./random.js";

const site = { latDeg: 38.1, elevationM: 900, awsMmPerM: 180, hydGroup: "B" as const, slopePct: 1 };

/** 45 synthetic season windows (1 Sep y−1 → 31 Aug y) with year-to-year rain variability; 2022 is very dry. */
function weather(): Map<number, WeatherDay[]> {
  const rng = new Pcg32(2026n);
  const out = new Map<number, WeatherDay[]>();
  for (let y = 1981; y <= 2025; y++) {
    const wet = y === 2022 ? 0.35 : 0.6 + rng.float() * 0.8;
    const days: WeatherDay[] = [];
    for (
      let t = Date.parse(`${y - 1}-09-01T00:00:00Z`);
      t < Date.parse(`${y}-09-01T00:00:00Z`);
      t += 86_400_000
    ) {
      const date = new Date(t).toISOString().slice(0, 10);
      const doy = (t - Date.parse(`${date.slice(0, 4)}-01-01T00:00:00Z`)) / 86_400_000;
      const season = Math.sin(((doy - 100) / 365) * 2 * Math.PI);
      const tmean = 13 + 13 * season;
      days.push({
        date,
        tmin: tmean - 7,
        tmax: tmean + 7,
        precip: rng.float() < 0.18 ? (8 + rng.float() * 14) * wet * (1 + season) : 0,
        rh: 55,
        rs: 17 + 9 * season,
        u2: 3,
      });
    }
    out.set(y, withEt0(days, site));
  }
  return out;
}
const WEATHER = weather();

const rotations: Rotation[] = [
  {
    id: "corn2-wheat-sorghum",
    sequence: ["corn", "corn", "winter_wheat", "sorghum"],
    irrigation: "required",
  },
  { id: "continuous-corn", sequence: ["corn"], irrigation: "required" },
  {
    id: "alfalfa3-corn-wheat",
    sequence: ["alfalfa", "alfalfa", "alfalfa", "corn", "winter_wheat"],
    irrigation: "required",
  },
  { id: "corn-soy-wheat", sequence: ["corn", "soybean", "winter_wheat"], irrigation: "required" },
  { id: "corn-sorghum-wheat", sequence: ["corn", "sorghum", "winter_wheat"], irrigation: "optional" },
  { id: "wheat-sorghum-fallow", sequence: ["winter_wheat", "sorghum", "fallow"], irrigation: "none" },
  { id: "wheat-fallow", sequence: ["winter_wheat", "fallow"], irrigation: "none" },
];
// Test prices only (the real ones come from data/prices.json, S-06.05).
const prices = {
  corn: { price: 175, variableCost: 1250, yieldRef: 13.5 },
  sorghum: { price: 165, variableCost: 700, yieldRef: 9 },
  winter_wheat: { price: 200, variableCost: 500, yieldRef: 5.5 },
  soybean: { price: 380, variableCost: 650, yieldRef: 4.2 },
  alfalfa: { price: 200, variableCost: 900, yieldRef: 15 },
  fallow: { price: 0, variableCost: 60, yieldRef: 0 },
};
const sowing = { corn: "04-25", sorghum: "06-01", winter_wheat: "10-01", soybean: "05-20", alfalfa: "04-01" };

function input(over: Partial<EngineInput> = {}): EngineInput {
  return {
    fieldKey: "pivot-12",
    site,
    irrigated: true,
    firstSeason: 2026,
    rotations,
    current: {
      rotationId: "corn2-wheat-sorghum",
      sequence: rotations[0]!.sequence,
      position: 2,
      label: "baseline",
    },
    weatherByYear: WEATHER,
    sowing,
    prices,
    soilCarbon: 45,
    pestModels: [{ pest: "western_corn_rootworm", hosts: ["corn"], repeatSeasons: 1 }],
    history: ["corn", "corn"],
    runs: 60,
    ...over,
  };
}

describe("5 seasons, no padding (RFC §7.7)", () => {
  it("the current rotation continues from its position; alternatives start at year 1", () => {
    expect(planSeasons(["corn", "corn", "winter_wheat", "sorghum"], 2, 2026).map((p) => p.crops[0])).toEqual([
      "winter_wheat",
      "sorghum",
      "corn",
      "corn",
      "winter_wheat",
    ]);
    expect(
      planSeasons(["alfalfa", "alfalfa", "alfalfa", "corn", "winter_wheat"], 0, 2026).map((p) => p.season),
    ).toEqual([2026, 2027, 2028, 2029, 2030]);
  });
});

describe("scenario engine (RFC §8)", () => {
  const r = runScenarios(input());

  it("returns the current rotation and up to 2 different alternatives over exactly 5 seasons", () => {
    expect(r.current.kind).toBe("current");
    expect(r.current.plan).toHaveLength(5);
    expect(r.alternatives.length).toBeGreaterThanOrEqual(1);
    expect(r.alternatives.length).toBeLessThanOrEqual(2);
    if (r.alternatives.length === 2)
      expect(overlap(r.alternatives[0]!.plan, r.alternatives[1]!.plan)).toBeLessThan(0.6);
    for (const a of r.alternatives)
      expect(a.plan.map((p) => p.season)).toEqual([2026, 2027, 2028, 2029, 2030]);
  });

  it("scores against the current rotation and reports drought, 2022, prices and soil", () => {
    expect(r.current.delta).toEqual({ margin: 0, water: 0, soil: 0, drought: 0 });
    for (const s of [r.current, ...r.alternatives]) {
      expect(s.drought!).toBeLessThanOrEqual(s.margin!);
      expect(Number.isFinite(s.if2022.margin)).toBe(true);
      expect(s.if2022.margin).toBeLessThanOrEqual(s.if2022.typical + 1e-6);
      expect(s.marginBySeason).toHaveLength(5);
      expect(Number.isFinite(s.carbonChange)).toBe(true);
    }
    const wins = [r.current, ...r.alternatives].reduce((n, s) => n + s.priceWins, 0);
    expect(wins).toBe(10); // counted among the shown options only
    expect(r.bestFit).not.toBeNull();
  });

  it("counts rootworm pressure (corn after corn) without scoring it (RFC §8.5)", () => {
    expect(
      pestPressure(
        planSeasons(["corn"], 0, 2026),
        ["corn"],
        [{ pest: "wcr", hosts: ["corn"], repeatSeasons: 1 }],
      ),
    ).toEqual([{ pest: "wcr", seasons: 5 }]);
    expect(
      pestPressure(
        planSeasons(["corn", "soybean"], 0, 2026),
        ["soybean"],
        [{ pest: "wcr", hosts: ["corn"], repeatSeasons: 1 }],
      ),
    ).toEqual([{ pest: "wcr", seasons: 0 }]);
  });

  it("is deterministic: same inputs → identical output", () => {
    expect(runScenarios(input())).toEqual(r);
  });

  it("drops 'irrigation required' rotations on a dryland field", () => {
    const dry = runScenarios(
      input({
        irrigated: false,
        current: {
          rotationId: "wheat-fallow",
          sequence: ["winter_wheat", "fallow"],
          position: 0,
          label: "baseline",
        },
      }),
    );
    for (const a of dry.alternatives) expect(["corn-sorghum-wheat", "wheat-sorghum-fallow"]).toContain(a.id);
    expect(dry.current.water).toBe(0);
  });

  it("a water cap never filters: options over the cap are simulated with deficit irrigation", () => {
    const capped = runScenarios(input({ waterCapMm: 200 }));
    const all = [capped.current, ...capped.alternatives];
    expect(all.some((s) => s.capped)).toBe(true);
    for (const s of all.filter((x) => x.capped)) {
      expect(s.water).toBeLessThanOrEqual(200 + 1e-6);
      expect(s.capLoss).toBeLessThanOrEqual(0);
    }
  });

  it("re-ranks for priorities in under 50 ms", () => {
    const t0 = performance.now();
    const water = rank([r.current, ...r.alternatives], { margin: 0, water: 1, soil: 0, drought: 0 });
    expect(performance.now() - t0).toBeLessThan(50);
    const best = water.reduce((b, s) => ((s.score ?? 0) > (b.score ?? 0) ? s : b));
    expect(best.water).toBe(Math.min(...water.map((s) => s.water)));
  });

  it("runs 150 weather runs for 7 rotations in under 5 s", () => {
    const t0 = performance.now();
    runScenarios(input({ runs: 150 }));
    expect(performance.now() - t0).toBeLessThan(5_000);
  });
});

describe("rotation yield effects (verified 2026-11-14)", () => {
  it("penalise a crop following itself", async () => {
    const { rotationEffect } = await import("./rotation-effects.js");
    expect(rotationEffect("corn", ["corn"], true)).toBe(0.88);
    expect(rotationEffect("corn", ["corn"], false)).toBe(0.9);
    expect(rotationEffect("corn", ["soybean"], true)).toBe(1);
    expect(rotationEffect("sorghum", ["sorghum"], false)).toBe(0.65);
    expect(rotationEffect("winter_wheat", ["winter_wheat"], false)).toBe(0.74);
  });
  it("continuous corn loses margin against corn in rotation", () => {
    const only = (ids: string[]) =>
      runScenarios(
        input({
          rotations: rotations.filter((r) => ids.includes(r.id)),
          current: {
            rotationId: null,
            sequence: ["corn", "soybean", "winter_wheat"],
            position: 0,
            label: "detected",
          },
          history: ["winter_wheat"],
        }),
      );
    const r = only(["continuous-corn"]);
    const cc = r.alternatives.find((a) => a.id === "continuous-corn")!;
    // 4 of 5 corn seasons follow corn: margin is lower than without the effect would give
    expect(cc.pestPressure[0]!.seasons).toBe(4);
    expect(cc.marginBySeason![1]!).toBeLessThan(cc.marginBySeason![0]!);
  });
});

describe("yield range (FR-YF-1)", () => {
  const inp = input({ runs: 40 });
  const runs = weatherRuns(inp);
  const plan = [{ season: 2026, crops: ["corn"] }];

  it("percentiles interpolate a sorted sample", () => {
    expect(percentile([1, 2, 3, 4, 5], 0.5)).toBe(3);
    expect(percentile([0, 10], 0.1)).toBeCloseTo(1);
  });

  it("returns ordered P10 <= P50 <= P90 in t/ha, deterministic, without a pest term", () => {
    const a = yieldRange(inp, plan, runs)!;
    const b = yieldRange(inp, plan, weatherRuns(inp))!;
    expect(a).toEqual(b);
    expect(a.crop).toBe("corn");
    expect(a.season).toBe(2026);
    expect(a.unit).toBe("t/ha");
    expect(a.runs).toBe(40);
    expect(a.pestLossIncluded).toBe(false);
    expect(a.p10).toBeGreaterThan(0);
    expect(a.p10).toBeLessThanOrEqual(a.p50);
    expect(a.p50).toBeLessThanOrEqual(a.p90);
    // Never above the water-unstressed reference (rotation effect on corn after corn only lowers it).
    expect(a.p90).toBeLessThanOrEqual(prices.corn.yieldRef * 1.0001);
  });

  it("dryland yields spread wider than irrigated", () => {
    const dry = yieldRange(
      input({ runs: 40, irrigated: false }),
      plan,
      weatherRuns(input({ runs: 40, irrigated: false })),
    )!;
    const wet = yieldRange(inp, plan, runs)!;
    expect(dry.p90 - dry.p10).toBeGreaterThan(wet.p90 - wet.p10);
  });

  it("is null for fallow or an unpriced crop", () => {
    expect(yieldRange(inp, [{ season: 2026, crops: ["fallow"] }], runs)).toBeNull();
    expect(yieldRange(inp, [{ season: 2026, crops: ["rye"] }], runs)).toBeNull();
  });
});

describe("Ukraine (tier C) inputs", () => {
  const lib = JSON.parse(readFileSync(new URL("../../../data/rotations.json", import.meta.url), "utf8")) as {
    rotations: Array<Rotation & { region: string }>;
  };
  const ua = (region: string) => lib.rotations.filter((r) => r.region === region);
  const uaPrices = {
    winter_wheat: { price: 200, variableCost: 500, yieldRef: 4.5 },
    corn: { price: 190, variableCost: 800, yieldRef: 7 },
    sunflower: { price: 450, variableCost: 450, yieldRef: 2 },
    soybean: { price: 420, variableCost: 400, yieldRef: 2.4 },
    spring_barley: { price: 180, variableCost: 400, yieldRef: 4 },
  };

  it("has UA library rotations in every UA region", () => {
    for (const r of ["ua-steppe", "ua-forest-steppe", "ua-polissia"]) expect(ua(r).length).toBeGreaterThan(2);
  });

  it("missing prices path: no verified prices means no rotation competes and nothing is invented", () => {
    const s = splitRotations(ua("ua-forest-steppe"), {});
    expect(s.usable).toEqual([]);
    expect(s.unpriced).toContain("corn");
  });

  it("unmodelled crops (no simulator parameters) keep a rotation out instead of looking like fallow", () => {
    const s = splitRotations(ua("ua-polissia"), {
      ...uaPrices,
      winter_rye: { price: 150, variableCost: 300, yieldRef: 3 },
    });
    expect(s.unmodelled).toEqual(expect.arrayContaining(["lupin", "potato"]));
    expect(s.usable.map((r) => r.id)).toContain("ua-po-corn-soy-rye");
    expect(unevaluableCrops(["winter_wheat", "lupin"], uaPrices)).toEqual(["lupin"]);
  });

  it("with prices for a UA region, candidates are found and barley and rye are simulated (not dropped)", () => {
    const { usable } = splitRotations(ua("ua-forest-steppe"), uaPrices);
    expect(usable.length).toBeGreaterThan(1);
    const base = usable.find((r) => r.id === "ua-fs-corn-soy")!;
    const res = runScenarios(
      input({
        irrigated: false,
        rotations: usable,
        current: { rotationId: base.id, sequence: base.sequence, position: 0, label: "baseline" },
        prices: uaPrices,
        sowing: { ...sowing, sunflower: "04-25", spring_barley: "03-25" },
        history: ["soybean"],
        runs: 30,
      }),
    );
    expect(res.noLibrary).toBe(false);
    expect(res.candidates).toBeGreaterThan(0);
    expect(res.alternatives.length).toBeGreaterThan(0);
    expect(Number.isFinite(res.current.margin)).toBe(true);
    const barley = splitRotations(
      [{ id: "b", sequence: ["spring_barley", "winter_wheat"], irrigation: "none" }],
      uaPrices,
    ).usable;
    expect(barley).toHaveLength(1);
  });
});

describe("caveats and unverified inputs", () => {
  const caveatsOf = (over: Partial<EngineInput>, ids: string[]) => {
    const r = runScenarios(input({ rotations: rotations.filter((x) => ids.includes(x.id)), ...over }));
    return r.alternatives[0]!.caveats;
  };
  it("flags adapted crop parameters (UA proxy) on scenarios and yield ranges", () => {
    const rot: Rotation = {
      id: "barley-wheat",
      sequence: ["winter_barley", "winter_wheat"],
      irrigation: "none",
    };
    const p = { ...prices, winter_barley: { price: 190, variableCost: 450, yieldRef: 5 } };
    const sow = { ...sowing, winter_barley: "10-01" };
    const i = input({ rotations: [rot], prices: p, sowing: sow, irrigated: false, runs: 20 });
    const r = runScenarios(i);
    expect(r.alternatives[0]!.caveats).toContain("unverified-crop-parameters:winter_barley");
    // winter wheat's own p is adapted too (dormancy), so it is flagged as well; corn is not
    expect(r.alternatives[0]!.caveats).toContain("unverified-crop-parameters:winter_wheat");
    expect(caveatsOf({ runs: 20 }, ["continuous-corn"]).some((c) => c.startsWith("unverified-crop"))).toBe(
      false,
    );
    const yr = yieldRange(i, planSeasons(rot.sequence, 0, 2026), weatherRuns(i).slice(0, 10), 0);
    expect(yr!.caveats).toEqual(["unverified-crop-parameters:winter_barley"]);
  });
  it("irrigated results say water cost is inside the budget unless a verified cost is passed", () => {
    expect(caveatsOf({ runs: 20 }, ["corn-soy-wheat"])).toContain("irrigation-cost-in-budget");
    expect(caveatsOf({ runs: 20, irrigated: false }, ["wheat-fallow"])).not.toContain(
      "irrigation-cost-in-budget",
    );
    expect(caveatsOf({ runs: 20, irrigationCostPerMm: 0.5 }, ["corn-soy-wheat"])).not.toContain(
      "irrigation-cost-in-budget",
    );
  });
  it("prices irrigation water per mm when a verified cost is given", () => {
    const free = runScenarios(input({ runs: 30 })).current;
    const paid = runScenarios(input({ runs: 30, irrigationCostPerMm: 1 })).current;
    expect(paid.margin!).toBeLessThan(free.margin!);
    expect(free.margin! - paid.margin!).toBeCloseTo(free.water, 0);
  });
  it("says the repeat penalty is not modelled for unverified repeats", () => {
    const rot: Rotation = { id: "soy-soy", sequence: ["soybean"], irrigation: "optional" };
    const r = runScenarios(input({ rotations: [rot], history: ["soybean"], runs: 20 }));
    expect(r.alternatives[0]!.caveats).toContain("repeat-penalty-not-modelled:soybean");
    const c = runScenarios(input({ rotations: [rotations[1]!], runs: 20 }));
    expect(c.alternatives[0]!.caveats).not.toContain("repeat-penalty-not-modelled:corn");
  });
});

describe("unverified rotation effects", () => {
  it("are not applied and are cited", async () => {
    const { rotationEffect, ROTATION_EFFECTS, repeatPenaltyUnmodelled } =
      await import("./rotation-effects.js");
    for (const crop of ["soybean", "sunflower", "winter_canola", "spring_canola", "sugar_beet"]) {
      const e = ROTATION_EFFECTS.find((x) => x.crop === crop)!;
      expect(e.verified).toBe(false);
      expect(e.sources!.length).toBeGreaterThan(0);
      expect(e.sources!.every((s) => s.url.startsWith("https://"))).toBe(true);
      expect(rotationEffect(crop, e.after, true)).toBe(1);
      expect(repeatPenaltyUnmodelled(crop, e.after)).toBe(true);
    }
    expect(repeatPenaltyUnmodelled("corn", ["corn"])).toBe(false);
    expect(repeatPenaltyUnmodelled("soybean", ["corn"])).toBe(false);
  });
  it("apply once verified", async () => {
    const { rotationEffect, ROTATION_EFFECTS } = await import("./rotation-effects.js");
    const e = ROTATION_EFFECTS.find((x) => x.crop === "soybean")!;
    e.verified = true;
    try {
      expect(rotationEffect("soybean", ["soybean"], true)).toBe(0.93);
    } finally {
      e.verified = false;
    }
  });
});

describe("agronomy-only mode (no prices)", () => {
  const noPrices = (over: Partial<EngineInput> = {}) =>
    input({
      agronomyOnly: true,
      prices: {},
      yieldRefs: { corn: 13.5, winter_wheat: 5.5, sorghum: 9, soybean: 4.2 },
      ...over,
    });
  const r = runScenarios(noPrices());

  it("runs without prices and reports no money anywhere", () => {
    expect(r.mode).toBe("agronomy");
    expect(r.alternatives.length).toBeGreaterThanOrEqual(1);
    for (const s of [r.current, ...r.alternatives]) {
      expect(s.margin).toBeNull();
      expect(s.marginBySeason).toBeNull();
      expect(s.drought).toBeNull();
      expect(s.delta.margin).toBeNull();
      expect(s.priceWins).toBe(0);
      expect(Number.isFinite(s.water)).toBe(true);
      expect(Number.isFinite(s.erosion)).toBe(true);
      expect(s.droughtYield).toBeGreaterThan(0);
      expect(s.droughtYield).toBeLessThanOrEqual(1.5);
    }
    expect(r.current.delta).toEqual({ margin: null, water: 0, soil: 0, drought: 0 });
  });

  it("water, erosion and drought resilience match the money mode (same simulator, same weather runs)", () => {
    const money = runScenarios(input());
    const a = money.alternatives[0]!;
    const same = [r.current, ...r.alternatives].find((x) => x.id === a.id);
    // The same rotation gives the same agronomy numbers whether or not prices exist.
    if (same) {
      expect(same.water).toBeCloseTo(a.water, 6);
      expect(same.erosion).toBeCloseTo(a.erosion, 6);
      expect(same.droughtYield).toBeCloseTo(a.droughtYield, 6);
    }
    expect(r.current.water).toBeCloseTo(money.current.water, 6);
    expect(r.current.carbonChange!).toBeCloseTo(money.current.carbonChange!, 6);
  });

  it("soil carbon is unknown (null, never guessed) when a crop has no reference yield, with a caveat", () => {
    const x = runScenarios(noPrices({ yieldRefs: {} }));
    for (const s of [x.current, ...x.alternatives]) {
      expect(s.carbonChange).toBeNull();
      expect(s.caveats).toContain("yield-reference-missing");
    }
    expect(Number.isFinite(x.current.erosion)).toBe(true);
  });

  it("ranks on the non-money metrics only and is deterministic", () => {
    const ranked = rank([r.current, ...r.alternatives], { margin: 0, water: 1, soil: 0, drought: 0 });
    const byWater = [...ranked].sort((a, b) => (b.score ?? 0) - (a.score ?? 0))[0]!;
    const minWater = Math.min(...ranked.map((s) => s.water));
    expect(byWater.water).toBeCloseTo(minWater, 6);
    expect(runScenarios(noPrices()).current.droughtYield).toBe(r.current.droughtYield);
  });

  it("splitRotations can skip the price requirement (modelled crops only)", () => {
    const s = splitRotations(rotations, {}, false);
    expect(s.usable).toHaveLength(rotations.length);
    expect(s.unpriced).toEqual([]);
  });
});
