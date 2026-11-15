import { describe, expect, it, vi } from "vitest";
import { createSafetyFilter } from "@terrasight/assistant-core";
import { runScenarios, type EngineInput } from "@terrasight/scenario-engine";
import type { WeatherDay } from "@terrasight/simulator";
import { loadEnv } from "../config/config.js";
import {
  AiRotationsService,
  buildPrompt,
  irrigationOnlyCrops,
  toRotations,
  validateProposals,
  type ProposalContext,
} from "./ai-rotations.service.js";

const crop = (id: string) => ({ id, name: id });
const ctx = (over: Partial<ProposalContext> = {}): ProposalContext => ({
  regionId: "us-southern-plains",
  regionName: { en: "Southern Plains", uk: "Південні рівнини" },
  countries: ["US"],
  tier: "A",
  irrigated: false,
  southern: false,
  firstSeason: 2026,
  soil: { waterCapacityMmPerM: 150, hydrologicGroup: "B", basis: "ssurgo" },
  climate: { meanSeasonRainfallMm: 500, meanSeasonTempC: 12, weatherYears: 44 },
  history: [
    { season: 2023, crop: "winter_wheat", source: "cdl" },
    { season: 2024, crop: "sorghum", source: "cdl" },
    { season: 2025, crop: "winter_wheat", source: "agronomist" },
  ],
  currentRotation: { basis: "detected", sequence: ["winter_wheat", "sorghum", "fallow"] },
  allowed: ["corn", "winter_wheat", "sorghum", "soybean", "sunflower", "rice"].map(crop),
  irrigationOnly: ["rice"],
  doubleCrops: ["winter_wheat+soybean"],
  libraryExamples: [{ name: "Wheat-sorghum-fallow", sequence: ["winter_wheat", "sorghum", "fallow"] }],
  pestModels: [],
  existingPlans: ["corn,corn,winter_wheat,sorghum,corn", "winter_wheat,sorghum,fallow,winter_wheat,sorghum"],
  ...over,
});

const good = (seq: string[], over: Record<string, unknown> = {}) => ({
  name: { en: "Sunflower break", uk: "Соняшникова пауза" },
  sequence: seq,
  rationale: {
    en: "Sunflower roots reach deeper water. It breaks the wheat disease cycle.",
    uk: "Соняшник дістає глибшу воду. Він розриває цикл хвороб пшениці.",
  },
  ...over,
});
const okSeq = ["sunflower", "winter_wheat", "sorghum", "soybean", "winter_wheat"];

