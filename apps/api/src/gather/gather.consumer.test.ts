import { SourceError, type FieldGeometry, type SourceAdapter } from "@terrasight/sources";
import { describe, expect, it, vi } from "vitest";
import { envelope } from "../messaging/outbox.js";
import { FakeBroker } from "../messaging/fake-broker.js";
import { CircuitBreaker } from "../sources/circuit-breaker.js";
import { GatherSourceConsumer, MAX_PAUSES, type GatherSourceJob } from "./gather.consumer.js";

const field = { polygons: [], centroid: { lon: 32, lat: 49 }, bbox: [0, 0, 0, 0], country: "UA" } as FieldGeometry;

function setup(opts: { fixture?: unknown } = {}) {
  const broker = new FakeBroker();
  const breaker = new CircuitBreaker({ threshold: 2, cooldownMs: 30_000 });
  const fetchSoil = vi.fn(async () => ({
    status: "done" as const,
    payload: { clayPct: 30 },
    dataDate: null,
    attribution: "x",
  }));
  const adapter = { id: "soilgrids", fetch: fetchSoil } as unknown as SourceAdapter;
  const sources = {
    adapter: () => adapter,
    key: () => "k",
    cached: async () => null,
    fixture: () => opts.fixture ?? null,
    store: vi.fn(async () => undefined),
    breaker,
  };
  const updates: Array<Record<string, unknown>> = [];
  const finished: Array<Record<string, unknown>> = [];
  const prisma = {
    system: {
      gatherTask: {
        findUnique: async () => ({ status: "queued" }),
        update: async (a: { data: Record<string, unknown> }) => void updates.push(a.data),
        findMany: async () => [],
      },
      gatherJob: { updateMany: async () => ({ count: 0 }) },
      $transaction: async (fn: (tx: unknown) => Promise<void>) =>
        fn({
          $queryRaw: async () => [],
          $executeRaw: async () => 0,
          gatherTask: {
            update: async (a: { data: Record<string, unknown> }) => void finished.push(a.data),
            findMany: async () => [{ source: "soilgrids", status: "failed" }],
          },
          gatherJob: { updateMany: async () => ({ count: 0 }) },
        }),
    },
  };
  const outbox = { add: vi.fn(async () => undefined) };
  const consumer = new GatherSourceConsumer(
    broker,
    { FIXTURES_DIR: "x" } as never,
    prisma as never,
    { fieldGeometry: async () => field } as never,
    sources as never,
    outbox as never,
    { takeWithin: async () => undefined } as never,
  );
  const job = (data: Partial<GatherSourceJob> = {}) =>
    envelope<GatherSourceJob>("gather.source", "w1", {
      jobId: "j1",
      fieldId: "f1",
      source: "soilgrids",
      ...data,
    });
  return { broker, breaker, fetchSoil, consumer, updates, finished, job };
}

const openBreaker = (b: CircuitBreaker) => {
  b.failure("soilgrids");
  b.failure("soilgrids");
};

describe("gather task with a paused source", () => {
  it("requeues with a delay and says 'temporarily unavailable, retrying' instead of failing", async () => {
    const t = setup();
    openBreaker(t.breaker);
    await t.consumer.handle(t.job(), 0);
    expect(t.fetchSoil).not.toHaveBeenCalled();
    expect(t.finished).toHaveLength(0); // not ended as failed
    expect(t.updates.at(-1)).toMatchObject({
      status: "queued",
      error: "SoilGrids is temporarily unavailable, retrying",
    });
    const sent = t.broker.published.at(-1)!;
    expect(sent.exchange).toBe("terrasight.retry");
    expect(sent.routingKey).toBe("gather.source");
    expect(sent.options.headers).toMatchObject({ delay: "30s" });
    expect((sent.body as { data: GatherSourceJob }).data.pauses).toBe(1);
  });

  it("gives up with a plain reason after MAX_PAUSES requeues", async () => {
    const t = setup();
    openBreaker(t.breaker);
    await t.consumer.handle(t.job({ pauses: MAX_PAUSES }), 0);
    expect(t.broker.published).toHaveLength(0);
    expect(t.finished.at(-1)).toMatchObject({
      status: "failed",
      error: "SoilGrids is still unavailable after several tries, soil data missing",
    });
  });

  it("a recorded fixture wins over waiting", async () => {
    const t = setup({ fixture: { status: "done", payload: { clayPct: 1 }, dataDate: null, attribution: "f" } });
    openBreaker(t.breaker);
    await t.consumer.handle(t.job(), 0);
    expect(t.broker.published).toHaveLength(0);
    expect(t.finished.at(-1)).toMatchObject({ status: "cached" });
  });

  it("a manual retry (probe) bypasses the pause and closes the circuit on success", async () => {
    const t = setup();
    openBreaker(t.breaker);
    await t.consumer.handle(t.job({ probe: true }), 0);
    expect(t.fetchSoil).toHaveBeenCalledTimes(1);
    expect(t.breaker.isOpen("soilgrids")).toBe(false);
    expect(t.finished.at(-1)).toMatchObject({ status: "done" });
  });

  it("a successful fallback result does not count as a breaker failure", async () => {
    const t = setup();
    for (let i = 0; i < 5; i++) await t.consumer.handle(t.job(), 0);
    expect(t.breaker.isOpen("soilgrids")).toBe(false);
    expect(t.fetchSoil).toHaveBeenCalledTimes(5);
  });

  it("a real failure still counts", async () => {
    const t = setup();
    t.fetchSoil.mockRejectedValue(new SourceError("responded 503", true));
    await expect(t.consumer.handle(t.job(), 0)).rejects.toThrow("503");
    await expect(t.consumer.handle(t.job(), 0)).rejects.toThrow("503");
    expect(t.breaker.isOpen("soilgrids")).toBe(true);
  });
});
