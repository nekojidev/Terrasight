import type { Envelope } from "@terrasight/shared";
import { describe, expect, it } from "vitest";
import { ATTEMPT_HEADER, JobConsumer } from "./consumer.js";
import { FakeBroker } from "./fake-broker.js";
import { envelope, jobRow } from "./outbox.js";
import { relayOnce, type OutboxStore, type PendingRow } from "./outbox-relay.js";
import { declareTopology, EXCHANGES, QUEUES, type TopologyChannel } from "./topology.js";

// ---------- outbox relay ----------

class MemoryOutbox implements OutboxStore {
  rows: Array<PendingRow & { publishedAt: Date | null }> = [];
  add(n: number) {
    for (let i = 0; i < n; i++) {
      const row = jobRow(QUEUES.gatherField, null, { i });
      this.rows.push({
        id: BigInt(this.rows.length + 1),
        ...row,
        headers: row.headers ?? null,
        publishedAt: null,
      });
    }
  }
  async withPending(limit: number, fn: (rows: PendingRow[]) => Promise<bigint[]>): Promise<number> {
    const pending = this.rows.filter((r) => !r.publishedAt).slice(0, limit);
    const done = await fn(pending);
    for (const r of this.rows) if (done.includes(r.id)) r.publishedAt = new Date();
    return done.length;
  }
}

describe("outbox relay (Tech Design §7)", () => {
  it("publishes pending rows in order and marks them", async () => {
    const store = new MemoryOutbox();
    const broker = new FakeBroker();
    store.add(3);
    expect(await relayOnce(store, broker)).toBe(3);
    expect(broker.published.map((p) => (p.body as Envelope<{ i: number }>).data.i)).toEqual([0, 1, 2]);
    expect(store.rows.every((r) => r.publishedAt)).toBe(true);
  });

  it("loses nothing while the broker is down and publishes the backlog once it is back", async () => {
    const store = new MemoryOutbox();
    const broker = new FakeBroker();
    store.add(2);
    broker.down = true;
    expect(await relayOnce(store, broker)).toBe(0);
    store.add(2);
    broker.down = false;
    expect(await relayOnce(store, broker)).toBe(4);
    expect(await relayOnce(store, broker)).toBe(0);
    expect(broker.published).toHaveLength(4);
    expect(new Set(broker.published.map((p) => p.options.messageId)).size).toBe(4);
  });

  it("stops at the first failure so order is kept", async () => {
    const store = new MemoryOutbox();
    const broker = new FakeBroker();
    store.add(3);
    broker.failOn = 2;
    expect(await relayOnce(store, broker)).toBe(1);
    expect(store.rows.map((r) => Boolean(r.publishedAt))).toEqual([true, false, false]);
  });

  it("routes delayed jobs through the retry exchange with a delay header", () => {
    const row = jobRow(QUEUES.recommendationCommit, "ws", { id: "r1" }, "8s");
    expect(row).toMatchObject({
      exchange: EXCHANGES.retry,
      routingKey: "recommendation.commit",
      headers: { delay: "8s" },
    });
  });
});

// ---------- consumer base ----------

class TestConsumer extends JobConsumer<{ fail: number }> {
  calls = 0;
  constructor(broker: FakeBroker) {
    super(broker, { queue: QUEUES.gatherSource, prefetch: 1, retries: 2 });
  }
  async handle(env: Envelope<{ fail: number }>, attempt: number): Promise<void> {
    this.calls += 1;
    if (attempt < env.data.fail) throw new Error("boom");
  }
}

const msg = (body: unknown, attempt?: number) => ({
  content: Buffer.from(JSON.stringify(body)),
  routingKey: "gather.source",
  headers: attempt === undefined ? {} : { [ATTEMPT_HEADER]: attempt },
});

describe("JobConsumer (Tech Design §7)", () => {
  it("acks a successful message", async () => {
    const c = new TestConsumer(new FakeBroker());
    expect(await c.onMessage(msg(envelope("t", null, { fail: 0 })))).toBe("ack");
  });

  it("dead-letters malformed messages without retrying", async () => {
    const broker = new FakeBroker();
    const c = new TestConsumer(broker);
    expect(await c.onMessage({ ...msg({}), content: Buffer.from("not json") })).toBe("dead");
    expect(broker.published).toHaveLength(0);
  });

  it("retries with 5 s then 30 s delays, then dead-letters", async () => {
    const broker = new FakeBroker();
    const c = new TestConsumer(broker);
    const env = envelope("t", null, { fail: 99 });
    expect(await c.onMessage(msg(env))).toBe("ack");
    expect(await c.onMessage(msg(env, 1))).toBe("ack");
    expect(await c.onMessage(msg(env, 2))).toBe("dead");
    expect(broker.published.map((p) => p.options.headers)).toEqual([
      { delay: "5s", [ATTEMPT_HEADER]: 1 },
      { delay: "30s", [ATTEMPT_HEADER]: 2 },
    ]);
    expect(
      broker.published.every((p) => p.exchange === EXCHANGES.retry && p.routingKey === "gather.source"),
    ).toBe(true);
  });
});

// ---------- topology ----------

describe("declareTopology", () => {
  it("declares every exchange, queue and delay binding", async () => {
    const calls: string[] = [];
    const ch: TopologyChannel = {
      assertExchange: async (n, t) => calls.push(`x:${n}:${t}`),
      assertQueue: async (n, o) => calls.push(`q:${n}:${JSON.stringify(o.arguments ?? {})}`),
      bindQueue: async (q, x, p, a) => calls.push(`b:${q}->${x}:${p}:${JSON.stringify(a ?? {})}`),
    };
    await declareTopology(ch);
    expect(calls).toContain("x:terrasight.retry:headers");
    expect(calls).toContain("x:terrasight.events:topic");
    expect(calls).toContain('b:commit.8s->terrasight.retry::{"x-match":"all","delay":"8s"}');
    expect(
      calls.filter((c) => c.startsWith("q:") && c.includes('"x-dead-letter-exchange":"terrasight.dlx"')),
    ).toHaveLength(7);
    expect(calls.some((c) => c.startsWith("q:retry.30s:") && c.includes('"x-message-ttl":30000'))).toBe(true);
  });
});
