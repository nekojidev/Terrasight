import { describe, expect, it } from "vitest";
import type { EngineInput, EngineResult, ScenarioResult } from "@terrasight/scenario-engine";
import type { YearSetId } from "@terrasight/shared";
import { ProblemException } from "../http/problem.js";
import { bestChanges, rankingOfSet } from "./year-sets.js";
import { YearSetsService } from "./year-sets.service.js";
import type { ScenariosService } from "./scenarios.service.js";

function scen(
  id: string,
  margin: number | null,
  drought: number,
  kind: "current" | "alternative" = "alternative",
): ScenarioResult {
  return {
    id,
    kind,
    plan: [],
    margin,
    marginBySeason: null,
    water: 100,
    carbonChange: 0,
    erosion: 1,
    drought: margin == null ? null : drought,
    droughtYield: drought,
    if2022: { margin: 0, typical: 0, season: 2026 },
    if2022BySeason: [],
    priceWins: 0,
    capped: false,
    capLoss: 0,
    pestPressure: [],
    caveats: [],
    relaxed: [],
    delta: { margin: 0, water: 0, soil: 0, drought: 0 },
  };
}

function result(set: YearSetId, opts: ScenarioResult[], from = 1981, to = 2025): EngineResult {
  return {
    current: opts[0]!,
    alternatives: opts.slice(1),
    candidates: opts.length - 1,
    relaxed: [],
    noLibrary: false,
    bestFit: null,
    mode: opts[0]!.margin == null ? "agronomy" : "money",
    weather: { yearSet: set, from, to, count: to - from + 1 },
  };
}

describe("rankingOfSet", () => {
  it("ranks every option of the set with equal priorities, rank 1 = best", () => {
    const r = rankingOfSet(
      "all",
      result("all", [scen("current", 100, 50, "current"), scen("a", 300, 200), scen("b", 200, 100)]),
      null,
    );
    expect(r.options.map((o) => [o.id, o.rank])).toEqual([
      ["a", 1],
      ["b", 2],
      ["current", 3],
    ]);
    expect(r.best).toBe("a");
    expect(r.years).toEqual({ from: 1981, to: 2025, count: 45 });
    expect(r.shift).toBeNull();
    expect(r.options[0]).toMatchObject({ margin: 300, drought: 200 });
  });

  it("agronomy-only: margin null, drought is the relative yield", () => {
    const r = rankingOfSet(
      "all",
      result("all", [scen("current", null, 0.7, "current"), scen("a", null, 0.9)]),
      null,
    );
    expect(r.options.every((o) => o.margin === null)).toBe(true);
    expect(r.options.find((o) => o.id === "a")!.drought).toBe(0.9);
    expect(r.best).toBe("a");
  });
});

describe("bestChanges", () => {
  const set = (best: string) => ({ best }) as never;
  it("is false when every set has the same rank 1, true when one differs", () => {
    expect(bestChanges([set("a"), set("a"), set("a")])).toBe(false);
    expect(bestChanges([set("a"), set("b"), set("a")])).toBe(true);
  });
});

function inputWithYears(from: number, to: number): EngineInput {
  const days = Array.from({ length: 365 }, (_, i) => ({
    date: `x${i}`,
    tmin: 0,
    tmax: 10,
    precip: 0,
    rh: null,
    rs: null,
    u2: null,
  }));
  return {
    site: { latDeg: 38 },
    weatherByYear: new Map(Array.from({ length: to - from + 1 }, (_, i) => [from + i, days])),
    rotations: ["lib-1", "lib-2", "lib-3", "ai:x"].map((id) => ({ id, sequence: ["corn"] })),
  } as unknown as EngineInput;
}

/** A flat POWER series 1981–2025: no significant trend, so the shift is neutral. */
function powerSeries(): unknown {
  const dates: string[] = [];
  for (let t = Date.parse("1981-01-01T00:00:00Z"); t < Date.parse("2026-01-01T00:00:00Z"); t += 864e5)
    dates.push(new Date(t).toISOString().slice(0, 10));
  const flat = dates.map(() => 10);
  return { dates, values: { T2M: flat, T2M_MAX: flat, T2M_MIN: flat, PRECTOTCORR: flat } };
}

