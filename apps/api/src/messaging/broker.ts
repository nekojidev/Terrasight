/**
 * The publishing / consuming surface the app needs from RabbitMQ. `RabbitService` implements it over
 * amqplib; unit tests use `FakeBroker` (test/fake-broker.ts).
 */
export interface PublishOptions {
  messageId: string;
  headers?: Record<string, unknown>;
  persistent?: boolean;
}

export interface IncomingMessage {
  content: Buffer;
  routingKey: string;
  headers: Record<string, unknown>;
}

export type ConsumeHandler = (msg: IncomingMessage) => Promise<"ack" | "dead">;

export interface Broker {
  /** Resolves once the broker confirmed the message; rejects when it can't be published. */
  publish(exchange: string, routingKey: string, body: unknown, options: PublishOptions): Promise<void>;
  consume(queue: string, prefetch: number, handler: ConsumeHandler): Promise<void>;
  /** Exclusive, auto-delete queue bound to `exchange` with `pattern`; used by the SSE stream. */
  subscribe(exchange: string, pattern: string, handler: (msg: IncomingMessage) => void): Promise<void>;
  /** Messages waiting in `queue`; null when unknown (disconnected). */
  queueDepth(queue: string): Promise<number | null>;
  readonly connected: boolean;
}

export const BROKER = Symbol("BROKER");
