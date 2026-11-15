import { Inject, Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from "@nestjs/common";
import { ENV, runsScheduler, type Env } from "../config/config.js";
import { PrismaService } from "../db/prisma.service.js";
import type { Prisma } from "../generated/prisma/client.js";

/** Arbitrary constant for the retention advisory lock: only one instance prunes at a time. */
export const RETENTION_LOCK_ID = 6_0301;
const BATCH = 5_000;
const TICK_MS = 10 * 60_000;
/** The daily pass starts after this UTC hour (quiet time for the demo regions). */
export const RETENTION_HOUR_UTC = 3;
const DONE_KEY = "retention:last-run";

export interface RetentionCounts {
  sourceCache: number;
  inputSnapshots: number;
  recommendationLevels: number;
  analysisRunFields: number;
  notifications: number;
  aiRotationProposals: number;
  aiUsage: number;
}

export interface RetentionCutoffs {
  sourceCache: Date;
  inputSnapshots: Date;
  recommendationLevels: Date;
  analysisRunFields: Date;
  notifications: Date;
}

const DAY = 864e5;

/** The timestamps before which rows are pruned, from the RETENTION_* settings. */
export function retentionCutoffs(
  env: Pick<
    Env,
    | "RETENTION_SOURCE_CACHE_DAYS"
    | "RETENTION_INPUT_SNAPSHOT_DAYS"
    | "RETENTION_LEVEL_DAYS"
    | "RETENTION_RUN_FIELD_DAYS"
    | "RETENTION_NOTIFICATION_DAYS"
  >,
  now = new Date(),
): RetentionCutoffs {
  const ago = (days: number) => new Date(now.getTime() - days * DAY);
  return {
    sourceCache: ago(env.RETENTION_SOURCE_CACHE_DAYS),
    inputSnapshots: ago(env.RETENTION_INPUT_SNAPSHOT_DAYS),
    recommendationLevels: ago(env.RETENTION_LEVEL_DAYS),
    analysisRunFields: ago(env.RETENTION_RUN_FIELD_DAYS),
    notifications: ago(env.RETENTION_NOTIFICATION_DAYS),
  };
}

/**
 * Daily pruning of data nobody reads any more. One pass a day (all instances tick, one wins the advisory lock and
 * records the day it ran); deletes go in batches inside the lock's transaction. Counts are logged.
 */
@Injectable()
export class RetentionService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger(RetentionService.name);
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    @Inject(ENV) private readonly env: Env,
    private readonly prisma: PrismaService,
  ) {}

  onModuleInit(): void {
    if (!runsScheduler(this.env) || this.env.NODE_ENV === "test" || this.env.RETENTION_ENABLED !== "1") return;
    this.timer = setInterval(() => void this.tick(), TICK_MS);
    setTimeout(() => void this.tick(), 30_000);
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  /** Runs the daily pass if it is due; returns the counts, or null when it was not due or another instance has it. */
  async tick(now = new Date()): Promise<RetentionCounts | null> {
    if (this.running || now.getUTCHours() < RETENTION_HOUR_UTC) return null;
    this.running = true;
    try {
      return await this.run(now, true);
    } catch (e) {
      this.log.error(`retention failed: ${(e as Error).message}`);
      return null;
    } finally {
      this.running = false;
    }
  }

  /** One pass under the advisory lock. With `daily`, skips when today's pass already ran. */
  async run(now = new Date(), daily = false): Promise<RetentionCounts | null> {
    const day = now.toISOString().slice(0, 10);
    const cut = retentionCutoffs(this.env, now);
    const counts = await this.prisma.system.$transaction(
      async (tx) => {
        const lock = await tx.$queryRaw<
          Array<{ locked: boolean }>
        >`SELECT pg_try_advisory_xact_lock(${RETENTION_LOCK_ID}) AS locked`;
        if (!lock[0]?.locked) return null;
        if (daily) {
          const done = await tx.sourceCache.findUnique({ where: { key: DONE_KEY }, select: { params: true } });
          if ((done?.params as { day?: string } | null)?.day === day) return null;
        }
        const c: RetentionCounts = {
          sourceCache: await this.batched(
            tx,
            `SELECT ctid FROM source_cache WHERE expires_at IS NOT NULL AND expires_at < $1`,
            "source_cache",
            cut.sourceCache,
          ),
          // Snapshots that still explain a live recommendation stay however old they are.
          inputSnapshots: await this.batched(
            tx,
            `SELECT s.ctid FROM input_snapshots s WHERE s.created_at < $1
               AND NOT EXISTS (SELECT 1 FROM recommendations r
                               WHERE r.input_snapshot_id = s.id AND r.status IN ('open', 'accepted', 'snoozed', 'in_report'))`,
            "input_snapshots",
            cut.inputSnapshots,
          ),
          // The latest level of every recommendation is kept: it is the "current" one.
          recommendationLevels: await this.batched(
            tx,
            `SELECT l.ctid FROM recommendation_levels l WHERE l.at < $1
               AND EXISTS (SELECT 1 FROM recommendation_levels n WHERE n.recommendation_id = l.recommendation_id AND n.at > l.at)`,
            "recommendation_levels",
            cut.recommendationLevels,
          ),
          analysisRunFields: await this.batched(
            tx,
            `SELECT ctid FROM analysis_run_fields WHERE updated_at < $1 AND status NOT IN ('waiting', 'running')`,
            "analysis_run_fields",
            cut.analysisRunFields,
          ),
          notifications: await this.batched(
            tx,
            `SELECT ctid FROM notifications WHERE read_at IS NOT NULL AND read_at < $1`,
            "notifications",
            cut.notifications,
          ),
          aiRotationProposals: await this.batched(
            tx,
            `SELECT ctid FROM ai_rotation_proposals WHERE expires_at < $1`,
            "ai_rotation_proposals",
            now,
          ),
          aiUsage: await this.batched(
            tx,
            `SELECT ctid FROM ai_usage WHERE day < $1::date`,
            "ai_usage",
            new Date(now.getTime() - 35 * DAY),
          ),
        };
        if (daily) {
          const data = {
            source: "retention",
            params: { day, counts: c } as unknown as Prisma.InputJsonValue,
            fetchedAt: now,
          };
          await tx.sourceCache.upsert({ where: { key: DONE_KEY }, create: { key: DONE_KEY, ...data }, update: data });
        }
        return c;
      },
      { timeout: 30 * 60_000, maxWait: 10_000 },
    );
    if (counts)
      this.log.log(
        `retention: ${Object.entries(counts)
          .map(([k, v]) => `${k}=${v}`)
          .join(" ")}`,
      );
    return counts;
  }

  /** Deletes the rows `select` finds (its one `$1` is the cutoff), BATCH at a time; returns how many went. */
  private async batched(tx: Prisma.TransactionClient, select: string, table: string, cutoff: Date): Promise<number> {
    let total = 0;
    for (;;) {
      const n = await tx.$executeRawUnsafe(`DELETE FROM ${table} WHERE ctid IN (${select} LIMIT ${BATCH})`, cutoff);
      total += n;
      if (n < BATCH) return total;
    }
  }
}