describe("validateProposals", () => {
  it("keeps a valid proposal and gives it an ai: id", () => {
    const r = validateProposals([good(okSeq)], ctx());
    expect(r.dropped).toEqual([]);
    expect(r.valid).toHaveLength(1);
    expect(r.valid[0]!.id).toMatch(/^ai:[0-9a-f]{10}$/);
    expect(r.valid[0]!.sequence).toEqual(okSeq);
  });
  it("converts an allowed double crop to {main, second}", () => {
    const r = validateProposals([good(["winter_wheat+soybean", "corn", "sorghum", "sunflower", "fallow"])], ctx());
    expect(r.valid[0]!.sequence[0]).toEqual({ main: "winter_wheat", second: "soybean" });
  });
  it("drops double cropping the region does not use", () => {
    const r = validateProposals([good(["winter_wheat+soybean", "corn", "sorghum", "sunflower", "fallow"])], ctx({ doubleCrops: [] }));
    expect(r.valid).toEqual([]);
  });
  it("drops unknown or not-allowed crops", () => {
    const r = validateProposals(
      [good(["quinoa", "corn", "sorghum", "sunflower", "fallow"]), good(["cotton", "corn", "sorghum", "sunflower", "fallow"])],
      ctx(),
    );
    expect(r.valid).toEqual([]);
    expect(r.dropped.map((d) => d.reason)).toEqual([
      expect.stringContaining("quinoa"),
      expect.stringContaining("cotton"),
    ]);
  });
  it("drops a wrong length", () => {
    expect(validateProposals([good(okSeq.slice(0, 4)), good([...okSeq, "corn"])], ctx()).valid).toEqual([]);
  });
  it("drops the same crop 3 seasons in a row, also across the history boundary", () => {
    expect(validateProposals([good(["corn", "corn", "corn", "sorghum", "soybean"])], ctx()).valid).toEqual([]);
    const h = ctx({
      history: [
        { season: 2024, crop: "corn", source: "cdl" },
        { season: 2025, crop: "corn", source: "cdl" },
      ],
    });
    expect(validateProposals([good(["corn", "sorghum", "soybean", "sunflower", "winter_wheat"])], h).valid).toEqual([]);
    expect(validateProposals([good(["sorghum", "corn", "soybean", "sunflower", "winter_wheat"])], h).valid).toHaveLength(1);
  });
  it("drops a host repeat that exceeds a verified pest model", () => {
    const pest = ctx({ pestModels: [{ pest: "rootworm", hosts: ["corn"], repeatSeasons: 1 }] });
    const r = validateProposals([good(["corn", "corn", "sorghum", "sunflower", "winter_wheat"])], pest);
    expect(r.dropped[0]!.reason).toMatch(/pest model/);
  });
  it("drops irrigation-only crops on dryland but keeps them when irrigated", () => {
    const seq = ["soybean", "corn", "sorghum", "sunflower", "winter_wheat"];
    expect(validateProposals([good(seq)], ctx({ irrigated: false, irrigationOnly: ["corn"] })).dropped[0]!.reason).toMatch(/irrigation/);
    expect(validateProposals([good(seq)], ctx({ irrigated: true, irrigationOnly: ["corn"] })).valid).toHaveLength(1);
  });
  it("drops duplicates of library or current plans, and of earlier proposals", () => {
    const lib = ["corn", "corn", "winter_wheat", "sorghum", "corn"];
    const r = validateProposals([good(lib), good(okSeq), good(okSeq)], ctx());
    expect(r.valid).toHaveLength(1);
    expect(r.dropped).toHaveLength(2);
  });
  it("drops too much fallow", () => {
    expect(validateProposals([good(["fallow", "fallow", "fallow", "corn", "sorghum"])], ctx()).valid).toEqual([]);
  });
  it("drops rationales with numbers (never edits them)", () => {
    const en = good(okSeq, { rationale: { en: "Adds 20 bushels.", uk: "Додає врожай." } });
    const uk = good(okSeq, { rationale: { en: "Adds yield.", uk: "Додає 20 бушелів." } });
    const r = validateProposals([en, uk], ctx());
    expect(r.valid).toEqual([]);
    expect(r.dropped).toHaveLength(2);
  });
  it("drops a rationale of more than 2 sentences or one that names a product", () => {
    const long = good(okSeq, {
      rationale: { en: "One. Two. Three.", uk: "Раз. Два. Три." },
    });
    expect(validateProposals([long], ctx()).valid).toEqual([]);
    const safety = createSafetyFilter(["glyphosate"]);
    const prod = good(okSeq, { rationale: { en: "Spray glyphosate early.", uk: "Менше хвороб." } });
    expect(validateProposals([prod], ctx(), safety).valid).toEqual([]);
  });
  it("ignores non-arrays and malformed items", () => {
    expect(validateProposals("nope", ctx()).valid).toEqual([]);
    expect(validateProposals([null, {}, { sequence: "x" }], ctx()).valid).toEqual([]);
  });
});

describe("irrigationOnlyCrops", () => {
  it("lists crops that only appear in irrigation-required rotations", () => {
    const rot = (irrigation: string, sequence: string[]) => ({ irrigation, sequence }) as never;
    expect(irrigationOnlyCrops([rot("required", ["rice", "corn"]), rot("none", ["corn"])])).toEqual(["rice"]);
  });
});

