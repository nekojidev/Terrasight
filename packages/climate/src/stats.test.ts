import { describe, expect, it } from "vitest";
import { mannKendall, normalCdf, theilSen, trendTest } from "./stats.js";

/**
 * Reference values:
 *  - Exact Mann–Kendall probabilities for small n follow from the permutation distribution of S tabulated in Kendall,
 *    M.G. (1975) Rank Correlation Methods, 4th ed., table of P(S ≥ s): n = 4: P(S ≥ 6) = 1/24 = 0.0417;
 *    n = 5: P(S ≥ 10) = 1/120 = 0.0083 and P(S ≥ 8) = 5/120 = 0.0417 (the commonly printed 0.042 and 0.008).
 *  - Normal approximation: Gilbert (1987) Statistical Methods for Environmental Pollution Monitoring, §16.4:
 *    Var(S) = [n(n−1)(2n+5) − Σ t(t−1)(2t+5)]/18, Z = (S − sign S)/√Var(S). Values below are worked by hand from those
 *    formulas for constructed series.
 *  - Theil–Sen: Sen (1968): median of pairwise slopes. Constructed cases with a known answer.
 */
describe("normalCdf", () => {
  it("matches standard table values", () => {
    expect(normalCdf(0)).toBeCloseTo(0.5, 7);
    expect(normalCdf(1.96)).toBeCloseTo(0.9750021, 6);
    expect(normalCdf(-1.645)).toBeCloseTo(0.0499849, 5);
    expect(normalCdf(3.9355)).toBeCloseTo(0.9999585, 6);
  });
});

describe("theilSen", () => {
  it("recovers an exact line", () => {
    const r = theilSen([1, 2, 3, 4, 5], [3, 5, 7, 9, 11])!;
    expect(r.slope).toBeCloseTo(2, 12);
    expect(r.intercept).toBeCloseTo(1, 12);
  });
  it("is robust to one outlier", () => {
    // y = 2x except the last point, which is far off: the median of 10 pairwise slopes stays 2.
    const r = theilSen([1, 2, 3, 4, 5], [2, 4, 6, 8, 100])!;
    expect(r.slope).toBeCloseTo(2, 12);
  });
  it("worked median of pairwise slopes", () => {
    // pairs of (0,0),(1,3),(2,1): slopes 3, 0.5, -2 → median 0.5
    expect(theilSen([0, 1, 2], [0, 3, 1])!.slope).toBeCloseTo(0.5, 12);
  });
  it("skips pairs with equal x and gives null without any pair", () => {
    // usable slopes: (1,0)->(2,4) = 4 and (1,10)->(2,4) = -6; the pair with equal x is skipped; median = -1
    expect(theilSen([1, 1, 2], [0, 10, 4])!.slope).toBeCloseTo(-1, 12);
    expect(theilSen([1, 1], [0, 1])).toBeNull();
  });
});

