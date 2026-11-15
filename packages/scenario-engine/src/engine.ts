import {
  CROPS,
  et0Hargreaves,
  et0PenmanMonteith,
  dayOfYear,
  icbmStep,
  rusleIndex,
  simulateSeason,
  type IcbmState,
  type Site,
  type WeatherDay,
} from "@terrasight/simulator";
import { priceScenarios } from "./prices.js";
import { repeatPenaltyUnmodelled, rotationEffect } from "./rotation-effects.js";
import { Pcg32, seedFrom } from "./random.js";
import type { YearSetId } from "@terrasight/shared";
import { bootstrapRuns, SEASONS, stressRuns, type WeatherRun } from "./weather-runs.js";

/** A library rotation (data/rotations.json v2) as the engine needs it. */
export interface Rotation {
  id: string;
  sequence: Array<string | { main: string; second: string }>;
  irrigation: "required" | "optional" | "none";
  minPrecipMm?: number;
  minSeasonDays?: number;
  maxSlopePct?: number;
  /** Where the candidate comes from; absent = library. AI proposals are simulated exactly like library rotations. */
  source?: "library" | "ai";
}

export interface CropEconomics {
  /** $/t */
  price: number;
  /** $/ha */
  variableCost: number;
  /** t/ha without water stress (Ym). */
  yieldRef: number;
}

export interface EngineInput {
  fieldKey: string;
  site: Site;
  irrigated: boolean;
  /** First simulated season (harvest year), e.g. 2026. */
  firstSeason: number;
  southern?: boolean;
  /** Region's rotations. */
  rotations: Rotation[];
  /** The current rotation: a library id with its position (0-based index of next season), or a detected sequence. */
  current: {
    rotationId: string | null;
    sequence: Rotation["sequence"];
    position: number;
    label: "baseline" | "detected";
  };
  /** Daily weather by source harvest year: the season window (1 Sep year−1 → 31 Aug year in the north). */
  weatherByYear: Map<number, WeatherDay[]>;
  /** Typical sowing date per crop, "MM-DD" (autumn dates belong to the year before harvest). */
  sowing: Record<string, string>;
  prices: Record<string, CropEconomics>;
  /**
   * Agronomy-only mode: margin cannot be computed (a crop has no usable price), so no money is simulated or ranked.
   * Water, soil carbon, erosion, drought resilience (relative yield) and pests are still model results.
   */
  agronomyOnly?: boolean;
  /**
   * Reference yields (t/ha) of crops that have no full price entry (a verified library yield or the company's own).
   * Only the soil-carbon residue needs them; a crop without one makes the carbon change unknown (null), never guessed.
   */
  yieldRefs?: Record<string, number>;
  /** Carbon in the soil at the start, t C/ha (split 5 % young / 95 % old). */
  soilCarbon: number;
  waterCapMm?: number;
  deltaT?: number;
  precipFactor?: number;
  /** Verified rotation pest models: host crops and the repeat threshold (RFC §8.5). */
  pestModels?: Array<{ pest: string; hosts: string[]; repeatSeasons: number }>;
  /** Median FAO-33 yield ratio per crop on this field (quick FAO-56 pass); filled by runScenarios. */
  calibration?: Record<string, number>;
  /** Main crops of the latest past seasons, oldest first (for host repeats across the 2026 boundary). */
  history?: string[];
  runs?: number;
  /**
   * Weather years of the bootstrap (EP-10, S-10.05). Absent or "all" = every complete year, exactly as before.
   * Calibration and the precipitation filter always use all years; only the bootstrap draws from the set.
   * "trend-2030": the last-15 years with `shift` combined into deltaT / precipFactor (the API computes the shift).
   */
  yearSet?: { id: YearSetId; shift?: { deltaT: number; precipFactor: number } };
  /**
   * The rotations given are exactly the options to evaluate and show (year-set comparison, EP-10): no filters, no
   * relaxation, no picking of two, no extra AI options; every option comes back in `alternatives`, best score first.
   */
  fixedCandidates?: boolean;
  /**
   * Pumping cost, $ per ha per mm of irrigation. Pass it only when it is verified (prices.json irrigationCostPerMm);
   * without it the water cost is only inside the per-hectare budget and every irrigated result carries a caveat.
   */
  irrigationCostPerMm?: number;
}

export type Metric = "margin" | "water" | "soil" | "drought";
export type Weights = Record<Metric, number>;
export const EQUAL_WEIGHTS: Weights = { margin: 1, water: 1, soil: 1, drought: 1 };

export interface SeasonPlan {
  season: number;
  crops: string[];
}

