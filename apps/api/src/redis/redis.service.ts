import { Inject, Injectable, Logger, type OnModuleDestroy } from "@nestjs/common";
import { Redis } from "ioredis";
import { ENV, type Env } from "../config/config.js";

/**
 * Redis is optional (RFC §5.2). Callers must check `available` and use their in-process fallback when it is
 * false: hot cache → miss, rate limits → half-rate local bucket, revocation cache → PostgreSQL.
 */
@Injectable()
export class RedisService implements OnModuleDestroy {
  private readonly log = new Logger(RedisService.name);
  readonly client: Redis | null;
  private healthy = false;

  constructor(@Inject(ENV) env: Env) {
    if (!env.REDIS_URL) {
      this.client = null;
      this.log.warn("REDIS_URL not set: running on in-process fallbacks (RFC §5.2)");
      return;
    }
    this.client = new Redis(env.REDIS_URL, {
      lazyConnect: false,
      maxRetriesPerRequest: 1,
      enableOfflineQueue: false,
    });
    this.client.on("ready", () => {
      this.healthy = true;
      this.log.log("Redis connected");
    });
    const lost = () => {
      if (this.healthy) this.log.warn("Redis unavailable: using in-process fallbacks");
      this.healthy = false;
    };
    this.client.on("error", lost);
    this.client.on("close", lost);
    this.client.on("end", lost);
  }

  get available(): boolean {
    return this.client !== null && this.healthy;
  }

  async onModuleDestroy(): Promise<void> {
    this.client?.disconnect();
  }
}
