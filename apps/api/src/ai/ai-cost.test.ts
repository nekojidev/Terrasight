import { describe, expect, it } from "vitest";
import { decodeCursor, encodeCursor } from "../reports/decisions.service.js";
import { decodeMessageCursor, encodeMessageCursor } from "../assistant/assistant.service.js";
import { loadEnv } from "../config/config.js";
import { retentionCutoffs } from "../retention/retention.service.js";
import { AiBudgetExceeded, AiBudgetService } from "./ai-budget.service.js";
import { TtlLru } from "./ttl-lru.js";

const env = (extra: Record<string, string> = {}) =>
  loadEnv({
    JWT_SECRET: "x".repeat(32),
    DATABASE_URL: "postgresql://u:p@localhost:5432/db",
    RABBITMQ_URL: "amqp://localhost",
    ...extra,
  });

describe("TtlLru", () => {
  it("evicts the least recently used entry past the bound", () => {
    const c = new TtlLru<number>(2, 1000);
    c.set("a", 1);
    c.set("b", 2);
    c.get("a"); // a is now the most recent
    c.set("c", 3);
    expect(c.get("b")).toBeUndefined();
    expect(c.get("a")).toBe(1);
    expect(c.size).toBe(2);
  });

  it("drops entries after the TTL", () => {
    let t = 0;
    const c = new TtlLru<number>(5, 100, () => t);
    c.set("a", 1);
    t = 99;
    expect(c.get("a")).toBe(1);
    t = 250;
    expect(c.get("a")).toBeUndefined();
    expect(c.age("a")).toBe(Infinity);
  });
});

describe("AiBudgetService (in-memory store)", () => {
  /** A Prisma stand-in that keeps the counters like the ai_usage upsert does. */
  const fake = () => {
    const rows = new Map<string, { tokens: bigint; calls: number }>();
    const prisma = {
      system: {
        $queryRaw: async (_s: TemplateStringsArray, day: string, tokens: number, calls: number) => {
          const r = rows.get(day) ?? { tokens: 0n, calls: 0 };
          r.tokens += BigInt(tokens);
          r.calls += calls;
          rows.set(day, r);
          return [{ ...r }];
        },
      },
    };
    return prisma as never;
  };

  it("is unlimited when both budgets are 0 (and never touches the store)", async () => {
    const b = new AiBudgetService(env(), null as never);
    await b.reserve();
    await b.record(10_000_000);
  });

  it("refuses calls past the call budget", async () => {
    const b = new AiBudgetService(env({ GEMINI_DAILY_CALL_BUDGET: "2" }), fake());
    await b.reserve();
    await b.reserve();
    await expect(b.reserve()).rejects.toBeInstanceOf(AiBudgetExceeded);
  });

  it("refuses once tokens reach the token budget, and resets the next UTC day", async () => {
    const b = new AiBudgetService(env({ GEMINI_DAILY_TOKEN_BUDGET: "1000" }), fake());
    const day = new Date("2026-11-15T10:00:00Z");
    await b.reserve(day);
    await b.record(1000, day);
    await expect(b.reserve(day)).rejects.toBeInstanceOf(AiBudgetExceeded);
    await b.reserve(new Date("2026-11-16T00:00:01Z"));
  });
});

describe("retention cutoffs", () => {
  it("applies the configured ages", () => {
    const now = new Date("2026-11-15T00:00:00Z");
    const c = retentionCutoffs(env(), now);
    expect(c.sourceCache.toISOString()).toBe("2026-11-07T00:00:00.000Z");
    expect(c.inputSnapshots.toISOString()).toBe("2026-08-17T00:00:00.000Z");
    expect(c.recommendationLevels.toISOString()).toBe("2026-05-19T00:00:00.000Z");
    expect(c.analysisRunFields.toISOString()).toBe("2026-08-17T00:00:00.000Z");
    expect(c.notifications.toISOString()).toBe("2026-08-17T00:00:00.000Z");
    expect(retentionCutoffs(env({ RETENTION_LEVEL_DAYS: "10" }), now).recommendationLevels.toISOString()).toBe(
      "2026-11-05T00:00:00.000Z",
    );
  });
});

describe("cursors", () => {
  const id = "11111111-1111-4111-8111-111111111111";
  it("round-trips and rejects garbage", () => {
    const at = new Date("2026-11-15T10:20:30.123Z");
    expect(decodeCursor(encodeCursor(at, id))).toEqual({ at: at.toISOString(), id });
    expect(decodeMessageCursor(encodeMessageCursor(at, id))).toEqual({ at, id });
    expect(() => decodeCursor("nonsense")).toThrow();
    expect(() => decodeMessageCursor(Buffer.from("x|y").toString("base64url"))).toThrow();
  });
});
