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
import { rotationEffect } from "./rotation-effects.js";
import { Pcg32, seedFrom } from "./random.js";
import { bootstrapRuns, SEASONS, stressRuns, type WeatherRun } from "./weather-runs.js";

/** A library rotation (data/rotations.json v2) as the engine needs it. */
export interface Rotation {
  id: string;
  sequence: Array<string | { main: string; second: string }>;
  irrigation: "required" | "optional" | "none";
  minPrecipMm?: number;
  minSeasonDays?: number;
  maxSlopePct?: number;
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
  label?: "baseline" | "detected";
  plan: SeasonPlan[];
  /** Mean gross margin, $/ha/yr, over 5 seasons and all runs (base prices). */
  margin: number;
  /** Mean margin per season over runs, for the cumulative chart. */
  marginBySeason: number[];
  /** Mean irrigation, mm/yr. */
  water: number;
  /** Soil carbon change over the 5 seasons, t C/ha, and the mean relative erosion index. */
  carbonChange: number;
  erosion: number;
  /** Mean margin in the worst 10 % of runs (CVaR-10), $/ha/yr. */
  drought: number;
  /**
   * 2022 repeating in one season: that season's margin with 2022 weather vs the same season with ordinary weather
   * (the base run), for the season where it hurts most. NaN when 2022 is not in the weather history.
   */
  if2022: { margin: number; typical: number; season: number };
  /** In how many of the 10 price scenarios this option has the highest mean margin. */
  priceWins: number;
  capped: boolean;
  /** Extra yield loss from the cap: mean margin with cap − without, $/ha/yr (0 when no cap or not capped). */
  capLoss: number;
  pestPressure: Array<{ pest: string; seasons: number }>;
  relaxed: string[];
  /** Differences from the current rotation (current = 0). */
  delta: Record<Metric, number>;
  score?: number;
}