describe("buildPrompt", () => {
  it("contains the factual inputs and no field name", () => {
    const p = JSON.parse(buildPrompt(ctx()));
    expect(p.seasons).toEqual([2026, 2027, 2028, 2029, 2030]);
    expect(p.history[2]).toMatchObject({ season: 2025, source: "agronomist" });
    expect(p.allowedCrops.map((c: { id: string }) => c.id)).toContain("sunflower");
    expect(p.climate.meanSeasonRainfallMm).toBe(500);
  });
});

describe("AiRotationsService", () => {
  const svc = (answer: () => Promise<{ text: string }>, extra: Record<string, string> = {}) => {
    const s = new AiRotationsService(loadEnv({ JWT_SECRET: "x".repeat(32), DATABASE_URL: "postgresql://u:p@localhost:5432/db", RABBITMQ_URL: "amqp://localhost", ...extra, GEMINI_API_KEY: "k" } as never));
    const generateContent = vi.fn(answer);
    s.client = { models: { generateContent } } as never;
    return { s, generateContent };
  };
  const reply = (items: unknown[]) => async () => ({ text: JSON.stringify(items) });

  it("validates, caches per inputs, and calls Gemini once", async () => {
    const { s, generateContent } = svc(reply([good(okSeq), good(["quinoa", "corn", "sorghum", "sunflower", "fallow"])]));
    const a = await s.propose(ctx());
    const b = await s.propose(ctx());
    expect(a.status).toBe("ok");
    expect(a.proposals).toHaveLength(1);
    expect(b.proposals).toEqual(a.proposals);
    expect(generateContent).toHaveBeenCalledTimes(1);
    // another field state is another cache key
    await s.propose(ctx({ irrigated: true }));
    expect(generateContent).toHaveBeenCalledTimes(2);
  });
  it("cached mode never calls Gemini", async () => {
    const { s, generateContent } = svc(reply([good(okSeq)]));
    expect(await s.propose(ctx(), "cached")).toEqual({ status: "skipped", proposals: [] });
    expect(generateContent).not.toHaveBeenCalled();
    await s.propose(ctx());
    expect((await s.propose(ctx(), "cached")).proposals).toHaveLength(1);
  });
  it("reports unavailable on errors and invalid JSON, without throwing", async () => {
    const boom = svc(async () => {
      throw new Error("503");
    });
    expect(await boom.s.propose(ctx())).toEqual({ status: "unavailable", proposals: [] });
    const junk = svc(async () => ({ text: "not json" }));
    expect((await junk.s.propose(ctx())).status).toBe("unavailable");
  });
  it("retries once without thinkingConfig when the model rejects it", async () => {
    let n = 0;
    const { s, generateContent } = svc(async () => {
      if (n++ === 0) throw new Error("Thinking level is not supported for this model");
      return { text: JSON.stringify([good(okSeq)]) };
    });
    expect((await s.propose(ctx())).proposals).toHaveLength(1);
    expect((generateContent.mock.calls[1] as unknown as [{ config: { thinkingConfig?: unknown } }])[0].config.thinkingConfig).toBeUndefined();
  });
  it("is skipped without a key or when AI_ROTATIONS=0", async () => {
    const env = { JWT_SECRET: "x".repeat(32), DATABASE_URL: "postgresql://u:p@localhost:5432/db", RABBITMQ_URL: "amqp://localhost" } as never;
    expect((await new AiRotationsService(loadEnv(env)).propose(ctx())).status).toBe("skipped");
    const { s } = svc(reply([good(okSeq)]), { AI_ROTATIONS: "0" });
    expect((await s.propose(ctx())).status).toBe("skipped");
  });
});

