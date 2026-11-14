import { createHash } from "node:crypto";
import type { PestModel } from "@terrasight/library";
import { evalNode, type Resolve } from "./kinds.js";
import type { Citation, ConfidenceLevel, EvalInputs, KeyNumber, RiskResult, Tier } from "./types.js";

const STEPS: ConfidenceLevel[] = ["low", "medium", "high"];
const FROM_TIER: Record<Tier, ConfidenceLevel> = { A: "high", B: "medium", C: "low" };
/** Windows beyond forecast day 5 cost a confidence step (RFC §10.3, §13). */
const RELIABLE_FORECAST_DAYS = 5;
/** Default action / scouting window when a model has no other deadline. */
const SCOUT_WITHIN_DAYS = 7;

/**
 * Confidence rule (RFC §10.3): start from the tier, drop one step per estimated key input,
 * cap pest and disease at medium until the field is scouted for that pest. A model never raises it.
 */
export function confidence(tier: Tier, estimatedInputs: number, capped: boolean): ConfidenceLevel {
  let i = STEPS.indexOf(FROM_TIER[tier]) - estimatedInputs;
  if (capped) i = Math.min(i, STEPS.indexOf("medium"));
  return STEPS[Math.max(0, i)]!;
}

/**
 * Threshold resolver: `{ ref }` → the field region's override, else the default — but only where the source says it
 * applies (`appliesTo` empty = everywhere). Otherwise null, so the model reports the threshold as missing (RFC §11.3).
 */
export function resolver(model: PestModel, regionId: string | null): Resolve {
  return (param) => {
    if (typeof param === "number") return param;
    const ref = (param as { ref?: string } | null)?.ref;
    const t = ref ? model.thresholds[ref] : undefined;
    if (!t) return null;
    if (regionId && t.regional && regionId in t.regional) return t.regional[regionId]!;
    const applies = t.source?.appliesTo ?? [];
    if (applies.length && (!regionId || !applies.includes(regionId))) return null;
    return t.value;
  };
}

/** Next forecast day with frost (min ≤ 0 °C), within the 10-day forecast. */
export function nextFrost(inputs: EvalInputs, asOf: string): string | null {
  return (
    inputs.weather.find((w) => w.origin === "forecast" && w.date > asOf && w.tminC !== null && w.tminC <= 0)
      ?.date ?? null
  );
}