export interface ScenarioResult {
  id: string;
  kind: "current" | "alternative";
  /** Alternatives only: "ai" for a sequence proposed by the assistant, else "library". */
  source?: "library" | "ai";
  label?: "baseline" | "detected";
  plan: SeasonPlan[];
  /** Mean gross margin per ha/yr, over 5 seasons and all runs (base prices), in the company's currency. Null in agronomy-only mode. */
  margin: number | null;
  /** Mean margin per season over runs, for the cumulative chart. Null in agronomy-only mode. */
  marginBySeason: number[] | null;
  /** Mean irrigation, mm/yr. */
  water: number;
  /**
   * Soil carbon change over the 5 seasons, t C/ha (null when a crop has no reference yield: residues depend on the
   * yield), and the mean relative erosion index.
   */
  carbonChange: number | null;
  erosion: number;
  /** Mean margin in the worst 10 % of runs (CVaR-10) per ha/yr. Null in agronomy-only mode. */
  drought: number | null;
  /**
   * Drought resilience without money: mean yield, relative to a typical year on this field (1 = typical), in the worst
   * 10 % of the weather runs. Always computed.
   */
  droughtYield: number;
  /**
   * 2022 repeating in one season: that season's margin with 2022 weather vs the same season with ordinary weather
   * (the base run), for the season where it hurts most. NaN when 2022 is not in the weather history.
   */
  if2022: { margin: number; typical: number; season: number };
  /**
   * "If 2022 repeats" per season: 2022 weather placed in season i (the hit season's margin) and the base run's margin
   * of that season (the base is the first bootstrap run). null when 2022 is not in the history or in agronomy-only mode.
   */
  if2022BySeason: Array<{ margin: number; typical: number } | null>;
  /** In how many of the 10 price scenarios this option has the highest mean margin. */
  priceWins: number;
  capped: boolean;
  /** Extra yield loss from the cap: mean margin with cap − without, $/ha/yr (0 when no cap or not capped). */
  capLoss: number;
  pestPressure: Array<{ pest: string; seasons: number }>;
  /**
   * Honest limits of this result, as stable codes: "unverified-crop-parameters:<crop>",
   * "irrigation-cost-in-budget", "repeat-penalty-not-modelled:<crop>".
   */
  caveats: string[];
  relaxed: string[];
  /**
   * Differences from the current rotation (current = 0). In agronomy-only mode margin is null and "drought" is the
   * difference in droughtYield (relative yield), not money.
   */
  delta: { margin: number | null; water: number; soil: number; drought: number };
  score?: number;
}

export interface EngineResult {
  current: ScenarioResult;
  alternatives: ScenarioResult[];
  candidates: number;
  relaxed: string[];
  noLibrary: boolean;
  bestFit: string | null;
  /** "agronomy" = no margin, no price scenarios; ranked on water, soil, drought resilience only. */
  mode: "money" | "agronomy";
  /** The weather years the bootstrap drew from (EP-10). */
  weather: { yearSet: YearSetId; from: number; to: number; count: number };
}

export const MIN_SET_YEARS = 10;
const LAST_YEARS = 15;

/** A year set has fewer than 10 complete seasons (EP-10, S-10.05). */
export class YearSetTooSmallError extends Error {
  constructor(
    readonly yearSet: YearSetId,
    readonly count: number,
  ) {
    super(`year set "${yearSet}" has ${count} complete seasons; at least ${MIN_SET_YEARS} are needed`);
    this.name = "YearSetTooSmallError";
  }
}

/** Harvest years of a year set, ascending. `all` returns every year given. Pure. */
export function yearsOfSet(allYears: number[], id: YearSetId = "all"): number[] {
  const sorted = [...allYears].sort((a, b) => a - b);
  if (id === "climate-1981-2000") return sorted.filter((y) => y <= 2000);
  if (id === "last-15" || id === "trend-2030") return sorted.slice(-LAST_YEARS);
  return sorted;
}

/** Most AI-proposed options in the result (on top of the 2 library picks). */
const MAX_AI_SHOWN = 2;
const MS_DAY = 86_400_000;
const addDays = (iso: string, n: number) =>
  new Date(Date.parse(`${iso}T00:00:00Z`) + n * MS_DAY).toISOString().slice(0, 10);
const cropsOf = (s: Rotation["sequence"][number]) =>
  typeof s === "string" ? (s === "fallow" ? [] : [s]) : [s.main, s.second].filter((c) => c !== "fallow");
const labelOf = (s: Rotation["sequence"][number]) => (typeof s === "string" ? [s] : [s.main, s.second]);

/** The 5 simulated seasons of a rotation: no padding; the current one continues from its position (RFC §7.7). */
export function planSeasons(seq: Rotation["sequence"], position: number, firstSeason: number): SeasonPlan[] {
  return Array.from({ length: SEASONS }, (_, k) => ({
    season: firstSeason + k,
    crops: labelOf(seq[(position + k) % seq.length]!),
  }));
}

/** Season window weather with ET₀ precomputed once per day, shifted to the simulated year so sowing dates line up. */
function shiftedWeather(src: WeatherDay[], fromYear: number, toYear: number): WeatherDay[] {
  const dy = toYear - fromYear;
  if (dy === 0) return src;
  return src.map((d) => {
    const y = Number(d.date.slice(0, 4)) + dy;
    const md = d.date.slice(4);
    return { ...d, date: md === "-02-29" ? `${y}-02-28` : `${y}${md}` };
  });
}

export function withEt0(days: WeatherDay[], site: Site): WeatherDay[] {
  return days.map((d) => {
    const doy = dayOfYear(d.date);
    const et0 =
      d.rs != null && d.u2 != null && d.rh != null
        ? et0PenmanMonteith({
            tmin: d.tmin,
            tmax: d.tmax,
            rhMean: d.rh,
            rs: d.rs,
            u2: d.u2,
            elevationM: site.elevationM,
            latDeg: site.latDeg,
            doy,
          })
        : et0Hargreaves(d.tmin, d.tmax, site.latDeg, doy);
    return { ...d, et0 };
  });
}