export interface EngineResult {
  current: ScenarioResult;
  alternatives: ScenarioResult[];
  candidates: number;
  relaxed: string[];
  noLibrary: boolean;
  bestFit: string | null;
}

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
    for (const c of res.crops) {
      const e = input.prices[c.crop];
      // Establishment year of a perennial stand yields about half (alfalfa).
      const est = c.crop === "alfalfa" ? (alfalfaYears++ === 0 ? 0.5 : 1) : 1;
      if (c.crop !== "alfalfa") alfalfaYears = 0;
      // Budget yields are typical yields: a median weather year on this field reproduces them (quick-pass calibration).
      const median = input.calibration?.[c.crop] ?? 1;
      // Rotation effect when the crop follows itself (corn after corn, sorghum after sorghum, wheat after wheat).
      const previous = k > 0 ? plan[k - 1]!.crops : (input.history ?? []).slice(-1);
      const rot = rotationEffect(c.crop, previous, input.irrigated);
      const tonnes = ((e?.yieldRef ?? 0) * c.yieldRatio * est * rot) / Math.max(0.2, median);
      parts.push({ crop: c.crop, tonnes });
      cost += e?.variableCost ?? 0;
      residue += tonnes * (CROPS[c.crop]?.residueC ?? 0.3);
    }
    if (!res.crops.length) {
      cost += input.prices.fallow?.variableCost ?? 0;
      alfalfaYears = 0;
    }
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
  // Stress run i puts 2022 into season i of the base run (runs[0]); compare that season with the base run's season i.
  const base = outcomes[0]?.marginBySeason ?? [];
  const drops = stress.map((r, i) => {
    const hit = simulateRun(input, plan, r, input.waterCapMm).marginBySeason[i]!;
    return { i, hit, typical: base[i]!, drop: base[i]! - hit };
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
    if2022: worstStress
      ? { margin: worstStress.hit, typical: worstStress.typical, season: plan[worstStress.i]!.season }
      : { margin: NaN, typical: NaN, season: plan[0]!.season },
    capped,
    capLoss,
    pestPressure: pestPressure(plan, history, input.pestModels),
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

/** Soil metric: carbon gain minus erosion, each scaled. */
function soilValue(s: Pick<ScenarioResult, "carbonChange" | "erosion">, maxErosion: number): number {
  return s.carbonChange - (maxErosion > 0 ? s.erosion / maxErosion : 0);
}

/** Re-ranks scenarios for priority weights (browser-side too, < 50 ms; RFC §7.5). */
export function rank(scenarios: ScenarioResult[], weights: Weights = EQUAL_WEIGHTS): ScenarioResult[] {
  const maxE = Math.max(...scenarios.map((s) => s.erosion), 0);
  const cols: Record<Metric, number[]> = {
    margin: scaled(
      scenarios.map((s) => s.margin),
      true,
    ),
    water: scaled(
      scenarios.map((s) => s.water),
      false,
    ),
    soil: scaled(
      scenarios.map((s) => soilValue(s, maxE)),
      true,
    ),
    drought: scaled(
      scenarios.map((s) => s.drought),
      true,
    ),
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
  const better = (s: ScenarioResult, m: Metric) =>
    m === "water"
      ? s.water < first.water
      : m === "soil"
        ? s.carbonChange - s.erosion > first.carbonChange - first.erosion
        : s[m] > first[m];
  const bestAt = (m: Metric) =>
    alts.reduce(
      (b, s) =>
        m === "water"
          ? s.water < b.water
            ? s
            : b
          : m === "soil"
            ? s.carbonChange - s.erosion > b.carbonChange - b.erosion
              ? s
              : b
            : s[m] > b[m]
              ? s
              : b,
      first,
    );
  const notBest = metrics.filter((m) => bestAt(m).id !== first.id);
  const second = alts
    .slice(1)
    .find((s) => notBest.some((m) => better(s, m)) && overlap(s.plan, first.plan) < 0.6);
  return second ? [first, second] : [first];
}

/** Quick FAO-56 pass (RFC §8.1): each crop alone in every weather year → median yield ratio for the calibration. */
function calibrate(input: EngineInput, years: number[], crops: string[]): Record<string, number> {
  const calibration: Record<string, number> = {};
  for (const crop of crops) {
    if (!CROPS[crop]) continue;
    const ratios = years
      .map((y) => {
        const days = input.weatherByYear.get(y) ?? [];
        const sow = sowingDate(input, crop, y);
        return (
          simulateSeason(
            {
              site: input.site,
              crops: [{ crop, sowing: sow }],
              irrigated: input.irrigated,
              startDepletionMm: 0,
            },
            days,
          ).crops[0]?.yieldRatio ?? 1
        );
      })
      .sort((a, b) => a - b);
    calibration[crop] = ratios[Math.floor(ratios.length / 2)] ?? 1;
  }
  return calibration;
}

const completeYears = (input: EngineInput) =>
  [...input.weatherByYear.keys()].filter((y) => (input.weatherByYear.get(y)?.length ?? 0) >= 360);

/** The block-bootstrap weather runs of the D5 pipeline (same seed as runScenarios, so the same 150 runs). */
export function weatherRuns(input: EngineInput): WeatherRun[] {
  const seed = seedFrom(
    `${input.fieldKey}|${input.firstSeason}|${input.irrigated}|${input.waterCapMm ?? ""}|${input.deltaT ?? 0}|${input.precipFactor ?? 1}`,
  );
  return bootstrapRuns(completeYears(input), new Pcg32(seed), input.runs);
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
        simulateRun(withCal, plan.slice(0, seasonIndex + 1), r, input.waterCapMm).revenueParts[seasonIndex]?.find(
          (x) => x.crop === crop,
        )?.tonnes,
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
  };
}

/** The D5 pipeline (RFC §8): filters (with relaxation) → Monte Carlo → price step → score → 2 different alternatives. */
export function runScenarios(engineInput: EngineInput, weights: Weights = EQUAL_WEIGHTS): EngineResult {
  let input = engineInput;
  const seed = seedFrom(
    `${input.fieldKey}|${input.firstSeason}|${input.irrigated}|${input.waterCapMm ?? ""}|${input.deltaT ?? 0}|${input.precipFactor ?? 1}`,
  );
  const rng = new Pcg32(seed);
  const years = [...input.weatherByYear.keys()].filter(
    (y) => (input.weatherByYear.get(y)?.length ?? 0) >= 360,
  );
  const runs = bootstrapRuns(years, rng, input.runs);
  const stress = years.includes(2022) ? stressRuns(runs[0]!.years) : [];
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
  let candidates = base.filter((r) => passes(r, new Set()));
  for (const step of ["precipitation", "slope"]) {
    if (candidates.length >= 2) break;
    relaxed.push(step);
    candidates = base.filter((r) => passes(r, new Set(relaxed)));
  }

  // Quick FAO-56 pass (RFC §8.1): each crop alone in every weather year → median yield ratio for the calibration.
  input = { ...input, calibration: calibrate(input, years, allCrops) };

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
  const finish = (s: (typeof everyone)[number], i: number, kind: ScenarioResult["kind"]): ScenarioResult => {
    const { byPrice: _byPrice, ...rest } = s;
    return {
      ...rest,
      kind,
      ...(kind === "current" ? { label: input.current.label } : {}),
      priceWins: 0, // set below, among the options actually shown
      relaxed: kind === "alternative" ? relaxed : [],
      delta: {
        margin: s.margin - cur.margin,
        water: s.water - cur.water,
        soil: s.carbonChange - cur.carbonChange - (s.erosion - cur.erosion),
        drought: s.drought - cur.drought,
      },
    };
  };
  const ranked = rank(
    [finish(cur, 0, "current"), ...alts.map((a, i) => finish(a, i + 1, "alternative"))],
    weights,
  );
  const current = ranked[0]!;
  const alternatives = pickTwo(ranked);
  // Price robustness among the shown options: in how many of the 10 price scenarios each has the highest margin.
  const byPriceOf = new Map(everyone.map((e) => [e.id, e.byPrice]));
  const shown = [current, ...alternatives];
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
  };
}

export { addDays };

/** Bumped whenever the engine or simulator changes results; part of the scenario cache key. */
export const ENGINE_VERSION = "2026-11-15.1";
