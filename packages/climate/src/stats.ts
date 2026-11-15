/**
 * Trend statistics for the climate shift (EP-10, T4): Theil–Sen slope and the Mann–Kendall test with trend-free
 * pre-whitening. Pure and deterministic.
 *
 * References
 *  - Sen, P.K. (1968), J. Am. Stat. Assoc. 63:1379–1389 (slope = median of pairwise slopes).
 *  - Mann (1945), Kendall (1975) Rank Correlation Methods; Gilbert (1987) Statistical Methods for Environmental
 *    Pollution Monitoring, ch. 16 (normal approximation with continuity correction and tie correction).
 *  - Yue, Pilon, Phinney, Cavadias (2002), Hydrological Processes 16:1807–1829 (trend-free pre-whitening, TFPW).
 */

export function median(values: number[]): number {
  if (!values.length) return NaN;
  const s = [...values].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}

export function mean(values: number[]): number {
  return values.reduce((a, b) => a + b, 0) / values.length;
}

/** Standard normal CDF. */
export function normalCdf(z: number): number {
  return 0.5 * erfc(-z / Math.SQRT2);
}

/** Complementary error function, relative error below 1.2e-7 (Numerical Recipes erfcc, Chebyshev fit). */
function erfc(x: number): number {
  const z = Math.abs(x);
  const t = 1 / (1 + 0.5 * z);
  const poly = [
    -1.26551223, 1.00002368, 0.37409196, 0.09678418, -0.18628806, 0.27886807, -1.13520398, 1.48851587, -0.82215223,
    0.17087277,
  ].reduceRight((acc, c) => c + t * acc, 0);
  const r = t * Math.exp(-z * z + poly);
  return x >= 0 ? r : 2 - r;
}

/** Theil–Sen estimator: slope = median of (yj − yi)/(xj − xi) over pairs with xj ≠ xi; intercept = median(y − slope·x). */
export function theilSen(xs: number[], ys: number[]): { slope: number; intercept: number } | null {
  if (xs.length !== ys.length) throw new Error("theilSen: xs and ys differ in length");
  const slopes: number[] = [];
  for (let i = 0; i < xs.length; i++)
    for (let j = i + 1; j < xs.length; j++) {
      const dx = xs[j]! - xs[i]!;
      if (dx !== 0) slopes.push((ys[j]! - ys[i]!) / dx);
    }
  if (!slopes.length) return null;
  const slope = median(slopes);
  return { slope, intercept: median(ys.map((y, i) => y - slope * xs[i]!)) };
}

export interface MannKendallResult {
  n: number;
  /** Kendall's S: concordant minus discordant pairs. */
  s: number;
  /** Variance of S under H0 (tie-corrected). */
  varS: number;
  /** Normal score with continuity correction; null for the exact test. */
  z: number | null;
  /** Two-sided p-value; null when n < 4 (the test has no power there). */
  pValue: number | null;
  significant: boolean;
  method: "exact" | "normal" | "none";
}

/**
 * Distribution of the number of inversions of a random permutation of n items (Mahonian numbers), as counts.
 * Under H0 without ties S = n(n−1)/2 − 2·inversions.
 */
function inversionCounts(n: number): number[] {
  let row = [1];
  for (let m = 2; m <= n; m++) {
    const next = new Array<number>(row.length + m - 1).fill(0);
    row.forEach((c, k) => {
      for (let add = 0; add < m; add++) next[k + add]! += c;
    });
    row = next;
  }
  return row;
}

/**
 * Mann–Kendall test of a time-ordered series (two-sided).
 *  - n < 4: no test (p = null).
 *  - 4 ≤ n < 10 and no ties: exact p-value from the permutation distribution of S (Kendall 1975); the normal
 *    approximation is poor at that size.
 *  - otherwise (n ≥ 10, or ties present): normal approximation with continuity correction (Z = (S − sign S)/σ) and the
 *    tie correction Σ t(t−1)(2t+5) in the variance (Gilbert 1987, eq. 16.1–16.5).
 */
