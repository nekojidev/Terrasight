import { Pcg32 } from "./random.js";

/**
 * Weather runs (RFC §7.3): 150 five-season sequences built by block bootstrap from real years, blocks of 2–3
 * consecutive years so multi-year droughts survive; plus "If 2022 repeats" with 2022 placed in each of the 5 years.
 * A "year" here is a season: 1 January–31 December in the north, 1 July–30 June in the south (labelled by the
 * harvest year), so one season's weather is never split across blocks.
 */
export interface WeatherRun {
  /** Source season (harvest year) used for each of the 5 simulated seasons. */
  years: number[];
  kind: "bootstrap" | "stress2022";
}

export const RUNS = 150;
export const SEASONS = 5;

export function bootstrapRuns(available: number[], rng: Pcg32, runs = RUNS, seasons = SEASONS): WeatherRun[] {
  const years = [...available].sort((a, b) => a - b);
  if (years.length < 3) throw new Error("need at least 3 full years of weather");
  const out: WeatherRun[] = [];
  for (let r = 0; r < runs; r++) {
    const seq: number[] = [];
    while (seq.length < seasons) {
      const len = 2 + rng.int(2); // 2 or 3 consecutive years
      const start = rng.int(years.length - len + 1);
      // Only consecutive calendar years form a block (skips gaps in the record).
      const block = [years[start]!];
      for (let k = 1; k < len && block.length < len; k++) {
        const y = years[start + k];
        if (y === undefined || y !== block.at(-1)! + 1) break;
        block.push(y);
      }
      seq.push(...block);
    }
    out.push({ years: seq.slice(0, seasons), kind: "bootstrap" });
  }
  return out;
}

/** "If 2022 repeats": the real stress year in each position, the other seasons from the median-ish base run. */
export function stressRuns(base: number[], stressYear = 2022, seasons = SEASONS): WeatherRun[] {
  return Array.from({ length: seasons }, (_, i) => ({
    years: base.map((y, k) => (k === i ? stressYear : y)).slice(0, seasons),
    kind: "stress2022" as const,
  }));
}