interface RunOutcome {
  marginBySeason: number[];
  /** yield t/ha and price-able revenue per crop per season, to re-price cheaply. */
  revenueParts: Array<Array<{ crop: string; tonnes: number }>>;
  costs: number[];
  irrigation: number;
  carbonChange: number;
  erosion: number;
  capped: boolean;
  /** Mean yield per season relative to a typical year on this field (1 = typical). */
  relYield: number[];
  /** Every crop had a reference yield, so the residue carbon is real. */
  yieldKnown: boolean;
}

function sowingDate(input: EngineInput, crop: string, season: number): string {
  const mmdd = input.sowing[crop] ?? "04-25";
  const autumn = Number(mmdd.slice(0, 2)) >= 8;
  return `${autumn ? season - 1 : season}-${mmdd}`;
}

/** One rotation through one weather run: 5 seasons, soil water and carbon carried over. */
function simulateRun(
  input: EngineInput,
  plan: SeasonPlan[],
  run: WeatherRun,
  capMm: number | undefined,
): RunOutcome {
  let depletion = 0;
  let carbon: IcbmState = { young: input.soilCarbon * 0.05, old: input.soilCarbon * 0.95 };
  const start = carbon.young + carbon.old;
  const out: RunOutcome = {
    marginBySeason: [],
    revenueParts: [],
    costs: [],
    irrigation: 0,
    carbonChange: 0,
    erosion: 0,
    capped: false,
    relYield: [],
    yieldKnown: true,
  };
  let alfalfaYears = 0;
  plan.forEach((p, k) => {
    const srcYear = run.years[k]!;
    const days = shiftedWeather(input.weatherByYear.get(srcYear) ?? [], srcYear, p.season);
    const crops = p.crops.filter((c) => c !== "fallow" && CROPS[c]);
    const res = simulateSeason(
      {
        site: input.site,
        crops: crops.map((c) => ({ crop: c, sowing: sowingDate(input, c, p.season) })),
        irrigated: input.irrigated,
        ...(capMm !== undefined ? { waterCapMm: capMm } : {}),
        startDepletionMm: depletion,
        ...(input.deltaT ? { deltaT: input.deltaT } : {}),
        ...(input.precipFactor ? { precipFactor: input.precipFactor } : {}),
      },
      days,
    );
    depletion = res.endDepletionMm;
    out.irrigation += res.irrigationMm;
    if (res.crops.some((c) => c.capped)) out.capped = true;
    const parts: Array<{ crop: string; tonnes: number }> = [];
    let cost = 0;
    let residue = 0;
    const rel: number[] = [];
    for (const c of res.crops) {
      const e = input.prices[c.crop];
      const yieldRef = e?.yieldRef ?? input.yieldRefs?.[c.crop];
      if (yieldRef == null) out.yieldKnown = false;
      // Establishment year of a perennial stand yields about half (alfalfa).
      const est = c.crop === "alfalfa" ? (alfalfaYears++ === 0 ? 0.5 : 1) : 1;
      if (c.crop !== "alfalfa") alfalfaYears = 0;
      // Budget yields are typical yields: a median weather year on this field reproduces them (quick-pass calibration).
      const median = input.calibration?.[c.crop] ?? 1;
      // Rotation effect when the crop follows itself (corn after corn, sorghum after sorghum, wheat after wheat).
      const previous = k > 0 ? plan[k - 1]!.crops : (input.history ?? []).slice(-1);
      const rot = rotationEffect(c.crop, previous, input.irrigated);
      rel.push((c.yieldRatio * rot) / Math.max(0.2, median));
      const tonnes = ((yieldRef ?? 0) * c.yieldRatio * est * rot) / Math.max(0.2, median);
      parts.push({ crop: c.crop, tonnes });
      cost += e?.variableCost ?? 0;
      residue += tonnes * (CROPS[c.crop]?.residueC ?? 0.3);
    }
    if (input.irrigationCostPerMm) cost += res.irrigationMm * input.irrigationCostPerMm;
    if (!res.crops.length) {
      cost += input.prices.fallow?.variableCost ?? 0;
      alfalfaYears = 0;
    }
    out.relYield.push(rel.length ? mean(rel) : 1);
    out.revenueParts.push(parts);
    out.costs.push(cost);
    out.marginBySeason.push(
      parts.reduce((s, x) => s + x.tonnes * (input.prices[x.crop]?.price ?? 0), 0) - cost,
    );
    carbon = icbmStep(carbon, residue);
    out.erosion += rusleIndex(res.precipMm, input.site.slopePct, res.meanC) / plan.length;
  });
  out.carbonChange = carbon.young + carbon.old - start;
  return out;
}

/** Caveat codes for a plan (see ScenarioResult.caveats). */
export function planCaveats(input: EngineInput, plan: SeasonPlan[], history: string[]): string[] {
  const out = new Set<string>();
  plan.forEach((p, k) => {
    const previous = k > 0 ? plan[k - 1]!.crops : history.slice(-1);
    for (const c of p.crops) {
      if (c === "fallow") continue;
      if (CROPS[c]?.adapted) out.add(`unverified-crop-parameters:${c}`);
      if (repeatPenaltyUnmodelled(c, previous)) out.add(`repeat-penalty-not-modelled:${c}`);
    }
  });
  if (input.irrigated && !input.irrigationCostPerMm) out.add("irrigation-cost-in-budget");
  return [...out].sort();
}

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