describe("AI candidates in the engine run", () => {
  const days = (year: number): WeatherDay[] =>
    Array.from({ length: 365 }, (_, i) => {
      const date = new Date(Date.UTC(year - 1, 8, 1) + i * 86_400_000).toISOString().slice(0, 10);
      const m = Number(date.slice(5, 7));
      const tmax = 8 + 18 * Math.sin(((m - 3) / 12) * Math.PI * 2 * 0.5 + 0.2) ** 2;
      return { date, tmin: tmax - 10, tmax, precip: i % 4 === 0 ? 6 : 0, rh: 60, rs: 15, u2: 2, et0: 3 } as WeatherDay;
    });
  const input = (rotations: EngineInput["rotations"]): EngineInput => ({
    fieldKey: "f",
    site: { latDeg: 38, elevationM: 800, awsMmPerM: 150, hydGroup: "B", slopePct: 1 },
    irrigated: false,
    firstSeason: 2026,
    rotations,
    current: { rotationId: null, sequence: ["winter_wheat", "sorghum"], position: 0, label: "detected" },
    weatherByYear: new Map([2019, 2020, 2021, 2022, 2023].map((y) => [y, days(y)])),
    sowing: {},
    prices: {
      winter_wheat: { price: 230, variableCost: 400, yieldRef: 4 },
      sorghum: { price: 200, variableCost: 350, yieldRef: 5 },
      sunflower: { price: 400, variableCost: 380, yieldRef: 2.5 },
      soybean: { price: 450, variableCost: 380, yieldRef: 3 },
    },
    soilCarbon: 45,
    history: ["winter_wheat"],
    runs: 6,
  });
  const lib = (id: string, seq: string[]) => ({ id, sequence: seq, irrigation: "none" as const });

  it("simulates proposals like library rotations and always shows the best one, flagged source ai", () => {
    const proposals = validateProposals(
      [good(["sunflower", "winter_wheat", "sorghum", "soybean", "winter_wheat"])],
      ctx({ existingPlans: [] }),
    ).valid;
    const rotations = [lib("l1", ["winter_wheat", "sorghum", "soybean"]), lib("l2", ["soybean", "winter_wheat"]), ...toRotations(proposals, false)];
    const res = runScenarios(input(rotations));
    const ai = res.alternatives.find((a) => a.id === proposals[0]!.id);
    expect(ai).toBeDefined();
    expect(ai!.source).toBe("ai");
    expect(Number.isFinite(ai!.margin)).toBe(true);
    expect(Number.isFinite(ai!.delta.margin)).toBe(true);
    expect(ai!.plan).toHaveLength(5);
    expect(res.alternatives.filter((a) => a.id !== ai!.id).every((a) => a.source === "library")).toBe(true);
    expect(res.candidates).toBe(3);
  });
  it("shows at most two AI options", () => {
    const proposals = validateProposals(
      [
        good(["sunflower", "winter_wheat", "sorghum", "soybean", "winter_wheat"]),
        good(["soybean", "winter_wheat", "sunflower", "sorghum", "winter_wheat"]),
        good(["sorghum", "sunflower", "winter_wheat", "soybean", "sunflower"]),
      ],
      ctx({ existingPlans: [] }),
    ).valid;
    expect(proposals).toHaveLength(3);
    const rotations = [lib("l1", ["winter_wheat", "sorghum", "soybean"]), lib("l2", ["soybean", "winter_wheat"]), ...toRotations(proposals, false)];
    const res = runScenarios(input(rotations));
    expect(res.alternatives.filter((a) => a.source === "ai").length).toBeLessThanOrEqual(2);
    expect(res.alternatives.some((a) => a.source === "ai")).toBe(true);
  });
  it("without proposals the result is library-only", () => {
    const res = runScenarios(input([lib("l1", ["winter_wheat", "sorghum", "soybean"]), lib("l2", ["soybean", "winter_wheat"])]));
    expect(res.alternatives.every((a) => a.source === "library")).toBe(true);
  });
});
