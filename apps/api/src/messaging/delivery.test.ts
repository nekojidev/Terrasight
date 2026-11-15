import { describe, expect, it, vi } from "vitest";
import { ATTEMPT_HEADER } from "./consumer.js";
import { MAX_REDELIVERIES, processDelivery, settle, type RawDelivery, type SettleChannel } from "./delivery.js";
import { FakeBroker } from "./fake-broker.js";
import { MessagingMaintenance } from "./maintenance.service.js";
import { EXCHANGES, QUEUES } from "./topology.js";
import type { Env } from "../config/config.js";
import type { OutboxService } from "./outbox.service.js";

/** A channel that records settlements; `closed` makes ack/nack throw like amqplib's IllegalOperationError. */
class FakeChannel implements SettleChannel {
  closed = false;
  acked: unknown[] = [];
  nacked: Array<{ msg: unknown; requeue: boolean | undefined }> = [];
  ack(msg: unknown): void {
    if (this.closed) throw new Error("Channel closed");
    this.acked.push(msg);
  }
  nack(msg: unknown, _all?: boolean, requeue?: boolean): void {
    if (this.closed) throw new Error("Channel closed");
    this.nacked.push({ msg, requeue });
  }
}

const log = () => ({ warn: vi.fn(), error: vi.fn() });
const body = { id: "11111111-1111-1111-1111-111111111111", type: "x", data: {} };
const raw = (over: { redelivered?: boolean; attempt?: number } = {}): RawDelivery => ({
  content: Buffer.from(JSON.stringify(body)),
  fields: { routingKey: QUEUES.fieldCheck, redelivered: over.redelivered ?? false },
  properties: { headers: over.attempt === undefined ? {} : { [ATTEMPT_HEADER]: over.attempt } },
});
const noRepublish = async () => undefined;

describe("consumer delivery on a flaky channel", () => {
  it("acks on success and nacks without requeue when the handler says dead", async () => {
    const ch = new FakeChannel();
    await processDelivery(ch, raw(), "q", async () => "ack", noRepublish, log());
    await processDelivery(ch, raw(), "q", async () => "dead", noRepublish, log());
    expect(ch.acked).toHaveLength(1);
    expect(ch.nacked).toEqual([expect.objectContaining({ requeue: false })]);
  });

  it("does not throw when the channel is already closed (no unhandled rejection)", async () => {
    const ch = new FakeChannel();
    ch.closed = true;
    const l = log();
    await expect(processDelivery(ch, raw(), "q", async () => "ack", noRepublish, l)).resolves.toBeUndefined();
    await expect(
      processDelivery(ch, raw(), "q", async () => {
        throw new Error("boom");
      }, noRepublish, l),
    ).resolves.toBeUndefined();
    expect(l.warn).toHaveBeenCalledTimes(2);
    expect(settle(ch, raw(), "dead", l)).toBe(false);
  });

  it("dead-letters a message whose handler throws instead of leaking the rejection", async () => {
    const ch = new FakeChannel();
    await processDelivery(ch, raw(), "q", async () => Promise.reject(new Error("boom")), noRepublish, log());
    expect(ch.nacked).toHaveLength(1);
    expect(ch.acked).toHaveLength(0);
  });

  it("re-queues a redelivered message with a persistent attempt counter instead of handling it", async () => {
    const ch = new FakeChannel();
    const broker = new FakeBroker();
    const handler = vi.fn(async () => "ack" as const);
    await processDelivery(
      ch,
      raw({ redelivered: true, attempt: 1 }),
      QUEUES.fieldCheck,
      handler,
      (e, k, b, o) => broker.publish(e, k, b, o),
      log(),
    );
    expect(handler).not.toHaveBeenCalled();
    expect(broker.published).toEqual([
      expect.objectContaining({
        exchange: EXCHANGES.retry,
        routingKey: QUEUES.fieldCheck,
        options: expect.objectContaining({ headers: { delay: "5s", [ATTEMPT_HEADER]: 2 } }),
      }),
    ]);
    expect(ch.acked).toHaveLength(1);
  });

  it("dead-letters a poison message after MAX_REDELIVERIES so it cannot crash-loop", async () => {
    const ch = new FakeChannel();
    const broker = new FakeBroker();
    const handler = vi.fn(async () => "ack" as const);
    const l = log();
    await processDelivery(
      ch,
      raw({ redelivered: true, attempt: MAX_REDELIVERIES }),
      "q",
      handler,
      (e, k, b, o) => broker.publish(e, k, b, o),
      l,
    );
    expect(handler).not.toHaveBeenCalled();
    expect(broker.published).toHaveLength(0);
    expect(ch.nacked).toEqual([expect.objectContaining({ requeue: false })]);
    expect(l.error).toHaveBeenCalled();
  });

  it("handles a redelivered message directly when it cannot be re-queued", async () => {
    const ch = new FakeChannel();
    const broker = new FakeBroker();
    broker.down = true;
    const handler = vi.fn(async () => "ack" as const);
    await processDelivery(ch, raw({ redelivered: true }), "q", handler, (e, k, b, o) => broker.publish(e, k, b, o), log());
    expect(handler).toHaveBeenCalledTimes(1);
    expect(ch.acked).toHaveLength(1);
  });
});

describe("dead-letter monitor", () => {
  const env = { ROLE: "all", NODE_ENV: "test" } as unknown as Env;

  it("records the depth of the dead queue and warns only when it is not empty", async () => {
    const broker = new FakeBroker();
    const m = new MessagingMaintenance(env, broker, {} as OutboxService);
    const warn = vi.spyOn((m as unknown as { log: { warn: () => void } }).log, "warn").mockImplementation(() => undefined);
    expect(await m.checkDeadLetters()).toBe(0);
    expect(warn).not.toHaveBeenCalled();
    broker.depths.set(QUEUES.dead, 3);
    expect(await m.checkDeadLetters()).toBe(3);
    expect(m.deadDepth).toBe(3);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("3 message"));
    broker.down = true;
    expect(await m.checkDeadLetters()).toBeNull();
  });

  it("purges through the outbox service and survives its failure", async () => {
    const purgePublished = vi.fn().mockResolvedValueOnce(5).mockRejectedValueOnce(new Error("db down"));
    const m = new MessagingMaintenance(env, new FakeBroker(), { purgePublished } as unknown as OutboxService);
    expect(await m.purgeOutbox()).toBe(5);
    expect(await m.purgeOutbox()).toBe(0);
  });
});