export function mannKendall(ys: number[], opts: { alpha?: number } = {}): MannKendallResult {
  const alpha = opts.alpha ?? 0.05;
  const n = ys.length;
  let s = 0;
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) s += Math.sign(ys[j]! - ys[i]!);
  const groups = new Map<number, number>();
  for (const y of ys) groups.set(y, (groups.get(y) ?? 0) + 1);
  let tieTerm = 0;
  let hasTies = false;
  for (const t of groups.values())
    if (t > 1) {
      hasTies = true;
      tieTerm += t * (t - 1) * (2 * t + 5);
    }
  const varS = (n * (n - 1) * (2 * n + 5) - tieTerm) / 18;
  if (n < 4) return { n, s, varS, z: null, pValue: null, significant: false, method: "none" };
  if (n < 10 && !hasTies) {
    const counts = inversionCounts(n);
    const total = counts.reduce((a, b) => a + b, 0);
    const maxS = (n * (n - 1)) / 2;
    let tail = 0;
    counts.forEach((c, inv) => {
      if (Math.abs(maxS - 2 * inv) >= Math.abs(s)) tail += c;
    });
    const pValue = Math.min(1, tail / total);
    return { n, s, varS, z: null, pValue, significant: pValue < alpha, method: "exact" };
  }
  const z = s === 0 || varS <= 0 ? 0 : (s - Math.sign(s)) / Math.sqrt(varS);
  const pValue = 2 * (1 - normalCdf(Math.abs(z)));
  return { n, s, varS, z, pValue, significant: pValue < alpha, method: "normal" };
}

/**
 * Lag-1 autocorrelation of a series, using only pairs whose x values (years) are consecutive, so a gap does not
 * pretend to be one step.
 */
export function lag1(xs: number[], ys: number[]): number | null {
  const m = mean(ys);
  let num = 0;
  let pairs = 0;
  for (let i = 1; i < ys.length; i++)
    if (xs[i]! - xs[i - 1]! === 1) {
      num += (ys[i]! - m) * (ys[i - 1]! - m);
      pairs++;
    }
  const den = ys.reduce((a, y) => a + (y - m) ** 2, 0);
  return pairs >= 3 && den > 0 ? num / den : null;
}

export interface TrendResult {
  /** Theil–Sen slope per x unit (per year when x is the year); null when fewer than 3 points. */
  slope: number | null;
  pValue: number | null;
  significant: boolean;
  /** Lag-1 autocorrelation of the detrended series and whether pre-whitening was applied. */
  lag1: number | null;
  prewhitened: boolean;
  n: number;
  method: MannKendallResult["method"];
}

/**
 * Trend of a series over years: Theil–Sen slope of the original data, Mann–Kendall p-value after trend-free
 * pre-whitening (Yue et al. 2002) when the lag-1 autocorrelation r1 of the detrended series is significant.
 *   r1 significant ⇔ r1 outside the 95 % limits (−1 ± 1.96·√(n−2))/(n−1) (Anderson 1942); only checked for n ≥ 10.
 *   TFPW: detrend with the Theil–Sen slope b, remove AR(1): y'_t = d_t − r1·d_{t−1}, add the trend back, test that.
 * Years must be ascending; gaps are allowed (the autocorrelation uses only consecutive years; the test runs on the
 * available values in order).
 */
export function trendTest(years: number[], values: number[], opts: { alpha?: number } = {}): TrendResult {
  const alpha = opts.alpha ?? 0.05;
  const n = values.length;
  const ts = n >= 3 ? theilSen(years, values) : null;
  if (!ts || n < 4)
    return { slope: ts?.slope ?? null, pValue: null, significant: false, lag1: null, prewhitened: false, n, method: "none" };
  let series = values;
  let r1: number | null = null;
  let prewhitened = false;
  if (n >= 10) {
    const detrended = values.map((v, i) => v - ts.slope * years[i]!);
    r1 = lag1(years, detrended);
    if (r1 !== null) {
      const lo = (-1 - 1.96 * Math.sqrt(n - 2)) / (n - 1);
      const hi = (-1 + 1.96 * Math.sqrt(n - 2)) / (n - 1);
      if (r1 < lo || r1 > hi) {
        prewhitened = true;
        series = values.map((_, i) => {
          if (i === 0 || years[i]! - years[i - 1]! !== 1) return detrended[i]! + ts.slope * years[i]!;
          return detrended[i]! - r1! * detrended[i - 1]! + ts.slope * years[i]!;
        });
      }
    }
  }
  // Conservative rule: pre-whitening can inflate false trends under strong autocorrelation (Bayazit & Önöz 2007), and
  // the plain test does so too in the other direction. A trend is called clear only when both tests agree: the larger
  // of the two p-values is reported.
  const plain = mannKendall(values, { alpha });
  const whitened = prewhitened ? mannKendall(series, { alpha }) : plain;
  const mk = (whitened.pValue ?? 1) >= (plain.pValue ?? 1) ? whitened : plain;
  return {
    slope: ts.slope,
    pValue: mk.pValue,
    significant: mk.significant,
    lag1: r1,
    prewhitened,
    n,
    method: mk.method,
  };
}
