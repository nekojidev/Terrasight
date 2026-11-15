import { Inject, Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from "@nestjs/common";
import { ENV, runsScheduler, type Env } from "../config/config.js";
import { BROKER, type Broker } from "./broker.js";
import { OutboxService } from "./outbox.service.js";
import { QUEUES } from "./topology.js";

const DEAD_LETTER_TICK_MS = 60_000;
const OUTBOX_PURGE_TICK_MS = 24 * 3600_000;

/**
 * Housekeeping for the messaging layer (scheduler role): a daily purge of published outbox rows older than
 * 7 days, and a periodic look at the dead-letter queue (warn when it is not empty).
 */
@Injectable()
export class MessagingMaintenance implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger(MessagingMaintenance.name);
  private readonly timers: NodeJS.Timeout[] = [];
  /** Last observed depth of the `dead` queue; null until the first successful check. */
  deadDepth: number | null = null;

  constructor(
    @Inject(ENV) private readonly env: Env,
    @Inject(BROKER) private readonly broker: Broker,
    private readonly outbox: OutboxService,
  ) {}

  onModuleInit(): void {
    if (!runsScheduler(this.env) || this.env.NODE_ENV === "test") return;
    this.timers.push(
      setInterval(() => void this.checkDeadLetters(), DEAD_LETTER_TICK_MS),
      setInterval(() => void this.purgeOutbox(), OUTBOX_PURGE_TICK_MS),
      setTimeout(() => void this.checkDeadLetters(), 15_000),
      setTimeout(() => void this.purgeOutbox(), 60_000),
    );
    for (const t of this.timers) t.unref();
  }

  onModuleDestroy(): void {
    for (const t of this.timers) clearTimeout(t);
  }

  /** Logs and records the dead-letter queue depth; returns it (null when the broker is unreachable). */
  async checkDeadLetters(): Promise<number | null> {
    try {
      const depth = await this.broker.queueDepth(QUEUES.dead);
      this.deadDepth = depth;
      if (depth) this.log.warn(`dead-letter queue holds ${depth} message(s); inspect the "dead" queue`);
      return depth;
    } catch (e) {
      this.log.warn(`dead-letter check failed: ${(e as Error).message}`);
      return null;
    }
  }

  async purgeOutbox(now = new Date()): Promise<number> {
    try {
      const n = await this.outbox.purgePublished(now);
      if (n) this.log.log(`deleted ${n} published outbox row(s) older than 7 days`);
      return n;
    } catch (e) {
      this.log.warn(`outbox purge failed: ${(e as Error).message}`);
      return 0;
    }
  }
}
