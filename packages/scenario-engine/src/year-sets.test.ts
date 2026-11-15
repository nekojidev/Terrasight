import { CROPS, simulateSeason, type WeatherDay } from "@terrasight/simulator";
import { describe, expect, it } from "vitest";
import {
  YearSetTooSmallError,
  hindcastSeasons,
  retrospective,
  runScenarios,
  weatherRuns,
  withEt0,
  yearsOfSet,
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


const DRY = {
  irrigated: false,
  current: {
    rotationId: "wheat-fallow",
    sequence: ["winter_wheat", "fallow"] as Rotation["sequence"],
    position: 0,
    label: "baseline" as const,
  },
};
const ALL_YEARS = [...WEATHER.keys()];
const subset = (from: number, to: number) => new Map([...WEATHER].filter(([y]) => y >= from && y <= to));

describe("`all` regression (S-10.05)", () => {
  // Numbers recorded from the engine BEFORE year sets existed (version 2026-11-17.1): `all` must not move a bit.
  it("irrigated baseline input", () => {
    const r = runScenarios(input());
    expect(r.current.margin).toBe(785.3000000000006);
    expect(r.current.drought).toBe(785.3000000000001);
    expect(r.current.water).toBe(155.4264816664724);
    expect(r.current.carbonChange).toBe(2.3379287527526995);
    expect(r.current.erosion).toBe(265.9694388070223);
    expect(r.current.droughtYield).toBe(0.976);
    expect(r.current.if2022).toEqual({ margin: 600, typical: 600, season: 2026 });
    expect(r.bestFit).toBe("alfalfa3-corn-wheat");
    expect(r.alternatives.map((a) => [a.id, a.margin, a.drought, a.priceWins])).toEqual([
      ["alfalfa3-corn-wheat", 1302.5, 1302.5, 10],
      ["corn-sorghum-wheat", 822.3000000000006, 822.3000000000001, 0],
    ]);
  });
  it("dryland input", () => {
    const r = runScenarios(input(DRY));
    expect(r.current.margin).toBe(300.17793357536146);
    expect(r.current.drought).toBe(231.14183581754264);
    expect(r.current.carbonChange).toBe(-0.7312540046771687);
    expect(r.current.erosion).toBe(270.283705859022);
    expect(r.current.droughtYield).toBe(0.9046743961977661);
    expect(r.current.if2022).toEqual({ margin: 226.03284188946316, typical: 614.9919161768898, season: 2026 });
    expect(r.alternatives.map((a) => [a.id, a.margin, a.drought, a.priceWins])).toEqual([
      ["corn-sorghum-wheat", 779.5065551568946, 607.5055862139491, 10],
      ["wheat-sorghum-fallow", 512.1689282423844, 456.13126957476084, 0],
    ]);
  });
  it("capped and shifted input", () => {
    const r = runScenarios(input({ waterCapMm: 200, deltaT: 1.5, precipFactor: 0.9 }));
    expect(r.current.margin).toBe(765.2675719447797);
    expect(r.current.drought).toBe(688.6044178612527);
    expect(r.current.water).toBe(151.673377727767);
    expect(r.current.if2022).toEqual({ margin: 240.3593370601136, typical: 828.0293471331461, season: 2029 });
    expect(r.alternatives.map((a) => [a.id, a.margin, a.drought])).toEqual([
      ["alfalfa3-corn-wheat", 1272.8481191115793, 1179.8542422056446],
      ["corn-sorghum-wheat", 801.2828499891712, 736.9651577033269],
    ]);
  });
  it('yearSet "all" equals no year set; weather reports the years used', () => {
    const a = runScenarios(input(DRY));
    expect(runScenarios(input({ ...DRY, yearSet: { id: "all" } }))).toEqual(a);
    expect(a.weather).toEqual({ yearSet: "all", from: 1981, to: 2025, count: 45 });
  });
});

describe("year sets (T7, T8)", () => {
  it("yearsOfSet is pure and picks the right harvest years", () => {
    const shuffled = [...ALL_YEARS].reverse();
    expect(yearsOfSet(shuffled, "all")).toEqual(ALL_YEARS);
    expect(yearsOfSet(shuffled, "climate-1981-2000")).toEqual(ALL_YEARS.filter((y) => y <= 2000));
    expect(yearsOfSet(shuffled, "last-15")).toEqual(ALL_YEARS.slice(-15));
    expect(yearsOfSet(shuffled, "trend-2030")).toEqual(ALL_YEARS.slice(-15));
    expect(shuffled[0]).toBe(2025); // input not mutated
  });

  it("each set is deterministic, differs from `all`, and reports its years", () => {
    const all = runScenarios(input(DRY));
    for (const [id, w] of [
      ["climate-1981-2000", { from: 1981, to: 2000, count: 20 }],
      ["last-15", { from: 2011, to: 2025, count: 15 }],
    ] as const) {
      const a = runScenarios(input({ ...DRY, yearSet: { id } }));
      expect(runScenarios(input({ ...DRY, yearSet: { id } }))).toEqual(a);
      expect(a.weather).toEqual({ yearSet: id, ...w });
      expect(a.current.margin).not.toBe(all.current.margin);
      for (const r of weatherRuns(input({ ...DRY, yearSet: { id } })))
        for (const y of r.years) expect(y >= w.from && y <= w.to).toBe(true);
    }
  });

  it("trend-2030 = last-15 years plus the shift, combined with the global sliders", () => {
    const shift = { deltaT: 1.2, precipFactor: 0.9 };
    const t = input({ ...DRY, yearSet: { id: "trend-2030", shift } });
    const a = runScenarios(t);
    expect(runScenarios(t)).toEqual(a);
    expect(a.weather).toEqual({ yearSet: "trend-2030", from: 2011, to: 2025, count: 15 });
    const noShift = runScenarios(input({ ...DRY, yearSet: { id: "trend-2030" } }));
    expect(a.current.margin).not.toBe(noShift.current.margin);
    expect(runScenarios({ ...t, deltaT: 0.5 }).current.margin).not.toBe(a.current.margin);
    expect(weatherRuns(t).every((r) => r.years.every((y) => y >= 2011))).toBe(true);
  });

  it("does not re-normalise yields: calibration stays on all years", () => {
    const one = [{ year: 2020, crop: "winter_wheat" }];
    expect(hindcastSeasons(input({ ...DRY, yearSet: { id: "last-15" } }), one)).toEqual(
      hindcastSeasons(input(DRY), one),
    );
  });

  it("refuses a set with fewer than 10 complete seasons", () => {
    const small = input({ ...DRY, weatherByYear: subset(1995, 2010), yearSet: { id: "climate-1981-2000" } });
    expect(() => runScenarios(small)).toThrow(YearSetTooSmallError);
    expect(() => weatherRuns(small)).toThrow(/at least 10/);
    const short = input({ ...DRY, weatherByYear: subset(2020, 2025), yearSet: { id: "last-15" } });
    expect(() => runScenarios(short)).toThrow(YearSetTooSmallError);
    // `all` still works with the same 16 years.
    expect(() => runScenarios(input({ ...DRY, weatherByYear: subset(1995, 2010) }))).not.toThrow();
  });
});

describe("if2022 per season (S-10.13)", () => {
  it("has 5 entries and the worst one equals if2022", () => {
    const r = runScenarios(input(DRY));
    for (const s of [r.current, ...r.alternatives]) {
      expect(s.if2022BySeason).toHaveLength(5);
      const k = s.if2022.season - 2026;
      expect(s.if2022BySeason[k]).toEqual({ margin: s.if2022.margin, typical: s.if2022.typical });
      const drops = s.if2022BySeason.map((x) => x!.typical - x!.margin);
      expect(drops[k]).toBe(Math.max(...drops));
    }
  });
  it("is null without 2022 in the history", () => {
    const w = new Map([...WEATHER].filter(([y]) => y !== 2022));
    const r = runScenarios(input({ ...DRY, weatherByYear: w }));
    expect(r.current.if2022BySeason).toEqual([null, null, null, null, null]);
    expect(Number.isNaN(r.current.if2022.margin)).toBe(true);
  });
});

describe("hindcast (S-10.08)", () => {
  const ratio = (crop: string, year: number, irrigated = true) =>
    simulateSeason(
      {
        site,
        crops: [{ crop, sowing: `${Number(sowing[crop as keyof typeof sowing].slice(0, 2)) >= 8 ? year - 1 : year}-${sowing[crop as keyof typeof sowing]}` }],
        irrigated,
        startDepletionMm: 0,
      },
      WEATHER.get(year)!,
    ).crops[0]!.yieldRatio;
  it("equals the calibration season for that year; relative = ratio / median", () => {
    const sorted = ALL_YEARS.map((y) => ratio("corn", y)).sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)]!;
    const out = hindcastSeasons(input(), [
      { year: 2022, crop: "corn" },
      { year: 2019, crop: "corn" },
    ]);
    expect(out.map((h) => h.year)).toEqual([2022, 2019]);
    for (const h of out) {
      expect(h.yieldRatio).toBe(ratio("corn", h.year));
      expect(h.relative).toBe(ratio("corn", h.year) / median);
    }
  });
  it("dryland 2022 is a worse year than the median", () => {
    const [h] = hindcastSeasons(input(DRY), [{ year: 2022, crop: "winter_wheat" }]);
    expect(h!.relative!).toBeLessThan(1);
  });
  it("unknown crop gives nulls with a caveat; adapted crops carry the caveat; missing weather gives null", () => {
    const adapted = Object.keys(CROPS).find((c) => CROPS[c]!.adapted)!;
    const out = hindcastSeasons(input(), [
      { year: 2020, crop: "dragonfruit" },
      { year: 2020, crop: adapted },
      { year: 1950, crop: "corn" },
    ]);
    expect(out[0]).toEqual({
      year: 2020,
      crop: "dragonfruit",
      yieldRatio: null,
      relative: null,
      caveats: ["no-simulator-parameters:dragonfruit"],
    });
    expect(out[1]!.caveats).toContain(`unverified-crop-parameters:${adapted}`);
    expect(out[2]).toMatchObject({ yieldRatio: null, relative: null, caveats: ["no-weather:1950"] });
  });
});

