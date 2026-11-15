import type { TrustFit, TrustYear } from "@terrasight/shared";

export type FitReading = "close" | "loose" | "none" | "opposite" | "few";

/** Fixed thresholds, also printed on the page: |r| >= 0.7 close, 0.4-0.7 loose, < 0.4 none; n < 5 too few years. */
export function readFit(fit: TrustFit): FitReading {
  if (fit.n < 5 || fit.r === null) return "few";
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
  | { kind: "opposite" };

const dir = (n: number) => Math.sign(Math.round(n));

/** Model vs county in 2022, by fixed rules: direction first, then the gap (within 10 points = close). */
export function readCase2022(y: TrustYear): Case2022Reading | null {
  if (y.model === null) return null;
  if (y.county === null) return { kind: "nocounty" };
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