/** Pest pressure (RFC §8.5, not scored): seasons in which a host follows itself `repeatSeasons` times. */
export function pestPressure(plan: SeasonPlan[], history: string[], models: EngineInput["pestModels"] = []) {
  return models.map((m) => {
    const seq = [...history.map((c) => [c]), ...plan.map((p) => p.crops)];
    let seasons = 0;
    for (let k = history.length; k < seq.length; k++) {
      const host = seq[k]!.some((c) => m.hosts.includes(c));
      if (!host) continue;
      let run = 0;
      for (let j = k - 1; j >= 0 && seq[j]!.some((c) => m.hosts.includes(c)); j--) run++;
      if (run >= m.repeatSeasons) seasons++;
    }
    return { pest: m.pest, seasons };
  });
}

function evaluateRotation(
  input: EngineInput,
  id: string,
  plan: SeasonPlan[],
  runs: WeatherRun[],
  stress: WeatherRun[],
  prices: Array<Record<string, number>>,
  history: string[],
): Omit<ScenarioResult, "kind" | "delta" | "priceWins" | "relaxed"> & { byPrice: number[] } {
  const outcomes = runs.map((r) => simulateRun(input, plan, r, input.waterCapMm));
  const runMargins = outcomes.map((o) => mean(o.marginBySeason));
  const sorted = [...runMargins].sort((a, b) => a - b);
  const worst = sorted.slice(0, Math.max(1, Math.round(sorted.length * 0.1)));
  const runYields = outcomes.map((o) => mean(o.relYield)).sort((a, b) => a - b);
  const droughtYield = mean(runYields.slice(0, Math.max(1, Math.round(runYields.length * 0.1))));
  const carbonKnown = outcomes.every((o) => o.yieldKnown);
  if (input.agronomyOnly) {
    const caveats = planCaveats(input, plan, history);
    if (!carbonKnown) caveats.push("yield-reference-missing");
    return {
      id,
      plan,
      margin: null,
      marginBySeason: null,
      water: mean(outcomes.map((o) => o.irrigation)) / plan.length,
      carbonChange: carbonKnown ? mean(outcomes.map((o) => o.carbonChange)) : null,
      erosion: mean(outcomes.map((o) => o.erosion)),
      drought: null,
      droughtYield,
      if2022: { margin: NaN, typical: NaN, season: plan[0]!.season },
      if2022BySeason: plan.map(() => null),
      capped: outcomes.some((o) => o.capped),
      capLoss: 0,
      pestPressure: pestPressure(plan, history, input.pestModels),
      caveats: caveats.sort(),
      byPrice: [],
    };
  }
  // Stress run i puts 2022 into season i of the base run (runs[0]); compare that season with the base run's season i.
  const base = outcomes[0]?.marginBySeason ?? [];
  const drops = stress.map((r, i) => {
    const hit = simulateRun(input, plan, r, input.waterCapMm).marginBySeason[i]!;
    return { i, hit, typical: base[i]!, drop: base[i]! - hit };
  });
  // Per season (the base is the first bootstrap run): the hit season's margin and the base margin of that season.
  const if2022BySeason: ScenarioResult["if2022BySeason"] = plan.map((_, k) => {
    const d = drops[k];
    return d ? { margin: d.hit, typical: d.typical } : null;
  });
  const worstStress = drops.length ? drops.reduce((w, d) => (d.drop > w.drop ? d : w)) : null;
  // Price step: re-price the same yields under each of the 10 scenarios.
  const byPrice = prices.map((mult) =>
    mean(
      outcomes.map((o) =>
        mean(
          o.revenueParts.map(
            (parts, k) =>
              parts.reduce(
                (s, x) => s + x.tonnes * (input.prices[x.crop]?.price ?? 0) * (mult[x.crop] ?? 1),
                0,
              ) - o.costs[k]!,
          ),
        ),
      ),
    ),
  );
  let capLoss = 0;
  const capped = outcomes.some((o) => o.capped);
  if (capped && input.waterCapMm !== undefined) {
    const free = runs.slice(0, 30).map((r) => mean(simulateRun(input, plan, r, undefined).marginBySeason));
    capLoss = mean(runMargins.slice(0, 30)) - mean(free);
  }
  return {
    id,
    plan,
    margin: mean(runMargins),
    marginBySeason: plan.map((_, k) => mean(outcomes.map((o) => o.marginBySeason[k]!))),
    water: mean(outcomes.map((o) => o.irrigation)) / plan.length,
    carbonChange: mean(outcomes.map((o) => o.carbonChange)),
    erosion: mean(outcomes.map((o) => o.erosion)),
    drought: mean(worst),
    droughtYield,
    if2022: worstStress
      ? { margin: worstStress.hit, typical: worstStress.typical, season: plan[worstStress.i]!.season }
      : { margin: NaN, typical: NaN, season: plan[0]!.season },
    if2022BySeason,
    capped,
    capLoss,
    pestPressure: pestPressure(plan, history, input.pestModels),
    caveats: planCaveats(input, plan, history),
    byPrice,
  };
}

