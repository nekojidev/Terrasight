import type { EngineResult } from "@terrasight/scenario-engine";
import type { FarmStress, FarmStressField, FarmStressSkip } from "@terrasight/shared";

export const STRESS_YEAR = 2022;

/** What the farm stress needs of one field. */
export interface StressFieldInput {
  fieldId: string;
  name: string;
  areaHa: number;
}

export type StressFieldOutcome =
  | { kind: "skip"; reason: FarmStressSkip }
  | { kind: "run"; result: EngineResult; currency: string; runId?: string };

/**
 * Loss of one scenario when 2022 weather repeats: (typical − margin) per hectare, averaged over the five planned
 * seasons the weather could fall in. One season alone would mostly measure what happens to be planted that season
 * (a fallow first season cannot lose anything), not how the plan stands up to such a year. Null without 2022 data.
 */
function lossPerHa(result: EngineResult, id: string): { loss: number; typical: number } | null {
  const s = [result.current, ...result.alternatives].find((x) => x.id === id);
  const hits = (s?.if2022BySeason ?? []).filter(
    (h): h is { margin: number; typical: number } => !!h && Number.isFinite(h.margin) && Number.isFinite(h.typical),
  );
  if (!hits.length) return null;
  const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
  return { loss: mean(hits.map((h) => h.typical - h.margin)), typical: mean(hits.map((h) => h.typical)) };
}

/**
 * Farm stress test (T14, revised): 2022 weather in one of the five planned seasons of every counted field; loss =
 * typical margin − margin of the hit season, averaged over the five placements, times the area, summed for the current
 * plan and for the recommended option (equal priorities).
 * Pure: the caller supplies each field's stored default run (or the reason there is none).
 */
export function farmStress(
  fields: Array<StressFieldInput & { outcome: StressFieldOutcome }>,
  workspaceCurrency: string | null,
  season: number,
): FarmStress {
  const counted: FarmStressField[] = [];
  const notCounted: FarmStress["notCounted"] = [];
  let cur = 0;
  let rec = 0;
  let typical = 0;
  let recTypical = 0;
  for (const f of fields) {
    const skip = (reason: FarmStressSkip) => notCounted.push({ fieldId: f.fieldId, name: f.name, reason });
    const o = f.outcome;
    if (o.kind === "skip") {
      skip(o.reason);
      continue;
    }
    // Never mix currencies: only fields whose margins are in the workspace currency are summed.
    if (o.result.mode !== "money" || o.currency !== workspaceCurrency) {
      skip("no-prices");
      continue;
    }
    const recommendedId = o.result.bestFit ?? o.result.current.id;
    const c = lossPerHa(o.result, o.result.current.id);
    const r = lossPerHa(o.result, recommendedId);
    if (!c || !r) {
      skip("no-2022-weather");
      continue;
    }
    counted.push({
      fieldId: f.fieldId,
      name: f.name,
      areaHa: f.areaHa,
      currentLoss: Math.round(c.loss * f.areaHa),
      recommendedLoss: Math.round(r.loss * f.areaHa),
      recommendedId,
    });
    cur += c.loss * f.areaHa;
    rec += r.loss * f.areaHa;
    typical += c.typical * f.areaHa;
    recTypical += r.typical * f.areaHa;
  }
  if (!counted.length)
    return {
      status: "unavailable",
      stressYear: STRESS_YEAR,
      season,
      currency: workspaceCurrency,
      current: null,
      recommended: null,
      difference: null,
      counted,
      notCounted,
    };
  const current = { atRisk: Math.round(cur), typical: Math.round(typical) };
  const recommended = { atRisk: Math.round(rec), typical: Math.round(recTypical) };
  return {
    status: "ready",
    stressYear: STRESS_YEAR,
    season,
    currency: workspaceCurrency,
    current,
    recommended,
    difference: current.atRisk - recommended.atRisk,
    counted,
    notCounted,
  };
}
