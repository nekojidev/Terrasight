import { appendFileSync, cpSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createSafetyFilter } from "@terrasight/assistant-core";
import { loadLibrary } from "@terrasight/library";
import { describe, expect, it, vi } from "vitest";
import { loadEnv } from "../config/config.js";
import type { PrismaService } from "../db/prisma.service.js";
import { recommendationText } from "../recommendations/text.js";
import { AiRecommendationsService } from "./ai-recommendations.service.js";
import { validateBatch, validateSummary } from "./ai-text.js";
import type { BuiltInputs } from "./eval-inputs.service.js";

const DATA_DIR = fileURLToPath(new URL("../../../../data/", import.meta.url));
const lib = loadLibrary(DATA_DIR);
const env = loadEnv({
  DATABASE_URL: "postgres://x@localhost/x",
  RABBITMQ_URL: "amqp://localhost:5672",
  JWT_SECRET: "unit-test-secret-0123456789abcdef0123",
  NODE_ENV: "test",
  DATA_DIR,
  GEMINI_API_KEY: "test-key",
});
const safety = createSafetyFilter(["glyphosate"]);

const txt = (en: string, uk: string) => ({ en, uk });
const good = (extra: Record<string, unknown> = {}) => ({
  title: txt("Corn rootworm risk on this field", "Ризик кукурудзяного жука на цьому полі"),
  action: txt(
    "Plan the next crop and scout roots in spring.",
    "Сплануйте наступну культуру й огляньте коріння навесні.",
  ),
  why: txt("Corn has followed corn for 2 seasons.", "Кукурудза йде після кукурудзи 2 сезони поспіль."),
  ...extra,
});

describe("validateBatch (number check, safety filter, watch rules)", () => {
  const facts = new Map([["r1", { keyNumbers: [{ id: "hostSeasons", value: 2 }], deadline: "2027-04-25" }]]);
  const shared = { season: 2026 };
  const watch = new Map([["wp", { pestId: "wp", scout: { en: "Walk the field" } }]]);

  it("keeps a text whose numbers are all in the facts", () => {
    const v = validateBatch({ items: [{ ref: "r1", ...good() }] }, facts, shared, new Map(), safety);
    expect(v.items.get("r1")?.title.en).toContain("rootworm");
    expect(v.rejected).toEqual([]);
  });

  it("rejects a number that is not among the facts", () => {
    const bad = good({
      why: txt("Corn has followed corn for 3 seasons.", "Кукурудза йде після кукурудзи 2 сезони поспіль."),
    });
    const v = validateBatch({ items: [{ ref: "r1", ...bad }] }, facts, shared, new Map(), safety);
    expect(v.items.size).toBe(0);
    expect(v.rejected[0]?.reason).toMatch(/number not in facts/);
  });

  it("rejects letters of another script (stray Japanese in an English action)", () => {
    const bad = good({
      action: txt("Discuss resistant hybrids with道の seed supplier.", "Обговоріть стійкі гібриди з постачальником."),
    });
    const v = validateBatch({ items: [{ ref: "r1", ...bad }] }, facts, shared, new Map(), safety);
    expect(v.items.size).toBe(0);
    expect(v.rejected[0]?.reason).toMatch(/another script/);
  });

  it("rejects a product name or a dose", () => {
    const product = good({ action: txt("Spray glyphosate now.", "Обробіть гліфосатом.") });
    const dose = good({ action: txt("Apply 2 L/ha in spring.", "Внесіть 2 л/га навесні.") });
    for (const bad of [product, dose]) {
      const v = validateBatch({ items: [{ ref: "r1", ...bad }] }, facts, shared, new Map(), safety);
      expect(v.items.size).toBe(0);
      expect(v.rejected[0]?.reason).toMatch(/product or dose/);
    }
  });

  it("drops a watch-item whose pest id is not a candidate, and caps the rest at two", () => {
    const many = new Map(["a", "b", "c"].map((id) => [id, { pestId: id }]));
    const calm = {
      title: txt("Worth a scouting walk", "Варто пройти полем"),
      action: txt("Walk the field and check the crop.", "Пройдіть полем і огляньте культуру."),
      why: txt("It suits the crop at this time of year.", "Це доречно для культури в цей час року."),
    };
    const v = validateBatch(
      {
        items: [],
        watch: [
          { pestId: "not_in_library", ...calm },
          { pestId: "a", ...calm },
          { pestId: "b", ...calm },
          { pestId: "c", ...calm },
        ],
      },
      new Map(),
      shared,
      many,
      safety,
    );
    expect(v.watch.map((w) => w.pestId)).toEqual(["a", "b"]);
    expect(v.rejected.map((r) => r.id)).toEqual(["watch:not_in_library", "watch:c"]);
  });

  it("drops a watch-item with a figure that is not in its library text", () => {
    const bad = good({
      why: txt("About 40 percent of fields are hit.", "Уражено близько 40 відсотків полів."),
    });
    const v = validateBatch(
      { items: [], watch: [{ pestId: "wp", ...bad }] },
      new Map(),
      shared,
      watch,
      safety,
    );
    expect(v.watch).toEqual([]);
  });
});

