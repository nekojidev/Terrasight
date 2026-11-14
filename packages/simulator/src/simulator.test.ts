import { describe, expect, it } from "vitest";
import { CROPS, kcOnDay, seasonLength } from "./crops.js";
import { dayOfYear, et0Hargreaves, et0PenmanMonteith, extraterrestrialRadiation } from "./et0.js";
import { simulateSeason, type Site, type WeatherDay } from "./season.js";
import {
  curveNumber,
  erosivity,
  icbmSteadyState,
  icbmStep,
  lsFactor,
  rusleIndex,
  scsRunoff,
} from "./soil.js";

describe("FAO-56 worked examples", () => {
  it("Example 8: Ra on 3 September at 20° S is 32.2 MJ m⁻² day⁻¹", () => {
    expect(dayOfYear("2026-09-03")).toBe(246);
    expect(extraterrestrialRadiation(-20, 246)).toBeCloseTo(32.2, 1);
  });

  it("Example 18: ET₀ for Brussels on 6 July is 3.9 mm/day", () => {
    const et0 = et0PenmanMonteith({
      tmin: 12.3,
      tmax: 21.5,
      rhMin: 63,
      rhMax: 84,
      rs: 22.07,
      u2: 2.078,
      elevationM: 100,
      latDeg: 50.8,
      doy: 187,
    });
    expect(et0).toBeCloseTo(3.9, 1);
  });

  it("Hargreaves gives the same order of magnitude in summer", () => {
    expect(et0Hargreaves(12.3, 21.5, 50.8, 187)).toBeGreaterThan(3);
    expect(et0Hargreaves(12.3, 21.5, 50.8, 187)).toBeLessThan(5.5);
  });

  it("Kc follows the FAO-56 curve (corn)", () => {
    const corn = CROPS.corn!;
    expect(kcOnDay(corn, 0)).toBe(0.3);
    expect(kcOnDay(corn, 30 + 20)).toBeCloseTo(0.75, 5); // half-way through development
    expect(kcOnDay(corn, 80)).toBe(1.2);
    expect(kcOnDay(corn, seasonLength(corn) - 1)).toBeCloseTo(0.62, 2);
  });
});

describe("SCS-CN runoff (USDA TR-55)", () => {
  it("CN 75 with 5 in of rain gives 2.45 in of runoff (TR-55 Eq. 2-3)", () => {
    expect(scsRunoff(127, 75) / 25.4).toBeCloseTo(2.45, 2);
  });
  it("no runoff below the initial abstraction; CN by cover and soil group", () => {
    expect(scsRunoff(10, 80)).toBe(0);
    expect(scsRunoff(50, 80)).toBeCloseTo(13.8, 1);
    expect(curveNumber("row", "B")).toBe(78);
    expect(curveNumber("fallow", "D")).toBe(94);
  });
});

describe("relative RUSLE index", () => {
  it("grows with rain, slope and bare soil", () => {
    expect(erosivity(500)).toBeCloseTo(0.0483 * 500 ** 1.61, 6);
    expect(lsFactor(4)).toBeGreaterThan(lsFactor(1));
    expect(rusleIndex(500, 2, 0.45)).toBeGreaterThan(rusleIndex(500, 2, 0.02));
  });
});

describe("ICBM soil carbon", () => {
  it("converges to the closed-form steady state", () => {
    let s = { young: 0, old: 30 };
    for (let y = 0; y < 3000; y++) s = icbmStep(s, 1.5);
    const ss = icbmSteadyState(1.5);
    expect(s.young).toBeCloseTo(ss.young, 3);
    expect(s.old / ss.old).toBeGreaterThan(0.97);
    expect(s.old / ss.old).toBeLessThan(1.03);
  });
  it("more residue builds more carbon", () => {
    const run = (i: number) =>
      Array.from({ length: 5 }).reduce<{ young: number; old: number }>((st) => icbmStep(st, i), {
        young: 1,
        old: 40,
      });
    expect(run(3).old + run(3).young).toBeGreaterThan(run(0.5).old + run(0.5).young);
  });
});

// A dry-ish Great Plains summer: constant weather keeps the tests readable.
const site: Site = { latDeg: 38.1, elevationM: 900, awsMmPerM: 180, hydGroup: "B", slopePct: 1 };
function weather(from: string, days: number, precip: (d: number) => number, t = 25): WeatherDay[] {
  return Array.from({ length: days }, (_, i) => ({
    date: new Date(Date.parse(`${from}T00:00:00Z`) + i * 86_400_000).toISOString().slice(0, 10),
    tmin: t - 7,
    tmax: t + 7,
    precip: precip(i),
    rh: 50,
    rs: 24,
    u2: 2,
  }));
}

