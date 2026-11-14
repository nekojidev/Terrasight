/**
 * RabbitMQ topology (Tech Design §7). Declared idempotently at start-up.
 *
 * Retries and delays use a headers exchange: a message is published to `terrasight.retry` with the target
 * queue as routing key and a `delay` header (`5s`, `30s`, `8s`; not `x-` prefixed, because headers exchanges ignore `x-` headers when matching). The matching TTL queue holds it, then
 * dead-letters it back to `terrasight.jobs` with the original routing key, i.e. into the target queue.
 */
export const EXCHANGES = {
  jobs: "terrasight.jobs",
  retry: "terrasight.retry",
  dlx: "terrasight.dlx",
  events: "terrasight.events",
} as const;

export const QUEUES = {
  gatherField: "gather.field",
  gatherSource: "gather.source",
  historyBuild: "history.build",
  scenariosRun: "scenarios.run",
  fieldCheck: "field.check",
  recommendationCommit: "recommendation.commit",
  dead: "dead",
} as const;

export type JobQueue = Exclude<(typeof QUEUES)[keyof typeof QUEUES], "dead">;

export const DELAYS = { "5s": 5_000, "30s": 30_000, "8s": 8_000 } as const;
export type Delay = keyof typeof DELAYS;

/** Retry delays per attempt: 1st retry after 5 s, 2nd after 30 s (Tech Design §7). */
export const RETRY_DELAYS: Delay[] = ["5s", "30s"];

/** Minimal channel surface we use; amqplib's ConfirmChannel satisfies it, and tests use a fake. */
export interface TopologyChannel {
  assertExchange(name: string, type: string, options: { durable: boolean }): Promise<unknown>;
  assertQueue(name: string, options: Record<string, unknown>): Promise<unknown>;
  bindQueue(
    queue: string,
    exchange: string,
    pattern: string,
    args?: Record<string, unknown>,
  ): Promise<unknown>;
}

export async function declareTopology(ch: TopologyChannel): Promise<void> {
  await ch.assertExchange(EXCHANGES.jobs, "direct", { durable: true });
  await ch.assertExchange(EXCHANGES.retry, "headers", { durable: true });
  await ch.assertExchange(EXCHANGES.dlx, "fanout", { durable: true });
  await ch.assertExchange(EXCHANGES.events, "topic", { durable: true });

  for (const queue of Object.values(QUEUES)) {
    if (queue === QUEUES.dead) continue;
    await ch.assertQueue(queue, { durable: true, arguments: { "x-dead-letter-exchange": EXCHANGES.dlx } });
    await ch.bindQueue(queue, EXCHANGES.jobs, queue);
  }

  await ch.assertQueue(QUEUES.dead, { durable: true });
  await ch.bindQueue(QUEUES.dead, EXCHANGES.dlx, "");

  for (const [delay, ms] of Object.entries(DELAYS)) {
    const name = delay === "8s" ? "commit.8s" : `retry.${delay}`;
    await ch.assertQueue(name, {
      durable: true,
      arguments: { "x-message-ttl": ms, "x-dead-letter-exchange": EXCHANGES.jobs },
    });
    await ch.bindQueue(name, EXCHANGES.retry, "", { "x-match": "all", delay });
  }
}