/** Scales a metric to 0–1 across candidates (1 = best). */
function scaled(values: number[], higherBetter: boolean): number[] {
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  if (hi - lo < 1e-9) return values.map(() => 0.5);
  return values.map((v) => (higherBetter ? (v - lo) / (hi - lo) : (hi - v) / (hi - lo)));
}

/** Soil metric: carbon gain minus erosion, each scaled. Carbon counts only when it is known for every option. */
function soilValue(
  s: Pick<ScenarioResult, "carbonChange" | "erosion">,
  maxErosion: number,
  useCarbon: boolean,
): number {
  return (useCarbon ? (s.carbonChange ?? 0) : 0) - (maxErosion > 0 ? s.erosion / maxErosion : 0);
}

/** Drought metric: money (CVaR-10) when margins exist, else the relative yield in the worst runs. */
const droughtValue = (s: Pick<ScenarioResult, "drought" | "droughtYield">) => s.drought ?? s.droughtYield;

/** Re-ranks scenarios for priority weights (browser-side too, < 50 ms; RFC §7.5). */
export function rank(scenarios: ScenarioResult[], weights: Weights = EQUAL_WEIGHTS): ScenarioResult[] {
  const maxE = Math.max(...scenarios.map((s) => s.erosion), 0);
  const useCarbon = scenarios.every((s) => s.carbonChange != null);
  const cols: Record<Metric, number[]> = {
    margin: scaled(
      scenarios.map((s) => s.margin ?? 0),
      true,
    ),
    water: scaled(
      scenarios.map((s) => s.water),
      false,
    ),
    soil: scaled(
      scenarios.map((s) => soilValue(s, maxE, useCarbon)),
      true,
    ),
    drought: scaled(scenarios.map(droughtValue), true),
  };
  return scenarios.map((s, i) => ({
    ...s,
    score: (Object.keys(cols) as Metric[]).reduce((acc, m) => acc + weights[m] * cols[m][i]!, 0),
  }));
}

/** Share of crop-years two plans have in common (position by position). */
export function overlap(a: SeasonPlan[], b: SeasonPlan[]): number {
  let same = 0;
  a.forEach((p, i) => {
    if (p.crops.join("+") === b[i]?.crops.join("+")) same++;
  });
  return same / a.length;
}

/** Alternative 1 = best score; alternative 2 = best of the rest that really differs (RFC §8.3). */
export function pickTwo(ranked: ScenarioResult[]): ScenarioResult[] {
  const alts = ranked.filter((s) => s.kind === "alternative").sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
  const first = alts[0];
  if (!first) return [];
  const metrics: Metric[] = ["margin", "water", "soil", "drought"];
  const useCarbon = ranked.every((s) => s.carbonChange != null);
  const soil = (s: ScenarioResult) => (useCarbon ? (s.carbonChange ?? 0) : 0) - s.erosion;
  const value = (s: ScenarioResult, m: Metric) =>
    m === "water" ? -s.water : m === "soil" ? soil(s) : m === "margin" ? (s.margin ?? 0) : droughtValue(s);
  const better = (s: ScenarioResult, m: Metric) => value(s, m) > value(first, m);
  const bestAt = (m: Metric) => alts.reduce((b, s) => (value(s, m) > value(b, m) ? s : b), first);
  const notBest = metrics.filter((m) => bestAt(m).id !== first.id);
  const second = alts
    .slice(1)
    .find((s) => notBest.some((m) => better(s, m)) && overlap(s.plan, first.plan) < 0.6);
  return second ? [first, second] : [first];
}

/** One crop alone in one real weather year, start depletion 0 (the calibration season). */
function calibrationRatio(input: EngineInput, crop: string, year: number, capMm?: number): number {
  return (
    simulateSeason(
      {
        site: input.site,
        crops: [{ crop, sowing: sowingDate(input, crop, year) }],
        irrigated: input.irrigated,
        ...(capMm !== undefined ? { waterCapMm: capMm } : {}),
        startDepletionMm: 0,
      },
      input.weatherByYear.get(year) ?? [],
    ).crops[0]?.yieldRatio ?? 1
  );
}

/** Quick FAO-56 pass (RFC §8.1): each crop alone in every weather year → median yield ratio for the calibration. */
function calibrate(input: EngineInput, years: number[], crops: string[]): Record<string, number> {
  const calibration: Record<string, number> = {};
  for (const crop of crops) {
    if (!CROPS[crop]) continue;
    const ratios = years.map((y) => calibrationRatio(input, crop, y)).sort((a, b) => a - b);
    calibration[crop] = ratios[Math.floor(ratios.length / 2)] ?? 1;
  }
  return calibration;
}

const completeYears = (input: EngineInput) =>
  [...input.weatherByYear.keys()].filter((y) => (input.weatherByYear.get(y)?.length ?? 0) >= 360);

/** Seed text: unchanged for "all" (same numbers as before year sets); the set id is appended otherwise. */
function seedText(input: EngineInput): string {
  const base = `${input.fieldKey}|${input.firstSeason}|${input.irrigated}|${input.waterCapMm ?? ""}|${input.deltaT ?? 0}|${input.precipFactor ?? 1}`;
  const id = input.yearSet?.id;
  return id && id !== "all" ? `${base}|${id}` : base;
}