describe("retrospective (S-10.10)", () => {
  const seasons = [2018, 2019, 2020, 2021, 2022];
  const scenarios = [
    { id: "current", sequence: ["corn", "corn", "winter_wheat", "sorghum"] as Rotation["sequence"], position: 2 },
    { id: "corn-soy-wheat", sequence: ["corn", "soybean", "winter_wheat"] as Rotation["sequence"], position: 0 },
  ];
  it("totals equal the sum of seasons; deterministic; real weather, one run", () => {
    const r = retrospective(input(), { seasons, scenarios });
    expect(r.map((x) => x.id)).toEqual(["current", "corn-soy-wheat"]);
    for (const s of r) {
      expect(s.bySeason).toHaveLength(5);
      expect(s.unit).toBe("margin");
      expect(s.total).toBe(s.bySeason.reduce((a, b) => a + b, 0));
      expect(s.plan.map((p) => p.season)).toEqual(seasons);
      for (const v of s.bySeason) expect(Number.isFinite(v)).toBe(true);
    }
    expect(retrospective(input(), { seasons, scenarios })).toEqual(r);
    // Slider values never change real weather.
    expect(retrospective(input({ deltaT: 2 }), { seasons, scenarios })).toEqual(r);
  });
  it("agronomy-only mode returns relative yield", () => {
    for (const s of retrospective(input({ agronomyOnly: true }), { seasons, scenarios })) {
      expect(s.unit).toBe("relative-yield");
      for (const v of s.bySeason) expect(v).toBeGreaterThan(0);
    }
  });
  it("first season of a single-crop rotation matches the hindcast and the margin formula", () => {
    const [r] = retrospective(input({ irrigated: false, history: [] }), {
      seasons: [2020],
      scenarios: [{ id: "w", sequence: ["winter_wheat"], position: 0 }],
    });
    const [h] = hindcastSeasons(input({ irrigated: false }), [{ year: 2020, crop: "winter_wheat" }]);
    // Wheat after nothing: no rotation effect; tonnes = yieldRef * relative yield; margin = tonnes * price - cost.
    expect(r!.bySeason[0]).toBeCloseTo(5.5 * h!.relative! * 200 - 500, 6);
  });
  it("refuses non-consecutive seasons and years without weather", () => {
    expect(() => retrospective(input(), { seasons: [2018, 2020], scenarios })).toThrow(/consecutive/);
    expect(() => retrospective(input(), { seasons: [2030], scenarios })).toThrow(/no complete weather/);
  });
});
