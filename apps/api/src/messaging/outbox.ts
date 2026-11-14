import { randomUUID } from "node:crypto";
import type { Envelope } from "@terrasight/shared";
import { EXCHANGES, type Delay, type JobQueue } from "./topology.js";

/** One row to insert into `outbox` in the same transaction as the business change (Tech Design §7). */
export interface OutboxRow {
  exchange: string;
  routingKey: string;
  payload: Envelope;
  headers?: Record<string, unknown> | null;
}

export function envelope<T>(type: string, workspaceId: string | null, data: T): Envelope<T> {
  return { id: randomUUID(), type, occurredAt: new Date().toISOString(), workspaceId, data };
}

/** A job for a work queue, optionally delayed (e.g. the 8 s commit, RFC §10.4). */
export function jobRow<T>(queue: JobQueue, workspaceId: string | null, data: T, delay?: Delay): OutboxRow {
  return delay
    ? {
        exchange: EXCHANGES.retry,
        routingKey: queue,
        payload: envelope(queue, workspaceId, data),
        headers: { delay },
      }
    : { exchange: EXCHANGES.jobs, routingKey: queue, payload: envelope(queue, workspaceId, data) };
}

/** An event on the topic exchange (progress, state changes). */
export function eventRow<T>(routingKey: string, type: string, workspaceId: string, data: T): OutboxRow {
  return { exchange: EXCHANGES.events, routingKey, payload: envelope(type, workspaceId, data) };
}