describe("validateSummary", () => {
  const names = new Map([["F1", "Pivot 12"]]);
  const facts = { urgentCount: 1, urgent: [{ field: "F1", deadline: "2026-11-16" }] };
  it("accepts a checked sentence and swaps the field ref for the name", () => {
    const v = validateSummary(
      { en: "1 item is urgent on F1.", uk: "1 пункт терміновий на F1." },
      facts,
      safety,
      names,
    );
    expect(v).toEqual({
      text: { en: "1 item is urgent on Pivot 12.", uk: "1 пункт терміновий на Pivot 12." },
    });
  });
  it("rejects an unknown number", () => {
    const v = validateSummary(
      { en: "5 items are urgent.", uk: "5 пунктів термінові." },
      facts,
      safety,
      names,
    );
    expect(v).toHaveProperty("problem");
  });
});

// ---- the service, with an in-memory database and a mocked Gemini ----

interface Row extends Record<string, unknown> {
  id: string;
}
function fakeDb(rows: Row[]) {
  let n = 0;
  const match = (r: Row, where: Record<string, unknown>): boolean =>
    Object.entries(where).every(([k, v]) => {
      if (v && typeof v === "object" && "in" in (v as object))
        return (v as { in: unknown[] }).in.includes(r[k]);
      if (v && typeof v === "object" && "notIn" in (v as object))
        return !(v as { notIn: unknown[] }).notIn.includes(r[k]);
      return r[k] === v;
    });
  const cache = new Map<string, unknown>();
  const system = {
    recommendation: {
      findMany: async ({ where }: { where: Record<string, unknown> }) => rows.filter((r) => match(r, where)),
      update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        const r = rows.find((x) => x.id === where.id)!;
        for (const [k, v] of Object.entries(data))
          r[k] =
            v && typeof v === "object" && "constructor" in v && (v as object).constructor?.name === "DbNull"
              ? null
              : v;
        return r;
      },
      updateMany: async ({
        where,
        data,
      }: {
        where: Record<string, unknown>;
        data: Record<string, unknown>;
      }) => {
        for (const r of rows.filter((x) => match(x, where))) Object.assign(r, data);
      },
      create: async ({ data }: { data: Record<string, unknown> }) => {
        const r = {
          id: `new-${++n}`,
          status: "open",
          planning: false,
          irreversible: false,
          deadline: null,
          ...data,
        } as Row;
        rows.push(r);
        return r;
      },
    },
    sourceCache: {
      findUnique: async ({ where }: { where: { key: string } }) =>
        cache.has(where.key) ? { payload: cache.get(where.key) } : null,
      upsert: async ({ where, create }: { where: { key: string }; create: { payload: unknown } }) => {
        cache.set(where.key, create.payload);
      },
    },
    field: { findUniqueOrThrow: async () => ({ workspaceId: "ws" }) },
  };
  return { system } as unknown as PrismaService;
}

const rootworm = (over: Record<string, unknown> = {}): Row => ({
  id: "rec1",
  workspaceId: "ws",
  fieldId: "f1",
  type: "pest",
  subject: "western_corn_rootworm",
  season: 2026,
  status: "open",
  level: "high",
  confidence: "medium",
  planning: true,
  irreversible: false,
  deadline: new Date("2027-04-25T00:00:00Z"),
  keyNumbers: [{ id: "hostSeasons", value: 2 }],
  drivers: [{ driver: "rotation", value: 2, fired: true }],
  evidence: [],
  unknowns: [],
  aiText: null,
  aiSuggested: false,
  ...over,
});

const built = {
  stage: "unknown",
  inputs: {
    season: 2026,
    regionId: "us-southern-plains",
    tier: "A",
    record: { crop: { value: "corn" }, sowingDate: { value: null }, emergenceDate: { value: null } },
    nextCrop: { crop: "corn" },
    crops: [{ season: 2025, mainCrop: "corn", secondCrop: null }],
    weather: [],
  },
} as unknown as BuiltInputs;