/** A fake scenario service: the default run shows lib-1 and ai:x; each set's best option is given. */
function fake(from: number, to: number, best: Partial<Record<YearSetId, string>>) {
  const calls: Array<EngineInput & { mode?: string }> = [];
  const input = inputWithYears(from, to);
  return {
    calls,
    prepare: async (_w: string, _f: string, _o: unknown, mode: string) => {
      calls.push({ mode } as never);
      return {
        input,
        meta: { currency: "USD" },
        ai: { status: "ok", proposals: [] },
        missing: [],
        power: powerSeries(),
      };
    },
    execute: async (_f: string, i: EngineInput) => {
      calls.push(i);
      const id = i.yearSet?.id ?? "all";
      const win = best[id] ?? "lib-1";
      const cur = scen("current", 100, 50, "current");
      const mk = (x: string) => scen(x, x === win ? 500 : 200, x === win ? 300 : 100);
      return {
        id: "run",
        createdAt: new Date(),
        durationMs: 1,
        result: i.fixedCandidates
          ? result(id, [cur, ...i.rotations.map((r) => mk(r.id))], 2001, 2025)
          : result("all", [cur, mk("lib-1"), mk("ai:x")]),
      };
    },
    namesOf: () => ({
      "lib-1": { en: "L1", uk: "Л1" },
      "ai:x": { en: "AI", uk: "ШІ" },
      "lib-2": { en: "L2", uk: "Л2" },
    }),
  };
}

const asSvc = (f: unknown) => new YearSetsService(f as ScenariosService);

describe("YearSetsService.compare", () => {
  it("evaluates exactly the options of the default run in every set, without calling the assistant again", async () => {
    const f = fake(1981, 2025, { "last-15": "ai:x" });
    const out = await asSvc(f).compare("w", "f", {});
    expect(out.sets.map((s) => s.id)).toEqual(["all", "climate-1981-2000", "last-15", "trend-2030"]);
    for (const s of out.sets) expect(s.options.map((o) => o.id).sort()).toEqual(["ai:x", "current", "lib-1"]);
    // lib-2 / lib-3 (not shown in the default run) never entered any set
    const runs = f.calls.filter((c) => c.fixedCandidates);
    expect(runs).toHaveLength(4);
    for (const r of runs) expect(r.rotations.map((x) => x.id).sort()).toEqual(["ai:x", "lib-1"]);
    // stored proposals only
    expect(f.calls[0]).toEqual({ mode: "cached" });
    expect(out.bestChanges).toBe(true);
    expect(out.sets.find((s) => s.id === "last-15")!.best).toBe("ai:x");
    expect(Object.keys(out.names).sort()).toEqual(["ai:x", "lib-1"]);
    expect(out.currency).toBe("USD");
  });

  it("bestChanges is false when every set agrees", async () => {
    const out = await asSvc(fake(1981, 2025, {})).compare("w", "f", {});
    expect(out.bestChanges).toBe(false);
    expect(new Set(out.sets.map((s) => s.best))).toEqual(new Set(["lib-1"]));
  });

  it("only trend-2030 carries a shift (and passes it to the engine); other sets have null", async () => {
    const f = fake(1981, 2025, {});
    const out = await asSvc(f).compare("w", "f", {});
    for (const s of out.sets)
      if (s.id === "trend-2030") expect(s.shift).toMatchObject({ deltaT: 0, precipFactor: 1 });
      else expect(s.shift).toBeNull();
    const trend = f.calls.find((c) => c.yearSet?.id === "trend-2030")!;
    expect(trend.yearSet!.shift).toEqual({ deltaT: 0, precipFactor: 1 });
  });

  it("omits a set with fewer than 10 complete seasons", async () => {
    const out = await asSvc(fake(2001, 2025, {})).compare("w", "f", {});
    expect(out.sets.map((s) => s.id)).toEqual(["all", "last-15", "trend-2030"]);
  });

  it("refuses with a problem when the field has no comparison (unsuitable land, no library, pending data)", async () => {
    const svc = asSvc({ prepare: async () => ({ early: { id: null, landUnsuitable: true } }) });
    await expect(svc.compare("w", "f", {})).rejects.toBeInstanceOf(ProblemException);
  });
});
