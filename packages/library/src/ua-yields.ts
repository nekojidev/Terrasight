import { readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { normaliseAdminCode } from "./admin-aliases.js";

/**
 * Oblast-level yields for Ukraine (State Statistics Service, data.gov.ua), `data/ua-yields.json`.
 * Context only ("oblast average yield"): `verified` is always false, the file has no prices, and nothing computes
 * from it. Not part of `loadLibrary`, so a missing or broken file never stops the API.
 */
export const UaYieldsFile = z.object({
  version: z.number(),
  verified: z.literal(false),
  unit: z.literal("t/ha"),
  source: z.object({ publisher: z.string(), datasetUrl: z.string(), retrieved: z.string() }).passthrough(),
  notes: z.array(z.string()),
  crops: z.record(z.string(), z.object({ en: z.string(), uk: z.string() }).passthrough()),
  oblasts: z.record(
    z.string(),
    z.object({
      iso: z.string(),
      uk: z.string(),
      en: z.string(),
      yieldTHa: z.record(z.string(), z.record(z.string(), z.number())),
    }),
  ),
  national: z.record(z.string(), z.record(z.string(), z.number())),
});
export type UaYieldsFile = z.infer<typeof UaYieldsFile>;

export function loadUaYields(dataDir: string): UaYieldsFile | null {
  try {
    const parsed = UaYieldsFile.safeParse(JSON.parse(readFileSync(join(dataDir, "ua-yields.json"), "utf8")));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export interface OblastYield {
  crop: string;
  /** Mean of the last (up to) 5 published years, t/ha. */
  meanTHa: number;
  years: number[];
  latestYear: number;
  latestTHa: number;
}

export interface OblastYieldContext {
  oblast: { iso: string; uk: string; en: string };
  verified: false;
  source: string;
  sourceUrl: string;
  yields: OblastYield[];
}

/** Yields of the oblast that holds the field (ISO 3166-2 code such as "UA-53"); null outside Ukraine or when unlisted. */
export function oblastYields(
  file: UaYieldsFile,
  adminCode: string | null | undefined,
): OblastYieldContext | null {
  if (!adminCode) return null;
  const code = normaliseAdminCode(adminCode);
  const oblast = Object.values(file.oblasts).find((o) => o.iso === code);
  if (!oblast) return null;
  const yields: OblastYield[] = [];
  for (const crop of Object.keys(file.crops)) {
    const series = oblast.yieldTHa[crop];
    if (!series) continue;
    const years = Object.keys(series)
      .map(Number)
      .sort((a, b) => a - b)
      .slice(-5);
    if (!years.length) continue;
    const vals = years.map((y) => series[String(y)]!);
    const latestYear = years.at(-1)!;
    yields.push({
      crop,
      meanTHa: Math.round((vals.reduce((a, b) => a + b, 0) / vals.length) * 100) / 100,
      years,
      latestYear,
      latestTHa: series[String(latestYear)]!,
    });
  }
  return {
    oblast: { iso: oblast.iso, uk: oblast.uk, en: oblast.en },
    verified: false,
    source: `${file.source.publisher}, data.gov.ua`,
    sourceUrl: file.source.datasetUrl,
    yields,
  };
}