const addDays = (iso: string, n: number) =>
  new Date(Date.parse(`${iso}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

/** Runs one pest model against an input snapshot (Tech Design §10.1). Pure: same inputs → same result. */
export function evaluate(model: PestModel, inputs: EvalInputs, asOf: string): RiskResult {
  const r = evalNode(model.tree, inputs, resolver(model, inputs.regionId), asOf);
  const estimated = [...r.estimated];
  if (r.forecastDayUsed && r.forecastDayUsed > RELIABLE_FORECAST_DAYS)
    estimated.push(`relies on forecast day ${r.forecastDayUsed}`);

  let deadline: string | null = null;
  if (model.planning) {
    deadline = inputs.planningDeadline;
    if (!deadline) r.unknowns.push("planning deadline not set");
  } else if (model.irreversible) {
    deadline = nextFrost(inputs, asOf);
    if (!deadline) r.unknowns.push("no frost in the forecast yet: deadline is the scouting window");
  }
  // A scouting window only for in-season items; a planning item without a date stays without one.
  if (!model.planning)
    deadline ??= r.level === "unknown" || r.level === "none" ? null : addDays(asOf, SCOUT_WITHIN_DAYS);

  const keyNumbers: KeyNumber[] = model.keyNumbers
    .map((id, i) => ({
      id,
      n: r.numbers[id],
      weight: Math.round((1 - i / model.keyNumbers.length) * 100) / 100,
    }))
    .filter((k) => k.n !== undefined)
    .map((k) => ({
      id: k.id,
      value: k.n!.value,
      ...(k.n!.unit ? { unit: k.n!.unit } : {}),
      weight: k.weight,
    }));

  const citations: Citation[] = Object.entries(model.thresholds).map(([key, t]) => ({
    threshold: key,
    value:
      inputs.regionId && t.regional?.[inputs.regionId] !== undefined
        ? t.regional[inputs.regionId]!
        : (t.value ?? NaN),
    unit: t.unit,
    title: t.source?.title ?? null,
    publisher: t.source?.publisher ?? null,
    url: t.source?.url ?? null,
    accessed: t.source?.accessed ?? null,
    type: t.source?.type ?? "extension",
    quote: t.source?.quote ?? null,
  }));

  return {
    pest: model.pest,
    level: r.level,
    deadline,
    irreversible: model.irreversible,
    planning: model.planning,
    keyNumbers,
    drivers: r.drivers,
    evidence: r.evidence,
    citations,
    unknowns: [...r.unknowns, ...estimated.map((e) => `Estimated: ${e}`)],
    confidence:
      r.level === "unknown"
        ? "low"
        : confidence(inputs.tier, estimated.length, !inputs.scouted.includes(model.pest)),
    tier: inputs.tier,
  };
}

/** Stable JSON (sorted keys) for hashing input snapshots. */
export function stableStringify(v: unknown): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v) ?? "null";
  if (Array.isArray(v)) return `[${v.map(stableStringify).join(",")}]`;
  const o = v as Record<string, unknown>;
  return `{${Object.keys(o)
    .filter((k) => o[k] !== undefined)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${stableStringify(o[k])}`)
    .join(",")}}`;
}

/** sha256 of the snapshot; stored in `input_snapshots` (S-03.05). */
export function snapshotHash(inputs: EvalInputs, asOf: string, modelVersion: string): string {
  return createHash("sha256").update(stableStringify({ inputs, asOf, modelVersion })).digest("hex");
}

/** Which models run for a field today: the stage window must match the season state (RFC §10.2). */
export function modelApplies(model: PestModel, state: { crop: string | null; stage: SeasonStage }): boolean {
  const w = model.stageWindow;
  if (!w) return true;
  if (state.crop !== w.crop) return false;
  return stageIn(state.stage, w.from, w.to);
}

export type SeasonStage =
  "previous_harvest" | "sowing" | "emergence" | "dormancy" | "green_up" | "heading" | "harvest" | "unknown";
const STAGE_ORDER: SeasonStage[] = [
  "previous_harvest",
  "sowing",
  "emergence",
  "dormancy",
  "green_up",
  "heading",
  "harvest",
];

function stageIn(stage: SeasonStage, from: string, to: string): boolean {
  const i = STAGE_ORDER.indexOf(stage);
  const a = STAGE_ORDER.indexOf(from as SeasonStage);
  const b = STAGE_ORDER.indexOf(to as SeasonStage);
  if (i < 0 || a < 0 || b < 0) return false;
  return i >= a && i <= b;
}

/**
 * Winter-wheat season state from the record and the date (northern plains; southern hemisphere shifts 6 months).
 * Dormancy begins with the first hard frosts; until the forecast/weather says so we stay in emergence.
 */
export function winterWheatStage(inputs: EvalInputs, asOf: string): SeasonStage {
  const { sowingDate, emergenceDate } = inputs.record;
  const month = Number(asOf.slice(5, 7));
  const m = inputs.southernHemisphere ? ((month + 5) % 12) + 1 : month;
  if (m >= 6 && m <= 8 && !sowingDate.value) return "previous_harvest";
  if (!sowingDate.value || sowingDate.value > asOf) return m >= 7 ? "previous_harvest" : "unknown";
  if (!emergenceDate.value || emergenceDate.value > asOf) return "sowing";
  if (m === 12 || m <= 2) return "dormancy";
  if (m >= 3 && m <= 4) return "green_up";
  if (m >= 5 && m <= 6) return "heading";
  return "emergence";
}
