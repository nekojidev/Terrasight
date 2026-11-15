import type { TrustFit, TrustYear } from "@terrasight/shared";

export type FitReading = "close" | "loose" | "none" | "opposite" | "few" | "flat";

/** Fixed thresholds, also printed on the page: |r| >= 0.7 close, 0.4-0.7 loose, < 0.4 none; n < 5 too few years. */
export function readFit(fit: TrustFit, modelFlat = false): FitReading {
  if (fit.n < 5) return "few";
  // r is undefined because the model never varies (not because there are too few years).
  if (fit.r === null) return modelFlat ? "flat" : "few";
  if (fit.r <= -0.4) return "opposite";
  const a = Math.abs(fit.r);
  if (a >= 0.7) return "close";
  if (a >= 0.4) return "loose";
  return "none";
}

export type Case2022Reading =
  | { kind: "nocounty" }
  | { kind: "same"; gap: number; close: boolean }
  | { kind: "flat"; gap: number }
  | { kind: "modelflat"; county: number }
  | { kind: "opposite" };

const dir = (n: number) => Math.sign(Math.round(n));

/** Model vs county in 2022, by fixed rules: direction first, then the gap (within 10 points = close). */
export function readCase2022(y: TrustYear, modelFlat = false): Case2022Reading | null {
  if (y.model === null) return null;
  if (y.county === null) return { kind: "nocounty" };
  // A model that never varies has no direction: never "close" or "same direction".
  if (modelFlat) return { kind: "modelflat", county: y.county };
  const a = dir(y.model);
  const b = dir(y.county);
  const gap = Math.abs(y.model - y.county);
  if (a === 0 || b === 0) return { kind: "flat", gap };
  if (a !== b) return { kind: "opposite" };
  return { kind: "same", gap, close: gap <= 10 };
}

/** Direction of the satellite greenness against the model. */
export function readNdvi(y: TrustYear): "same" | "opposite" | "flat" | null {
  if (y.model === null || y.ndvi === null) return null;
  const a = dir(y.model);
  const b = dir(y.ndvi);
  if (a === 0 || b === 0) return "flat";
  return a === b ? "same" : "opposite";
}

/** The example for the flat-model statement: the 2022 row when it has a county value, else the largest |county|. */
export function flatExample(years: TrustYear[]): { year: number; county: number } | null {
  const withCounty = years.filter((y): y is TrustYear & { county: number } => y.county !== null);
  const y2022 = withCounty.find((y) => y.year === 2022);
  if (y2022) return { year: 2022, county: y2022.county };
  let best: (TrustYear & { county: number }) | null = null;
  for (const y of withCounty) if (!best || Math.abs(y.county) > Math.abs(best.county)) best = y;
  return best ? { year: best.year, county: best.county } : null;
}
