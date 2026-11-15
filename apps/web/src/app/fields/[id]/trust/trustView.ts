import type { TrustFit, TrustReport, TrustYear } from "@terrasight/shared";

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

export type Verdict =
  | { kind: "flat" }
  | { kind: "fit"; reading: Exclude<FitReading, "flat">; mae: number | null; misses: number }
  | { kind: "estimate"; why: "derzhstat" | "nocounty"; ndvi: "close" | "loose" | "weak" | "few" | "none" };

/** The one-sentence verdict, chosen by fixed rules from the numbers (never from free text). */
export function readVerdict(report: TrustReport): Verdict {
  if (report.modelFlat === true) return { kind: "flat" };
  const c = report.vsCounty;
  if (report.actual.kind === "derzhstat" || c === null || c.n === 0) {
    const f = report.vsNdvi;
    const r = f && f.n > 0 ? readFit(f) : null;
    const ndvi = r === null ? "none" : r === "close" || r === "loose" || r === "few" ? r : "weak";
    return { kind: "estimate", why: report.actual.kind === "derzhstat" ? "derzhstat" : "nocounty", ndvi };
  }
  const reading = readFit(c) as Exclude<FitReading, "flat">;
  return { kind: "fit", reading, mae: c.mae, misses: report.years.filter((y) => y.miss).length };
}

/** Caveat codes the page can word; an unknown code is hidden, never printed. */
export const CAVEAT_CODES = [
  "practice-all-used",
  "state-level-yields",
  "unverified-crop-parameters",
  "single-year-crop",
  "second-crop-ignored",
  "no-simulator-parameters",
  "short-county-series",
  "estimated-crop-history",
] as const;
export type CaveatCode = (typeof CAVEAT_CODES)[number];

export function parseCaveat(raw: string): { code: CaveatCode; crop: string | null } | null {
  const i = raw.indexOf(":");
  const code = i < 0 ? raw : raw.slice(0, i);
  const crop = i < 0 ? null : raw.slice(i + 1);
  return (CAVEAT_CODES as readonly string[]).includes(code) ? { code: code as CaveatCode, crop: crop || null } : null;
}

const slug = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z]+/g, "_")
    .replace(/^_|_$/g, "");

/**
 * The source line from the API ("winter_wheat: Kansas (state level, irrigated); corn: Finney County, KS (…)") with
 * crop ids replaced by names and the bracket words translated. Place names stay as they come.
 */
export function cleanArea(area: string, crop: (id: string) => string, word: (key: string) => string | null): string {
  return area
    .split("; ")
    .map((part) => {
      const m = /^([a-z0-9_]+(?:, [a-z0-9_]+)*): (.+)$/.exec(part);
      const crops = m ? m[1]!.split(", ").map(crop).join(", ") : null;
      const rest = (m ? m[2]! : part).replace(/\(([^)]*)\)/g, (_all, inner: string) => {
        const words = inner.split(", ").map((w) => word(slug(w)) ?? w);
        return `(${words.join(", ")})`;
      });
      return crops ? `${crops}: ${rest}` : rest;
    })
    .join("; ");
}

/** Average of the non-null seasons (a sum of percentages means nothing). */
export function averageOf(values: Array<number | null>): number | null {
  const v = values.filter((x): x is number => x !== null);
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
}
