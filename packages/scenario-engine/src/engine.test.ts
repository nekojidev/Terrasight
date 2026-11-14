import type { WeatherDay } from "@terrasight/simulator";
import { describe, expect, it } from "vitest";
import {
  overlap,
  pestPressure,
  planSeasons,
  rank,
  runScenarios,
  withEt0,
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
      expect(s.drought).toBeLessThanOrEqual(s.margin);
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
    expect(cc.marginBySeason[1]!).toBeLessThan(cc.marginBySeason[0]!);
  });
});
