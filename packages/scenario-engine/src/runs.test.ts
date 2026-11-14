import { describe, expect, it } from "vitest";
import { priceScenarios, PRICE_BAND } from "./prices.js";
import { Pcg32, seedFrom } from "./random.js";
import { bootstrapRuns, stressRuns } from "./weather-runs.js";

describe("PCG32", () => {
  it("matches the reference pcg32-demo output for seed 42, stream 54", () => {
    const r = new Pcg32(42n, 54n);
    expect(Array.from({ length: 6 }, () => r.next().toString(16))).toEqual([
      "a15c02b7",
      "7b47f409",
      "ba1d3330",
      "83d2f293",
      "bfa4784b",
      "cbed606e",
    ]);
  });
  it("seeds from text deterministically", () => {
    expect(seedFrom("field:abc|inputs:1")).toBe(seedFrom("field:abc|inputs:1"));
    expect(seedFrom("a")).not.toBe(seedFrom("b"));
  });
});

const YEARS = Array.from({ length: 45 }, (_, i) => 1981 + i); // 1981–2025

describe("weather runs (RFC §7.3)", () => {
  it("builds 150 runs of exactly 5 seasons from 2–3-year blocks of consecutive real years", () => {
    const runs = bootstrapRuns(YEARS, new Pcg32(7n));
    expect(runs).toHaveLength(150);
    for (const r of runs) {
      expect(r.years).toHaveLength(5);
      for (const y of r.years) expect(YEARS).toContain(y);
    }
    // At least some consecutive pairs (blocks) appear in every run.
    const consecutive = runs.filter((r) => r.years.some((y, i) => i > 0 && y === r.years[i - 1]! + 1)).length;
    expect(consecutive).toBe(150);
  });
  it("keeps multi-year droughts together sometimes (2011–2012)", () => {
    const runs = bootstrapRuns(YEARS, new Pcg32(11n));
    expect(runs.some((r) => r.years.join(",").includes("2011,2012"))).toBe(true);
  });
  it("same seed → identical runs; another seed → different runs", () => {
    expect(bootstrapRuns(YEARS, new Pcg32(5n))).toEqual(bootstrapRuns(YEARS, new Pcg32(5n)));
    expect(bootstrapRuns(YEARS, new Pcg32(5n))).not.toEqual(bootstrapRuns(YEARS, new Pcg32(6n)));
  });
  it("places 2022 in each of the 5 seasons for the stress test", () => {
    const s = stressRuns([2015, 2016, 2017, 2018, 2019]);
    expect(s.map((r) => r.years.indexOf(2022))).toEqual([0, 1, 2, 3, 4]);
    expect(s.every((r) => r.kind === "stress2022")).toBe(true);
  });
});

describe("price scenarios (RFC §7.4)", () => {
  const crops = ["corn", "sorghum", "winter_wheat", "alfalfa", "soybean"];
  it("scenario 0 is base prices; all multipliers within ±20%", () => {
    const p = priceScenarios(crops, new Pcg32(3n));
    expect(p).toHaveLength(10);
    expect(Object.values(p[0]!)).toEqual([1, 1, 1, 1, 1]);
    for (const row of p)
      for (const m of Object.values(row)) expect(Math.abs(m - 1)).toBeLessThanOrEqual(PRICE_BAND + 1e-12);
  });
  it("grains move together more than hay does", () => {
    const p = priceScenarios(crops, new Pcg32(9n), 400);
    const corr = (a: string, b: string) => {
      const xs = p.slice(1).map((r) => r[a]! - 1);
      const ys = p.slice(1).map((r) => r[b]! - 1);
      const mx = xs.reduce((s, x) => s + x, 0) / xs.length;
      const my = ys.reduce((s, y) => s + y, 0) / ys.length;
      const cov = xs.reduce((s, x, i) => s + (x - mx) * (ys[i]! - my), 0);
      return (
        cov / Math.sqrt(xs.reduce((s, x) => s + (x - mx) ** 2, 0) * ys.reduce((s, y) => s + (y - my) ** 2, 0))
      );
    };
    expect(corr("corn", "sorghum")).toBeGreaterThan(0.6);
    expect(Math.abs(corr("corn", "alfalfa"))).toBeLessThan(0.3);
  });
  it("same seed → identical prices", () => {
    expect(priceScenarios(crops, new Pcg32(1n))).toEqual(priceScenarios(crops, new Pcg32(1n)));
  });
});
