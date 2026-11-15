import type { ConsumeHandler, IncomingMessage } from "./broker.js";
import { ATTEMPT_HEADER } from "./consumer.js";
import { EXCHANGES } from "./topology.js";

/** A message delivered more often than this after a crash or lost channel is dead-lettered (poison message guard). */
export const MAX_REDELIVERIES = 3;

/** The slice of an amqplib message we read. */
export interface RawDelivery {
  content: Buffer;
  fields: { routingKey: string; redelivered?: boolean };
  properties: { headers?: Record<string, unknown> | null };
}

/** The slice of an amqplib channel used to settle a delivery; tests use a fake. */
export interface SettleChannel {
  ack(msg: never): void;
  nack(msg: never, allUpTo?: boolean, requeue?: boolean): void;
}

export interface DeliveryLogger {
  warn(message: string): void;
  error(message: string): void;
}

export type RetryPublisher = (
  exchange: string,
  routingKey: string,
  body: unknown,
  options: { messageId: string; headers: Record<string, unknown> },
) => Promise<void>;

/**
 * Settles a delivery without ever throwing: on a closed channel `ack`/`nack` throw synchronously
 * (IllegalOperationError), which inside a promise callback would be an unhandled rejection. The broker
 * redelivers unacked messages when the channel is gone, so swallowing here loses nothing.
 */
export function settle(
  ch: SettleChannel,
  raw: RawDelivery,
  verdict: "ack" | "dead",
  log: DeliveryLogger,
): boolean {
  try {
    if (verdict === "ack") ch.ack(raw as never);
    else ch.nack(raw as never, false, false);
    return true;
  } catch (e) {
    log.warn(
      `could not ${verdict === "ack" ? "ack" : "nack"} a message (channel closed?): ${(e as Error).message}`,
    );
    return false;
  }
}

/**
 * One delivery, end to end (Tech Design §7):
 * - a redelivered message (broker flag: a worker died or the channel dropped before the ack) gets a persistent
 *   attempt counter by being republished through the retry exchange with `x-attempt` + 1; past
 *   MAX_REDELIVERIES it is dead-lettered, so a message that kills its worker cannot crash-loop;
 * - the handler's verdict, or any exception it leaks, is settled safely.
 */
export async function processDelivery(
  ch: SettleChannel,
  raw: RawDelivery,
  queue: string,
  handler: ConsumeHandler,
  republish: RetryPublisher,
  log: DeliveryLogger,
): Promise<void> {
  const headers = (raw.properties.headers ?? {}) as Record<string, unknown>;
  const attempt = Number(headers[ATTEMPT_HEADER] ?? 0);
  if (raw.fields.redelivered) {
    if (attempt >= MAX_REDELIVERIES) {
      log.error(`message on ${queue} redelivered ${attempt} times; dead-lettering it`);
      settle(ch, raw, "dead", log);
      return;
    }
    try {
      const body = JSON.parse(raw.content.toString("utf8")) as { id?: string };
      await republish(EXCHANGES.retry, queue, body, {
        messageId: String(body.id ?? ""),
        headers: { delay: "5s", [ATTEMPT_HEADER]: attempt + 1 },
      });
      log.warn(`redelivered message on ${queue} re-queued with attempt ${attempt + 1}`);
      settle(ch, raw, "ack", log);
      return;
    } catch {
      // Could not re-queue (broker busy, malformed body): handle it now; the handler validates the envelope.
    }
  }
  const msg: IncomingMessage = { content: raw.content, routingKey: raw.fields.routingKey, headers };
  let verdict: "ack" | "dead";
  try {
    verdict = await handler(msg);
  } catch (e) {
    log.error(`handler for ${queue} threw: ${(e as Error).message}`);
    verdict = "dead";
  }
  settle(ch, raw, verdict, log);
}