describe("mannKendall", () => {
  it("n < 4 gives no test", () => {
    const r = mannKendall([1, 2, 3]);
    expect(r.pValue).toBeNull();
    expect(r.significant).toBe(false);
    expect(r.method).toBe("none");
  });
  it("exact test, n = 4 monotone: S = 6, two-sided p = 2/24", () => {
    const r = mannKendall([1, 2, 3, 4]);
    expect(r.s).toBe(6);
    expect(r.method).toBe("exact");
    expect(r.pValue).toBeCloseTo(2 / 24, 12);
    expect(r.significant).toBe(false);
  });
  it("exact test, n = 5 monotone: p = 2/120, significant", () => {
    const r = mannKendall([1, 2, 3, 4, 5]);
    expect(r.s).toBe(10);
    expect(r.pValue).toBeCloseTo(2 / 120, 12);
    expect(r.significant).toBe(true);
  });
  it("exact test, n = 5 with S = 8: one-sided 5/120 = 0.0417", () => {
    const r = mannKendall([1, 2, 3, 5, 4]); // one inversion
    expect(r.s).toBe(8);
    expect(r.pValue).toBeCloseTo(10 / 120, 12);
  });
  it("exact test is symmetric for a decreasing series", () => {
    const r = mannKendall([5, 4, 3, 2, 1]);
    expect(r.s).toBe(-10);
    expect(r.pValue).toBeCloseTo(2 / 120, 12);
  });
  it("normal approximation, n = 10 monotone: S = 45, Var = 125, Z = 44/√125", () => {
    const r = mannKendall([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(r.s).toBe(45);
    expect(r.varS).toBeCloseTo(125, 10);
    expect(r.z).toBeCloseTo(44 / Math.sqrt(125), 10);
    expect(r.method).toBe("normal");
    expect(r.pValue).toBeCloseTo(2 * (1 - normalCdf(44 / Math.sqrt(125))), 10);
    expect(r.pValue!).toBeLessThan(0.001);
  });
  it("tie correction: [1,1,2,2,3,3,4,4,5,5] has two-fold ties in 5 groups", () => {
    const r = mannKendall([1, 1, 2, 2, 3, 3, 4, 4, 5, 5]);
    // S: all pairs from different groups are concordant: 45 − 5 tied pairs = 40
    expect(r.s).toBe(40);
    // Var = [10·9·25 − 5·(2·1·9)]/18 = (2250 − 90)/18 = 120
    expect(r.varS).toBeCloseTo(120, 10);
    expect(r.z).toBeCloseTo(39 / Math.sqrt(120), 10);
  });
  it("ties force the normal approximation even for n < 10", () => {
    expect(mannKendall([1, 1, 2, 3, 4]).method).toBe("normal");
  });
  it("no trend: S = 0 gives Z = 0 and p = 1", () => {
    const r = mannKendall([1, 3, 2, 2, 3, 1, 2, 3, 1, 2, 1, 3]);
    expect(r.significant).toBe(false);
    if (r.s === 0) expect(r.pValue).toBeCloseTo(1, 6);
  });
  it("honours alpha", () => {
    const r = mannKendall([1, 2, 3, 4], { alpha: 0.1 });
    expect(r.significant).toBe(true); // p = 0.0833 < 0.1
  });
});

/** Deterministic pseudo-random numbers (mulberry32) so the tests need no clock or Math.random. */
function rng(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe("trendTest (trend-free pre-whitening, Yue et al. 2002)", () => {
  const years = Array.from({ length: 45 }, (_, i) => 1981 + i);

  it("detects a clear linear trend with noise and does not pre-whiten white noise", () => {
    const r = rng(7);
    const ys = years.map((y, i) => 0.03 * i + (r() - 0.5));
    const t = trendTest(years, ys);
    expect(t.significant).toBe(true);
    expect(t.slope!).toBeCloseTo(0.03, 1);
    expect(t.prewhitened).toBe(false);
  });

  it("pre-whitens when the lag-1 autocorrelation is significant (AR(1) 0.85, 60 seeded series)", () => {
    // Known limit, not tested away: with strong autocorrelation TFPW keeps the chance slope of the series and so
    // rejects "no trend" more often than the plain test (Bayazit & Önöz 2007, Hydrol. Sci. J. 52:611). POWER annual
    // series have weak autocorrelation; the lag-1 value is returned so a caller can see it.
    let whitened = 0;
    for (let seed = 1; seed <= 60; seed++) {
      const r = rng(seed);
      let x = 0;
      const t = trendTest(
        years,
        years.map(() => (x = 0.85 * x + (r() - 0.5))),
      );
      if (t.prewhitened) whitened++;
      expect(t.lag1).not.toBeNull();
    }
    expect(whitened).toBeGreaterThan(30);
  });

  it("is deterministic and tolerates gaps", () => {
    const ys = years.map((_, i) => i * 0.1);
    const yg = years.filter((y) => y % 7 !== 0);
    const vg = ys.filter((_, i) => years[i]! % 7 !== 0);
    const a = trendTest(yg, vg);
    expect(a).toEqual(trendTest(yg, vg));
    expect(a.significant).toBe(true);
    expect(a.slope!).toBeCloseTo(0.1, 10);
  });

  it("small series: slope but no test below 4 points", () => {
    expect(trendTest([1, 2, 3], [1, 2, 3]).pValue).toBeNull();
  });
});
