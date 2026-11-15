import { describe, expect, it, vi } from "vitest";
import type { EngineResult, ScenarioResult } from "@terrasight/scenario-engine";
import { farmStress, type StressFieldOutcome } from "./farm-stress.js";
import { FarmStressService } from "./farm-stress.service.js";
import type { ScenariosService } from "./scenarios.service.js";

function scen(id: string, stress: { margin: number; typical: number } | null): ScenarioResult {
  return { id, if2022BySeason: [stress, null, null, null, null] } as unknown as ScenarioResult;
}

function run(
  cur: { margin: number; typical: number } | null,
  alt: { margin: number; typical: number } | null,
  bestFit: string,
  mode: "money" | "agronomy" = "money",
): StressFieldOutcome {
  const result = {
    current: scen("current", cur),
    alternatives: [scen("alt", alt)],
    bestFit,
    mode,
  } as unknown as EngineResult;
  return { kind: "run", result, currency: "USD", runId: "r" };
}

const f = (fieldId: string, areaHa: number, outcome: StressFieldOutcome) => ({
  fieldId,
  name: fieldId,
  areaHa,
  outcome,
});

describe("farmStress", () => {
  it("sums loss per hectare × area for the current plan and the recommended option", () => {
    const out = farmStress(
      [
        f("a", 10, run({ margin: 100, typical: 600 }, { margin: 300, typical: 650 }, "alt")),
        f("b", 20, run({ margin: 400, typical: 700 }, { margin: 500, typical: 720 }, "alt")),
      ],
      "USD",
      2026,
    );
    expect(out.status).toBe("ready");
    expect(out.season).toBe(2026);
    expect(out.currency).toBe("USD");
    // current: 10×500 + 20×300 = 11000; recommended: 10×350 + 20×220 = 7900; typical (current): 6000 + 14000
    expect(out.current).toEqual({ atRisk: 11000, typical: 20000 });
    expect(out.recommended).toEqual({ atRisk: 7900, typical: 6500 + 14400 });
    expect(out.difference).toBe(3100);
    expect(out.counted.map((c) => [c.fieldId, c.currentLoss, c.recommendedLoss, c.recommendedId])).toEqual([
      ["a", 5000, 3500, "alt"],
      ["b", 6000, 4400, "alt"],
    ]);
    expect(out.notCounted).toEqual([]);
  });

  it("the recommended plan can be the current plan: no difference", () => {
    const out = farmStress(
      [f("a", 10, run({ margin: 100, typical: 600 }, { margin: 50, typical: 500 }, "current"))],
      "USD",
      2026,
    );
    expect(out.recommended).toEqual(out.current);
    expect(out.difference).toBe(0);
    expect(out.counted[0]!.recommendedId).toBe("current");
  });

  it("lists fields it cannot count, with the reason, and never counts them", () => {
    const out = farmStress(
      [
        f("ok", 10, run({ margin: 100, typical: 200 }, { margin: 100, typical: 200 }, "current")),
        f("norun", 5, { kind: "skip", reason: "no-run" }),
        f("unsuitable", 5, { kind: "skip", reason: "land-unsuitable" }),
        f("no2022", 5, run(null, null, "current")),
        f("agro", 5, run({ margin: 1, typical: 2 }, { margin: 1, typical: 2 }, "current", "agronomy")),
        f("eur", 5, { ...(run({ margin: 1, typical: 2 }, { margin: 1, typical: 2 }, "current") as object), currency: "EUR" } as StressFieldOutcome),
      ],
      "USD",
      2026,
    );
    expect(out.counted.map((c) => c.fieldId)).toEqual(["ok"]);
    expect(out.notCounted.map((n) => [n.fieldId, n.reason])).toEqual([
      ["norun", "no-run"],
      ["unsuitable", "land-unsuitable"],
      ["no2022", "no-2022-weather"],
      ["agro", "no-prices"],
      ["eur", "no-prices"],
    ]);
    expect(out.current).toEqual({ atRisk: 1000, typical: 2000 });
  });

  it("is unavailable when no field can be counted", () => {
    const out = farmStress([f("a", 1, { kind: "skip", reason: "no-run" })], "USD", 2026);
    expect(out).toMatchObject({ status: "unavailable", current: null, recommended: null, difference: null });
    expect(out.notCounted).toHaveLength(1);
  });
});

describe("FarmStressService", () => {
  function setup(fieldsByWs: Record<string, Array<{ id: string; name: string; areaHa: number }>>) {
    const findMany = vi.fn(async ({ where }: { where: { workspaceId: string } }) => fieldsByWs[where.workspaceId] ?? []);
    const prepare = vi.fn(async (_w: string, fieldId: string) => ({
      input: { firstSeason: 2026, agronomyOnly: false },
      meta: { currency: "USD" },
      early: undefined,
      fieldId,
    }));
    const cachedRun = vi.fn(async () => ({
      id: "run-1",
      result: run({ margin: 100, typical: 300 }, { margin: 100, typical: 300 }, "current").kind === "run"
        ? ({
            current: scen("current", { margin: 100, typical: 300 }),
            alternatives: [],
            bestFit: "current",
            mode: "money",
          } as unknown as EngineResult)
        : null,
    }));
    const execute = vi.fn();
    const svc = new FarmStressService(
      { PLAN_FIRST_SEASON: 2026 } as never,
      { db: { field: { findMany } } } as never,
      { prepare, cachedRun, execute, poolIdle: () => false } as unknown as ScenariosService,
      { currency: async () => "USD" } as never,
    );
    return { svc, findMany, execute };
  }

  it("reads only the asked workspace's active fields (isolation)", async () => {
    const { svc, findMany } = setup({
      A: [{ id: "fa", name: "A1", areaHa: 10 }],
      B: [{ id: "fb", name: "SECRET-B", areaHa: 99 }],
    });
    const out = await svc.get("A");
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { workspaceId: "A", archivedAt: null } }),
    );
    expect(out.counted.map((c) => c.fieldId)).toEqual(["fa"]);
    expect(JSON.stringify(out)).not.toContain("SECRET-B");
    // ready: loss 200 per ha × 10 ha for both plans
    expect(out.current).toEqual({ atRisk: 2000, typical: 3000 });
  });

  it("counts a field without a stored run as no-run when the pool is busy (no heavy work)", async () => {
    const { svc, execute } = setup({ A: [{ id: "fa", name: "A1", areaHa: 10 }] });
    // pool is busy and the run is missing: nothing is started
    (svc as unknown as { scenarios: { cachedRun: () => Promise<null> } }).scenarios.cachedRun = async () => null;
    const out = await svc.get("A");
    expect(execute).not.toHaveBeenCalled();
    expect(out.notCounted).toEqual([{ fieldId: "fa", name: "A1", reason: "no-run" }]);
    expect(out.status).toBe("unavailable");
  });
});
