import { type WeatherDay } from "@terrasight/simulator";
import { describe, expect, it } from "vitest";
import { runScenarios, withEt0, type EngineInput, type Rotation } from "./engine.js";
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
    runs: 30,
    ...over,
  };
}



describe("fixedCandidates (year-set comparison)", () => {
  it("shows exactly the given options, all of them, and nothing else", () => {
    const ids = ["continuous-corn", "wheat-fallow", "corn-soy-wheat", "alfalfa3-corn-wheat"];
    const fixed = input({ rotations: rotations.filter((r) => ids.includes(r.id)), fixedCandidates: true });
    const r = runScenarios(fixed);
    expect(r.alternatives.map((a) => a.id).sort()).toEqual([...ids].sort());
    expect(r.current.id).toBe("corn2-wheat-sorghum");
    // best score first
    const scores = r.alternatives.map((a) => a.score ?? 0);
    expect(scores).toEqual([...scores].sort((a, b) => b - a));
  });

  it("an option's mean margin does not depend on which other options are evaluated", () => {
    const all = runScenarios(input({ rotations, fixedCandidates: true }));
    const some = runScenarios(
      input({ rotations: rotations.filter((r) => r.id === "corn-soy-wheat"), fixedCandidates: true }),
    );
    const a = all.alternatives.find((x) => x.id === "corn-soy-wheat")!;
    const b = some.alternatives.find((x) => x.id === "corn-soy-wheat")!;
    expect(b.margin).toBeCloseTo(a.margin!, 6);
    expect(b.drought).toBeCloseTo(a.drought!, 6);
  });

  it("without the flag the engine still picks its own options", () => {
    const r = runScenarios(input());
    expect(r.alternatives.length).toBeLessThanOrEqual(2);
  });
});