/** The years the bootstrap draws from; a set under 10 seasons is refused (not for "all"). */
function bootstrapYears(input: EngineInput): number[] {
  const id = input.yearSet?.id ?? "all";
  const set = yearsOfSet(completeYears(input), id);
  if (id !== "all" && set.length < MIN_SET_YEARS) throw new YearSetTooSmallError(id, set.length);
  return set;
}

/** Input with the year set's weather shift combined into the global sliders (trend-2030). */
function withSetShift(input: EngineInput): EngineInput {
  const shift = input.yearSet?.id === "trend-2030" ? input.yearSet.shift : undefined;
  if (!shift) return input;
  return {
    ...input,
    deltaT: (input.deltaT ?? 0) + shift.deltaT,
    precipFactor: (input.precipFactor ?? 1) * shift.precipFactor,
  };
}

/** The block-bootstrap weather runs of the D5 pipeline (same seed as runScenarios, so the same 150 runs). */
export function weatherRuns(input: EngineInput): WeatherRun[] {
  const seed = seedFrom(seedText(input));
  return bootstrapRuns(bootstrapYears(input), new Pcg32(seed), input.runs);
}

export interface YieldRange {
  crop: string;
  season: number;
  p10: number;
  p50: number;
  p90: number;
  unit: "t/ha";
  runs: number;
  /** No verified pest-loss term exists: the range is weather and water only. */
  pestLossIncluded: false;
  /** Caveat codes that apply to this crop and season (see ScenarioResult.caveats). */
  caveats: string[];
}

/** Linear-interpolated percentile of a sorted array, q in [0, 1]. */
export function percentile(sorted: number[], q: number): number {
  if (!sorted.length) return NaN;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo]! + (sorted[hi]! - sorted[lo]!) * (pos - lo);
}

/**
 * Yield range P10 / P50 / P90 (t/ha) of the main crop of one season of a plan across the weather runs (FR-YF-1).
 * Same yields the scenarios price: FAO-33 water response, calibrated to the budget yield. No pest-loss term.
 * Null when the season has no priced crop.
 */
export function yieldRange(
  input: EngineInput,
  plan: SeasonPlan[],
  runs: WeatherRun[],
  seasonIndex = 0,
): YieldRange | null {
  const p = plan[seasonIndex];
  const crop = p?.crops.find((c) => c !== "fallow" && CROPS[c] && input.prices[c]);
  if (!p || !crop || !runs.length) return null;
  const calibration = input.calibration ?? calibrate(input, completeYears(input), [crop]);
  const withCal = { ...input, calibration };
  const ys = runs
    .map(
      (r) =>
        simulateRun(withCal, plan.slice(0, seasonIndex + 1), r, input.waterCapMm).revenueParts[
          seasonIndex
        ]?.find((x) => x.crop === crop)?.tonnes,
    )
    .filter((t): t is number => t != null && Number.isFinite(t))
    .sort((a, b) => a - b);
  if (!ys.length) return null;
  return {
    crop,
    season: p.season,
    p10: percentile(ys, 0.1),
    p50: percentile(ys, 0.5),
    p90: percentile(ys, 0.9),
    unit: "t/ha",
    runs: ys.length,
    pestLossIncluded: false,
    caveats: planCaveats(input, plan.slice(0, seasonIndex + 1), input.history ?? []).filter(
      (c) => !c.includes(":") || c.endsWith(`:${crop}`),
    ),
  };
}

/**
 * Which rotations can compete honestly. A crop without a verified price counts as $0 revenue and $0 cost, and a crop
 * the simulator has no parameters for is silently skipped (the season looks like fallow), so both keep a rotation
 * out; callers report the lists instead. Fallow is free and always fine.
 */
export function splitRotations(
  rotations: Rotation[],
  prices: EngineInput["prices"],
  requirePrices = true,
): { usable: Rotation[]; unpriced: string[]; unmodelled: string[] } {
  const unpriced = new Set<string>();
  const unmodelled = new Set<string>();
  const usable = rotations.filter((r) => {
    let ok = true;
    for (const c of r.sequence.flatMap(cropsOf)) {
      if (c === "fallow") continue;
      if (!CROPS[c]) {
        unmodelled.add(c);
        ok = false;
      } else if (requirePrices && !prices[c]) {
        unpriced.add(c);
        ok = false;
      }
    }
    return ok;
  });
  return { usable, unpriced: [...unpriced].sort(), unmodelled: [...unmodelled].sort() };
}

/** Crops of a sequence that cannot be evaluated (no price or no simulator parameters); fallow never counts. */
export function unevaluableCrops(sequence: Rotation["sequence"], prices: EngineInput["prices"]): string[] {
  return [...new Set(sequence.flatMap(cropsOf))].filter((c) => c !== "fallow" && (!CROPS[c] || !prices[c]));
}

