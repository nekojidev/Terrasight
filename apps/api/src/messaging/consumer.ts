import { Logger } from "@nestjs/common";
import { Envelope } from "@terrasight/shared";
import type { Broker, IncomingMessage } from "./broker.js";
import { captureException } from "../observability/sentry.js";
import { EXCHANGES, RETRY_DELAYS, type JobQueue } from "./topology.js";

export const ATTEMPT_HEADER = "x-attempt";

export interface ConsumerOptions {
  queue: JobQueue;
  prefetch: number;
  /** Retries after the first failure (Tech Design §7: 2 for most queues). */
  retries: number;
}

/**
 * Base class for job consumers (Tech Design §7):
 * - parses and validates the envelope (malformed messages go straight to `dead`);
 * - on failure republishes with a delay (5 s, then 30 s) and an incremented attempt header;
 * - after the last retry, dead-letters the message.
 * Subclasses must be idempotent: check state in PostgreSQL before acting, using `envelope.id`.
 */
export abstract class JobConsumer<T = unknown> {
  protected readonly log: Logger;

  protected constructor(
    protected readonly broker: Broker,
    protected readonly options: ConsumerOptions,
  ) {
    this.log = new Logger(`${this.constructor.name}(${options.queue})`);
  }

  abstract handle(envelope: Envelope<T>, attempt: number): Promise<void>;

  async start(): Promise<void> {
    await this.broker.consume(this.options.queue, this.options.prefetch, (msg) => this.onMessage(msg));
  }

  /** Exposed for tests. */
  async onMessage(msg: IncomingMessage): Promise<"ack" | "dead"> {
    let env: Envelope<T>;
    try {
      env = Envelope.parse(JSON.parse(msg.content.toString("utf8"))) as Envelope<T>;
    } catch (e) {
      this.log.error(`Malformed message on ${this.options.queue}: ${(e as Error).message}`);
      return "dead";
    }
    const attempt = Number(msg.headers[ATTEMPT_HEADER] ?? 0);
    try {
      await this.handle(env, attempt);
      return "ack";
    } catch (e) {
      const err = e as Error;
      if (attempt >= this.options.retries) {
        this.log.error(`${env.type} ${env.id} failed after ${attempt + 1} attempts: ${err.message}`);
        captureException(err, {
          queue: this.options.queue,
          jobType: env.type,
          jobId: env.id,
          attempts: attempt + 1,
        });
        return "dead";
      }
      const delay = RETRY_DELAYS[Math.min(attempt, RETRY_DELAYS.length - 1)] ?? "30s";
      this.log.warn(
        `${env.type} ${env.id} failed (attempt ${attempt + 1}), retry in ${delay}: ${err.message}`,
      );
      try {
        await this.broker.publish(EXCHANGES.retry, this.options.queue, env, {
          messageId: env.id,
          headers: { delay, [ATTEMPT_HEADER]: attempt + 1 },
        });
        return "ack";
      } catch {
        return "dead";
      }
    }
  }
}