describe("FAO-56 daily water balance and FAO-33 yield", () => {
  const corn = { crop: "corn", sowing: "2026-04-25" };

  it("closes the water balance: ΣETa = Σ(P − RO) + ΣI − ΣDP + (Dr_end − Dr_start)", () => {
    const w = weather("2026-04-25", 365, (d) => (d % 9 === 0 ? 25 : 0));
    for (const irrigated of [false, true]) {
      const r = simulateSeason({ site, crops: [corn], irrigated, startDepletionMm: 20 }, w);
      const closure = r.precipMm - r.runoffMm + r.irrigationMm - r.drainageMm + (r.endDepletionMm - 20);
      expect(r.etaTotalMm).toBeCloseTo(closure, 6);
      expect(r.runoffMm).toBeGreaterThan(0);
    }
  });

  it("dryland corn in a dry year loses yield; irrigated corn keeps it", () => {
    const dry = weather("2026-04-25", 200, (d) => (d % 20 === 0 ? 10 : 0));
    const dryland = simulateSeason({ site, crops: [corn], irrigated: false, startDepletionMm: 0 }, dry);
    const irrigated = simulateSeason({ site, crops: [corn], irrigated: true, startDepletionMm: 0 }, dry);
    expect(dryland.crops[0]!.yieldRatio).toBeLessThan(0.6);
    expect(irrigated.crops[0]!.yieldRatio).toBeGreaterThan(0.97);
    expect(irrigated.irrigationMm).toBeGreaterThan(300);
    // FAO-33: 1 − Ya/Ym = Ky (1 − ETa/ETc)
    const c = dryland.crops[0]!;
    expect(1 - c.yieldRatio).toBeCloseTo(CROPS.corn!.ky * (1 - c.etaMm / c.etcMm), 6);
  });

  it("a water cap limits irrigation and the yield follows Ky (deficit irrigation, RFC §7.6)", () => {
    const dry = weather("2026-04-25", 200, () => 0);
    const free = simulateSeason({ site, crops: [corn], irrigated: true, startDepletionMm: 0 }, dry);
    const capped = simulateSeason(
      { site, crops: [corn], irrigated: true, waterCapMm: 250, startDepletionMm: 0 },
      dry,
    );
    expect(capped.irrigationMm).toBeLessThanOrEqual(250 + 1e-9);
    expect(capped.crops[0]!.capped).toBe(true);
    expect(capped.crops[0]!.uncappedIrrigationMm).toBeGreaterThan(250);
    expect(capped.crops[0]!.yieldRatio).toBeLessThan(free.crops[0]!.yieldRatio);
  });

  it("double cropping runs both crops on their own calendars and carries soil water over (RFC §7.8)", () => {
    const w = weather("2025-10-01", 365, (d) => (d % 10 === 0 ? 15 : 0), 18);
    const r = simulateSeason(
      {
        site,
        crops: [
          { crop: "winter_wheat", sowing: "2025-10-01" },
          { crop: "soybean", sowing: "2026-06-26" },
        ],
        irrigated: false,
        startDepletionMm: 30,
      },
      w,
    );
    expect(r.crops.map((c) => c.crop)).toEqual(["winter_wheat", "soybean"]);
    expect(r.crops[0]!.harvest <= r.crops[1]!.sowing).toBe(true);
    expect(r.crops[1]!.etcMm).toBeGreaterThan(0);
    const alone = simulateSeason(
      { site, crops: [{ crop: "soybean", sowing: "2026-06-26" }], irrigated: false, startDepletionMm: 30 },
      w,
    );
    // After wheat used the spring water, the second crop starts drier than soybean alone after a bare spring.
    expect(r.crops[1]!.yieldRatio).toBeLessThanOrEqual(alone.crops[0]!.yieldRatio + 1e-9);
  });

  it("climate sliders: warmer and drier lowers dryland yield", () => {
    const w = weather("2026-04-25", 200, (d) => (d % 7 === 0 ? 18 : 0));
    const base = simulateSeason({ site, crops: [corn], irrigated: false, startDepletionMm: 0 }, w);
    const hot = simulateSeason(
      { site, crops: [corn], irrigated: false, startDepletionMm: 0, deltaT: 2, precipFactor: 0.8 },
      w,
    );
    expect(hot.crops[0]!.yieldRatio).toBeLessThan(base.crops[0]!.yieldRatio);
  });

  it("a fallow season is all bare days with a high C factor", () => {
    const w = weather("2026-01-01", 365, () => 1);
    const r = simulateSeason({ site, crops: [], irrigated: false, startDepletionMm: 0 }, w);
    expect(r.bareDays).toBe(365);
    expect(r.meanC).toBeCloseTo(0.45, 5);
  });
});
