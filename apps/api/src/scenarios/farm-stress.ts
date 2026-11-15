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

/** Loss of one scenario in one season of 2022 weather: (typical − margin) per hectare, or null without 2022 data. */
function lossPerHa(result: EngineResult, id: string): { loss: number; typical: number } | null {
  const s = [result.current, ...result.alternatives].find((x) => x.id === id);
  const hit = s?.if2022BySeason?.[0];
  if (!hit || !Number.isFinite(hit.margin) || !Number.isFinite(hit.typical)) return null;
  return { loss: hit.typical - hit.margin, typical: hit.typical };
}

/**
 * Farm stress test (T14): 2022 weather in the first planned season on every counted field; loss = typical margin −
 * margin in that season, times the area, summed for the current plan and for the recommended option (equal priorities).
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