/** The D5 pipeline (RFC §8): filters (with relaxation) → Monte Carlo → price step → score → 2 different alternatives. */
export function runScenarios(engineInput: EngineInput, weights: Weights = EQUAL_WEIGHTS): EngineResult {
  let input = engineInput;
  const seed = seedFrom(seedText(input));
  const rng = new Pcg32(seed);
  const years = [...input.weatherByYear.keys()].filter(
    (y) => (input.weatherByYear.get(y)?.length ?? 0) >= 360,
  );
  const setYears = bootstrapYears(input);
  const runs = bootstrapRuns(setYears, rng, input.runs);
  const stress = years.includes(2022) && !input.agronomyOnly ? stressRuns(runs[0]!.years) : [];
  const allCrops = [
    ...new Set(
      input.rotations
        .flatMap((r) => r.sequence.flatMap(cropsOf))
        .concat(input.current.sequence.flatMap(cropsOf)),
    ),
  ];
  const prices = priceScenarios(allCrops, rng);
  const history = input.history ?? [];
  const precipMedian = (() => {
    const totals = years
      .map((y) => (input.weatherByYear.get(y) ?? []).reduce((s, d) => s + d.precip, 0))
      .sort((a, b) => a - b);
    return totals[Math.floor(totals.length / 2)] ?? 0;
  })();

  // Filters, then relaxation in order precipitation → slope (RFC §8.4). Irrigation and region never relax.
  const base = input.rotations.filter(
    (r) => !(r.irrigation === "required" && !input.irrigated) && r.id !== input.current.rotationId,
  );
  const passes = (r: Rotation, skip: Set<string>) =>
    (skip.has("precipitation") || !r.minPrecipMm || precipMedian >= r.minPrecipMm) &&
    (skip.has("slope") || !r.maxSlopePct || input.site.slopePct <= r.maxSlopePct);
  const relaxed: string[] = [];
  let candidates = input.fixedCandidates ? base : base.filter((r) => passes(r, new Set()));
  for (const step of ["precipitation", "slope"]) {
    if (input.fixedCandidates || candidates.length >= 2) break;
    relaxed.push(step);
    candidates = base.filter((r) => passes(r, new Set(relaxed)));
  }

  // Quick FAO-56 pass (RFC §8.1): each crop alone in every weather year → median yield ratio for the calibration.
  input = { ...withSetShift(input), calibration: calibrate(input, years, allCrops) };

  const currentPlan = planSeasons(input.current.sequence, input.current.position, input.firstSeason);
  const cur = evaluateRotation(
    input,
    input.current.rotationId ?? "current",
    currentPlan,
    runs,
    stress,
    prices,
    history,
  );
  const alts = candidates.map((r) =>
    evaluateRotation(
      input,
      r.id,
      planSeasons(r.sequence, 0, input.firstSeason),
      runs,
      stress,
      prices,
      history,
    ),
  );
  const everyone = [cur, ...alts];
  const useCarbon = everyone.every((e) => e.carbonChange != null);
  const aiIds = new Set(input.rotations.filter((r) => r.source === "ai").map((r) => r.id));
  const finish = (s: (typeof everyone)[number], i: number, kind: ScenarioResult["kind"]): ScenarioResult => {
    const { byPrice: _byPrice, ...rest } = s;
    return {
      ...rest,
      kind,
      ...(kind === "current" ? { label: input.current.label } : {}),
      ...(kind === "alternative" ? { source: aiIds.has(s.id) ? ("ai" as const) : ("library" as const) } : {}),
      priceWins: 0, // set below, among the options actually shown
      relaxed: kind === "alternative" ? relaxed : [],
      delta: {
        margin: s.margin != null && cur.margin != null ? s.margin - cur.margin : null,
        water: s.water - cur.water,
        soil: (useCarbon ? (s.carbonChange ?? 0) - (cur.carbonChange ?? 0) : 0) - (s.erosion - cur.erosion),
        drought:
          s.drought != null && cur.drought != null
            ? s.drought - cur.drought
            : s.droughtYield - cur.droughtYield,
      },
    };
  };
  const ranked = rank(
    [finish(cur, 0, "current"), ...alts.map((a, i) => finish(a, i + 1, "alternative"))],
    weights,
  );
  const current = ranked[0]!;
  const alternatives = input.fixedCandidates
    ? ranked.filter((s) => s.kind === "alternative").sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
    : pickTwo(ranked);
  // The assistant's two best proposals are always shown (as extra options) so they can be judged on the numbers.
  const bestAi = ranked
    .filter((s) => !input.fixedCandidates && s.kind === "alternative" && aiIds.has(s.id) && !alternatives.some((a) => a.id === s.id))
    .sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
  const shownAi = alternatives.filter((a) => aiIds.has(a.id)).length;
  alternatives.push(...bestAi.slice(0, Math.max(0, MAX_AI_SHOWN - shownAi)));
  // Price robustness among the shown options: in how many of the 10 price scenarios each has the highest margin.
  const byPriceOf = new Map(everyone.map((e) => [e.id, e.byPrice]));
  const shown = [current, ...alternatives];
  if (!input.agronomyOnly)
    prices.forEach((_, p) => {
      const winner = shown.reduce((b, s) => (byPriceOf.get(s.id)![p]! > byPriceOf.get(b.id)![p]! ? s : b));
      winner.priceWins++;
    });
  const three = shown;
  const best = three.reduce((b, s) => ((s.score ?? 0) > (b.score ?? 0) ? s : b), current);
  return {
    current,
    alternatives,
    candidates: candidates.length,
    relaxed,
    noLibrary: input.rotations.length === 0,
    bestFit: best.id,
    mode: input.agronomyOnly ? "agronomy" : "money",
    weather: {
      yearSet: input.yearSet?.id ?? "all",
      from: setYears[0]!,
      to: setYears[setYears.length - 1]!,
      count: setYears.length,
    },
  };
}

