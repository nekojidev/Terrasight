import { describe, expect, it, vi } from "vitest";
import { AiBudgetExceeded } from "../ai/ai-budget.service.js";
import { AssistantService, UNAVAILABLE } from "./assistant.service.js";

type Update = { data: Record<string, unknown> };

describe("assistant turns count against the daily Gemini budget", () => {
  const scope = { workspaceId: "w1", userId: "u1", role: "owner", lang: "en" as const };

  function harness(opts: { reserve: () => Promise<void>; responses: unknown[] }) {
    const updates: Update[] = [];
    const tx = { message: { update: async (a: Update) => updates.push(a) }, toolCall: { createMany: async () => ({}) } };
    const prisma = {
      system: {
        message: { findMany: async () => [] },
        workspace: { findUniqueOrThrow: async () => ({ timeZone: "UTC" }) },
        $transaction: async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx),
      },
    };
    const calls: unknown[] = [];
    const recorded: number[] = [];
    const reserve = vi.fn(opts.reserve);
    const budget = { reserve, record: async (n: number) => void recorded.push(n) };
    const executor = {
      aliases: async () => new Map([["F1", { id: "f1", name: "Pivot 12" }]]),
      run: async () => ({ field: "F1", rain: { value: 5, unit: "mm" } }),
    };
    const svc = new AssistantService(
      { GEMINI_API_KEY: "", GEMINI_MODEL: "m", DATA_DIR: "/nonexistent", NODE_ENV: "test" } as never,
      prisma as never,
      { add: async () => undefined } as never,
      {} as never,
      {} as never,
      executor as never,
      budget as never,
    );
    const queue = [...opts.responses];
    (svc as unknown as { ai: unknown }).ai = {
      models: {
        generateContent: async (req: unknown) => {
          calls.push(req);
          return queue.shift();
        },
      },
    };
    return { svc, updates, calls, recorded, reserve };
  }

  const toolStep = (usage: Record<string, number>) => ({
    functionCalls: [{ name: "get_brief", args: {} }],
    candidates: [{ content: { role: "model", parts: [] } }],
    usageMetadata: usage,
  });

  it("budget spent: no Gemini call, the existing 'unavailable' path", async () => {
    const h = harness({ reserve: () => Promise.reject(new AiBudgetExceeded("token")), responses: [] });
    await h.svc.turn(scope, "c1", "m1", "How is F1?", {});
    expect(h.calls).toHaveLength(0);
    expect(h.updates.at(-1)?.data).toMatchObject({ text: "", checked: false, error: UNAVAILABLE.en });
  });

  it("budget spent after a tool ran: shows the data directly, no further call", async () => {
    let n = 0;
    const h = harness({
      reserve: async () => {
        if (++n > 1) throw new AiBudgetExceeded("call");
      },
      responses: [toolStep({ promptTokenCount: 10, candidatesTokenCount: 2 })],
    });
    await h.svc.turn(scope, "c1", "m1", "How is F1?", {});
    expect(h.calls).toHaveLength(1);
    expect(h.updates.at(-1)?.data).toMatchObject({ text: "Showing the data directly.", fallback: true, checked: false });
  });

  it("reserves before and records the real token usage of every call", async () => {
    const h = harness({
      reserve: async () => undefined,
      responses: [
        toolStep({ promptTokenCount: 100, candidatesTokenCount: 20, thoughtsTokenCount: 5 }),
        { text: "It rained 5 mm.", functionCalls: [], usageMetadata: { promptTokenCount: 150, candidatesTokenCount: 10 } },
      ],
    });
    await h.svc.turn(scope, "c1", "m1", "How is F1?", {});
    expect(h.reserve).toHaveBeenCalledTimes(2);
    expect(h.recorded).toEqual([125, 160]);
    expect(h.updates.at(-1)?.data).toMatchObject({ checked: true });
  });
});
