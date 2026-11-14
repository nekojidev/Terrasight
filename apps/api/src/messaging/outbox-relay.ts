import type { Envelope } from "@terrasight/shared";
import type { Broker } from "./broker.js";

export interface PendingRow {
  id: bigint;
  exchange: string;
  routingKey: string;
  payload: Envelope;
  headers: Record<string, unknown> | null;
}

/** Storage side of the outbox; implemented with PostgreSQL (`FOR UPDATE SKIP LOCKED`) and faked in tests. */
export interface OutboxStore {
  /** Runs `fn` over the oldest unpublished rows, locked for this relay; rows it returns ids for are marked published. */
  withPending(limit: number, fn: (rows: PendingRow[]) => Promise<bigint[]>): Promise<number>;
}

/**
 * Publishes outbox rows in id order and marks them published (Tech Design §7). Stops at the first failure
 * so order is kept; the rest stay pending and go out on the next tick, e.g. after RabbitMQ comes back.
 */
export async function relayOnce(store: OutboxStore, broker: Broker, limit = 100): Promise<number> {
  return store.withPending(limit, async (rows) => {
    const done: bigint[] = [];
    for (const row of rows) {
      try {
        await broker.publish(row.exchange, row.routingKey, row.payload, {
          messageId: row.payload.id,
          headers: row.headers ?? undefined,
        });
        done.push(row.id);
      } catch {
        break;
      }
    }
    return done;
  });
}