function service(
  rows: Row[],
  respond: (req: { items: Array<{ ref: string }>; watchCandidates?: Array<{ pestId: string }> }) => unknown,
) {
  const svc = new AiRecommendationsService(env, lib, fakeDb(rows));
  const generate = vi.fn(async (args: { contents: string }) => ({
    text: JSON.stringify(respond(JSON.parse(args.contents))),
    usageMetadata: { promptTokenCount: 900, candidatesTokenCount: 300, thoughtsTokenCount: 0 },
  }));
  svc.gemini.client = { models: { generateContent: generate } } as never;
  return { svc, generate };
}

describe("AiRecommendationsService", () => {
  it("writes AI text for an evaluator result, with the template as the fallback", async () => {
    const rows = [rootworm()];
    const { svc, generate } = service(rows, (req) => ({
      items: req.items.map((i) => ({ ref: i.ref, ...good() })),
      watch: [],
    }));
    await svc.enrich("f1", built, "2026-11-14");
    expect(generate).toHaveBeenCalledTimes(1);
    expect((rows[0]!.aiText as { source: string }).source).toBe("ai");
    expect(svc.stats.tokensIn).toBe(900);
    // The template text is still computable for the same item.
    expect(recommendationText(rows[0] as never, lib).title.en).toMatch(/rootworm/i);
  });

  it("falls back to the template when the number check fails, and does not ask again for the same facts", async () => {
    const rows = [rootworm()];
    const { svc, generate } = service(rows, (req) => ({
      items: req.items.map((i) => ({
        ref: i.ref,
        ...good({ why: txt("Soil reached 99 °C.", "Ґрунт досяг 99 °C.") }),
      })),
    }));
    await svc.enrich("f1", built, "2026-11-14");
    const stored = rows[0]!.aiText as { source: string; reason: string };
    expect(stored.source).toBe("template");
    expect(stored.reason).toMatch(/number not in facts/);
    await svc.enrich("f1", built, "2026-11-14");
    expect(generate).toHaveBeenCalledTimes(1);
    expect(svc.stats.templateFallbacks).toBe(1);
  });

  it("falls back to the template when the safety filter blocks the text", async () => {
    const rows = [rootworm()];
    const { svc } = service(rows, (req) => ({
      items: req.items.map((i) => ({
        ref: i.ref,
        ...good({ action: txt("Apply 2 L/ha in spring.", "Внесіть 2 л/га навесні.") }),
      })),
    }));
    await svc.enrich("f1", built, "2026-11-14");
    expect((rows[0]!.aiText as { source: string; reason: string }).reason).toMatch(/product or dose/);
  });

  it("reuses text for identical facts on another field without a new call (cache by facts hash)", async () => {
    const rows = [rootworm(), rootworm({ id: "rec2", fieldId: "f2" })];
    const { svc, generate } = service(rows, (req) => ({
      items: req.items.map((i) => ({ ref: i.ref, ...good() })),
    }));
    // Two checks in turn: the second field's item has the same facts as the first one's.
    await svc.enrich("f1", built, "2026-11-14");
    await svc.enrich("f2", built, "2026-11-14");
    // The second field's call (if any) only asks for watch-items: its evaluator result came from the cache.
    const asked = generate.mock.calls.map((c) => JSON.parse(c[0].contents).items.length);
    expect(asked).toEqual([1, 0]);
    expect(svc.stats.cacheHits).toBe(1);
    expect((rows[1]!.aiText as { source: string }).source).toBe("ai");
  });

  it("leaves the template text (no aiText) when Gemini fails", async () => {
    const rows = [rootworm()];
    const svc = new AiRecommendationsService(env, lib, fakeDb(rows));
    svc.gemini.client = {
      models: { generateContent: async () => Promise.reject(new Error("503")) },
    } as never;
    await svc.enrich("f1", built, "2026-11-14");
    expect(rows[0]!.aiText).toBeNull();
    expect(svc.stats.failures).toBe(1);
  });

  it("creates watch-items for candidate pests only: level unknown, no deadline, never urgent; invalid ids dropped", async () => {
    const rows: Row[] = [];
    const probe = new AiRecommendationsService(env, lib, fakeDb([]));
    const candidates = probe.watchCandidates("corn", "us-southern-plains", new Set());
    expect(candidates.length).toBeGreaterThan(0);
    const enabled = new Set(lib.enabledModels.map((m) => m.pest));
    expect(candidates.every((c) => !enabled.has(c.id))).toBe(true);
    const pick = candidates[0]!.id;
    const { svc } = service(rows, (req) => ({
      items: [],
      watch: [
        { pestId: "made_up_pest", ...good() },
        {
          pestId: pick,
          title: txt("Worth a scouting walk", "Варто пройти полем"),
          action: txt("Walk the field and check the crop.", "Пройдіть полем і огляньте культуру."),
          why: txt("It suits the crop at this time of year.", "Це доречно для культури в цей час року."),
        },
      ],
      _seen: req.watchCandidates?.length,
    }));
    await svc.enrich("f1", built, "2026-11-14");
    expect(rows).toHaveLength(1);
    const w = rows[0]!;
    expect(w).toMatchObject({
      subject: pick,
      level: "unknown",
      aiSuggested: true,
      planning: false,
      irreversible: false,
      deadline: null,
    });
    expect(svc.stats.watchDropped).toBe(1);
    // Same crop / region / month: not asked again.
    const before = svc.stats.calls;
    await svc.enrich("f1", built, "2026-11-20");
    expect(svc.stats.calls).toBe(before);
  });

  it("does nothing when the flag is off", async () => {
    const off = loadEnv({
      ...process.env,
      DATABASE_URL: "postgres://x@localhost/x",
      RABBITMQ_URL: "amqp://x",
      JWT_SECRET: "unit-test-secret-0123456789abcdef0123",
      DATA_DIR,
      GEMINI_API_KEY: "k",
      AI_RECOMMENDATIONS: "0",
    });
    const rows = [rootworm()];
    const svc = new AiRecommendationsService(off, lib, fakeDb(rows));
    const generate = vi.fn();
    svc.gemini.client = { models: { generateContent: generate } } as never;
    await svc.enrich("f1", built, "2026-11-14");
    expect(generate).not.toHaveBeenCalled();
  });

  it("stores model, promptVersion and safetyListVersion, and regenerates when the safety list changes", async () => {
    const dir = mkdtempSync(join(tmpdir(), "terrasight-data-"));
    cpSync(DATA_DIR, dir, { recursive: true });
    const env2 = loadEnv({
      DATABASE_URL: "postgres://x@localhost/x",
      RABBITMQ_URL: "amqp://localhost:5672",
      JWT_SECRET: "unit-test-secret-0123456789abcdef0123",
      NODE_ENV: "test",
      DATA_DIR: dir,
      GEMINI_API_KEY: "test-key",
    });
    const rows = [rootworm()];
    const svc = new AiRecommendationsService(env2, lib, fakeDb(rows));
    const generate = vi.fn(async (args: { contents: string }) => ({
      text: JSON.stringify({
        items: (JSON.parse(args.contents).items as Array<{ ref: string }>).map((i) => ({
          ref: i.ref,
          ...good(),
        })),
        watch: [],
      }),
      usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 1, thoughtsTokenCount: 0 },
    }));
    svc.gemini.client = { models: { generateContent: generate } } as never;
    await svc.enrich("f1", built, "2026-11-14");
    const first = rows[0]!.aiText as {
      model: string;
      promptVersion: string;
      safetyListVersion: string;
      hash: string;
    };
    expect(first.model).toBe(env2.GEMINI_MODEL);
    expect(first.promptVersion).toMatch(/^[0-9a-f]{12}$/);
    expect(first.safetyListVersion).toMatch(/^[0-9a-f]{12}$/);
    // Same facts and lists: no new call.
    await svc.enrich("f1", built, "2026-11-14");
    expect(generate).toHaveBeenCalledTimes(1);
    // A new name in actives.txt changes safetyListVersion, so the text is regenerated.
    appendFileSync(join(dir, "safety", "actives.txt"), "\nnewactivexyz\n");
    await svc.enrich("f1", built, "2026-11-14");
    expect(generate).toHaveBeenCalledTimes(2);
    const second = rows[0]!.aiText as { safetyListVersion: string; hash: string };
    expect(second.safetyListVersion).not.toBe(first.safetyListVersion);
    expect(second.hash).not.toBe(first.hash);
  });

  it("prompt versions are content hashes of the prompts", async () => {
    const { RECS_PROMPT_VERSION, SUMMARY_PROMPT_VERSION } = await import("./ai-text.js");
    const { promptVersionOf } = await import("../ai/trace.js");
    expect(RECS_PROMPT_VERSION).not.toBe(SUMMARY_PROMPT_VERSION);
    expect(promptVersionOf("a", { x: 1 })).toBe(promptVersionOf("a", { x: 1 }));
    expect(promptVersionOf("a", { x: 1 })).not.toBe(promptVersionOf("b", { x: 1 }));
  });
});
