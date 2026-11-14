import type { Broker, ConsumeHandler, IncomingMessage, PublishOptions } from "./broker.js";

export interface Published {
  exchange: string;
  routingKey: string;
  body: unknown;
  options: PublishOptions;
}

/** In-memory Broker for unit tests. `down = true` makes publishes fail like a lost connection. */
export class FakeBroker implements Broker {
  readonly published: Published[] = [];
  readonly handlers = new Map<string, ConsumeHandler>();
  readonly subscribers: Array<{ pattern: string; handler: (msg: IncomingMessage) => void }> = [];
  down = false;
  /** Fail only the n-th publish (1-based), to test partial batches. */
  failOn: number | null = null;
  private count = 0;

  get connected(): boolean {
    return !this.down;
  }

  async publish(exchange: string, routingKey: string, body: unknown, options: PublishOptions): Promise<void> {
    this.count += 1;
    if (this.down || this.failOn === this.count) throw new Error("broker down");
    this.published.push({ exchange, routingKey, body, options });
  }

  async consume(queue: string, _prefetch: number, handler: ConsumeHandler): Promise<void> {
    this.handlers.set(queue, handler);
  }

  async subscribe(
    _exchange: string,
    pattern: string,
    handler: (msg: IncomingMessage) => void,
  ): Promise<void> {
    this.subscribers.push({ pattern, handler });
  }
}