/** Plan of `count` consecutive seasons from `first` (retrospective: the plan's seasons are the real years). */
function plannedFrom(seq: Rotation["sequence"], position: number, first: number, count: number): SeasonPlan[] {
  return Array.from({ length: count }, (_, k) => ({
    season: first + k,
    crops: labelOf(seq[(position + k) % seq.length]!),
  }));
}

export interface HindcastSeason {
  year: number;
  crop: string;
  /** Raw FAO-33 yield ratio of the crop alone in that year's real weather (no rotation effect, no calibration). */
  yieldRatio: number | null;
  /** yieldRatio / the crop's calibration median on this field (1 = a typical year). */
  relative: number | null;
  caveats: string[];
}

/** Calibration median per crop on ALL complete years (or the one already on the input). */
function medians(input: EngineInput, crops: string[]): Record<string, number> {
  const missing = crops.filter((c) => input.calibration?.[c] == null);
  return missing.length
    ? { ...calibrate(input, completeYears(input), missing), ...input.calibration }
    : (input.calibration ?? {});
}

/**
 * Hindcast (S-10.08, T11): each given harvest year simulated alone with that year's real weather, for the crop grown
 * that year. Start depletion 0 as in calibration; the water cap applies as in the engine; the global deltaT /
 * precipFactor sliders and year sets do not (real weather). No tuning, no smoothing.
 */
export function hindcastSeasons(
  input: EngineInput,
  plan: Array<{ year: number; crop: string }>,
): HindcastSeason[] {
  const cal = medians(
    input,
    plan.map((p) => p.crop).filter((c) => CROPS[c]),
  );
  return plan.map(({ year, crop }) => {
    const params = CROPS[crop];
    if (!params)
      return { year, crop, yieldRatio: null, relative: null, caveats: [`no-simulator-parameters:${crop}`] };
    const caveats: string[] = [];
    if (params.adapted) caveats.push(`unverified-crop-parameters:${crop}`);
    if ((input.weatherByYear.get(year)?.length ?? 0) < 360) {
      return { year, crop, yieldRatio: null, relative: null, caveats: [...caveats, `no-weather:${year}`] };
    }
    const yieldRatio = calibrationRatio(input, crop, year, input.waterCapMm);
    return { year, crop, yieldRatio, relative: yieldRatio / (cal[crop] ?? 1), caveats };
  });
}

export interface RetrospectiveScenario {
  id: string;
  sequence: Rotation["sequence"];
  /** 0-based index in the sequence of the first simulated season. */
  position: number;
}

export interface RetrospectiveResult {
  id: string;
  plan: SeasonPlan[];
  /** Margin per hectare per season (today's prices and costs), or the mean relative yield in agronomy-only mode. */
  bySeason: number[];
  /** Sum of bySeason. */
  total: number;
  unit: "margin" | "relative-yield";
  caveats: string[];
}

/**
 * Retrospective (S-10.10): each rotation over the REAL weather of the given consecutive harvest years: one
 * deterministic run, base prices, soil water carried from season to season. Uses the engine's season code (simulateRun).
 * Throws when a year has no complete weather.
 */
export function retrospective(
  engineInput: EngineInput,
  options: { seasons: number[]; scenarios: RetrospectiveScenario[] },
): RetrospectiveResult[] {
  const { seasons, scenarios } = options;
  if (!seasons.length) return [];
  seasons.forEach((y, k) => {
    if (k > 0 && y !== seasons[k - 1]! + 1) throw new Error("retrospective seasons must be consecutive years");
    if ((engineInput.weatherByYear.get(y)?.length ?? 0) < 360) throw new Error(`no complete weather for ${y}`);
  });
  const { deltaT: _d, precipFactor: _p, ...rest } = engineInput;
  const crops = [...new Set(scenarios.flatMap((s) => s.sequence.flatMap(cropsOf)))];
  const input: EngineInput = { ...rest, calibration: medians(engineInput, crops.filter((c) => CROPS[c])) };
  const run: WeatherRun = { years: seasons, kind: "bootstrap" };
  return scenarios.map((s) => {
    const plan = plannedFrom(s.sequence, s.position, seasons[0]!, seasons.length);
    const out = simulateRun(input, plan, run, input.waterCapMm);
    const agronomy = !!input.agronomyOnly;
    const bySeason = agronomy ? out.relYield : out.marginBySeason;
    return {
      id: s.id,
      plan,
      bySeason,
      total: bySeason.reduce((a, b) => a + b, 0),
      unit: agronomy ? "relative-yield" : "margin",
      caveats: planCaveats(input, plan, input.history ?? []),
    };
  });
}

export { addDays };

/** Bumped whenever the engine or simulator changes results; part of the scenario cache key. */
export const ENGINE_VERSION = "2026-11-18.1";
