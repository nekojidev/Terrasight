import { Inject, Injectable, type OnModuleInit } from "@nestjs/common";
import { ESSENTIAL, SourceError, type SourceId, type SourceResult } from "@terrasight/sources";
import { EventKeys, type Envelope } from "@terrasight/shared";
import { RateLimitService } from "../auth/rate-limit.js";
import { ENV, runsWorker, type Env } from "../config/config.js";
import { PrismaService } from "../db/prisma.service.js";
import type { JobStatus } from "../generated/prisma/enums.js";
import { GeoService } from "../geo/geo.service.js";
import { BROKER, type Broker } from "../messaging/broker.js";
import { JobConsumer } from "../messaging/consumer.js";
import { eventRow, jobRow } from "../messaging/outbox.js";
import { OutboxService } from "../messaging/outbox.service.js";
import { QUEUES } from "../messaging/topology.js";
import {
  SOURCE_LABELS,
  SOURCE_PROVIDES,
  SOURCE_TIMEOUT_MS,
  SourcesService,
} from "../sources/sources.service.js";

export interface GatherSourceJob {
  jobId: string;
  fieldId: string;
  source: SourceId;
}

const FINISHED: JobStatus[] = ["done", "partial", "failed", "cached"];
/** Shared per-source limits for all workers (Tech Design §13). */
const BUCKET = { capacity: 8, refillPerSec: 2 };

export function today(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * One task per source (RFC D1): cache → rate limit → adapter → store. A retryable failure is retried by the
 * consumer base (5 s, 30 s); after the last attempt a recorded fixture is used if one exists, otherwise the
 * task fails with a plain reason. When the essential sources have finished, a provisional history is built;
 * when every task has finished, the final one (Tech Design §8.1).
 */
@Injectable()
export class GatherSourceConsumer extends JobConsumer<GatherSourceJob> implements OnModuleInit {
  constructor(
    @Inject(BROKER) broker: Broker,
    @Inject(ENV) private readonly env: Env,
    private readonly prisma: PrismaService,
    private readonly geo: GeoService,
    private readonly sources: SourcesService,
    private readonly outbox: OutboxService,
    private readonly limits: RateLimitService,
  ) {
    super(broker, { queue: QUEUES.gatherSource, prefetch: 8, retries: 2 });
  }

  async onModuleInit(): Promise<void> {
    if (runsWorker(this.env)) await this.start();
  }

  async handle(env: Envelope<GatherSourceJob>, attempt: number): Promise<void> {
    const { jobId, fieldId, source } = env.data;
    const workspaceId = env.workspaceId!;
    const task = await this.prisma.system.gatherTask.findUnique({
      where: { jobId_source: { jobId, source } },
    });
    if (!task || FINISHED.includes(task.status)) return; // idempotent: already handled
    const adapter = this.sources.adapter(source);
    if (!adapter) return this.finish(workspaceId, fieldId, jobId, source, "failed", null, "unknown source");

    await this.prisma.system.gatherTask.update({
      where: { jobId_source: { jobId, source } },
      data: { status: "running", attempts: { increment: 1 } },
    });
    await this.emit(workspaceId, fieldId, source, { status: "running" });

    const field = await this.geo.fieldGeometry(fieldId);
    const day = today();
    const key = this.sources.key(adapter, field, day);

    const hit = await this.sources.cached(key);
    if (hit)
      return this.finish(
        workspaceId,
        fieldId,
        jobId,
        source,
        "cached",
        key,
        hit.result.reason ?? null,
        hit.result,
      );

    let result: SourceResult;
    try {
      while (!(await this.limits.take(`source:${source}`, BUCKET)))
        await new Promise((r) => setTimeout(r, 250));
      const signal = AbortSignal.timeout(SOURCE_TIMEOUT_MS[source]);
      result = await adapter.fetch(field, { signal, fetch, today: day });
    } catch (e) {
      const err = e as Error;
      const retryable = err instanceof SourceError ? err.retryable : true;
      if (retryable && attempt < this.options.retries) throw err; // consumer base schedules the retry
      const fixture = this.sources.fixture(adapter, key);
      if (fixture) {
        await this.sources.store(adapter, key, { source }, fixture, "fixture");
        return this.finish(
          workspaceId,
          fieldId,
          jobId,
          source,
          "cached",
          key,
          fixture.reason ?? null,
          fixture,
        );
      }
      return this.finish(
        workspaceId,
        fieldId,
        jobId,
        source,
        "failed",
        null,
        `${SOURCE_LABELS[source]} ${err.message}, ${SOURCE_PROVIDES[source]}`,
      );
    }

    if (result.status !== "failed")
      await this.sources.store(adapter, key, { source, today: day }, result, "live");
    return this.finish(
      workspaceId,
      fieldId,
      jobId,
      source,
      result.status,
      result.status === "failed" ? null : key,
      result.reason ? `${SOURCE_LABELS[source]}: ${result.reason}` : null,
      result,
    );
  }

  private async finish(
    workspaceId: string,
    fieldId: string,
    jobId: string,
    source: SourceId,
    status: JobStatus,
    cacheKey: string | null,
    reason: string | null,
    result?: SourceResult,
  ): Promise<void> {
    const dataDate = result?.dataDate ? new Date(`${result.dataDate}T00:00:00Z`) : null;
    await this.prisma.system.$transaction(async (tx) => {
      // Serialise task completions of one job, so the "all essentials done" check can't be missed by a race.
      await tx.$queryRaw`SELECT id FROM gather_jobs WHERE id = ${jobId}::uuid FOR UPDATE`;
      await tx.gatherTask.update({
        where: { jobId_source: { jobId, source } },
        data: { status, cacheKey, error: reason, dataDate, finishedAt: new Date() },
      });
      // Terrain gives the field's slope directly (RFC §16).
      if (
        source === "dem" &&
        result?.payload &&
        typeof result.payload === "object" &&
        "meanSlopePct" in result.payload
      ) {
        await tx.$executeRaw`UPDATE fields SET slope_pct = ${(result.payload as { meanSlopePct: number }).meanSlopePct} WHERE id = ${fieldId}::uuid`;
      }
      const tasks = await tx.gatherTask.findMany({
        where: { jobId },
        select: { source: true, status: true },
      });
      const done = (s: JobStatus) => FINISHED.includes(s);
      const rows = [
        eventRow(EventKeys.fieldGather(fieldId, source), "gather.source", workspaceId, {
          fieldId,
          source,
          status,
          reason,
          dataDate: result?.dataDate ?? null,
        }),
      ];

      if (tasks.filter((t) => ESSENTIAL.has(t.source)).every((t) => done(t.status))) {
        const claimed = await tx.gatherJob.updateMany({
          where: { id: jobId, provisionalAt: null },
          data: { provisionalAt: new Date() },
        });
        if (claimed.count === 1)
          rows.push(jobRow(QUEUES.historyBuild, workspaceId, { fieldId, jobId, provisional: true }));
      }
      if (tasks.every((t) => done(t.status))) {
        const statuses = tasks.map((t) => t.status);
        const jobStatus: JobStatus = statuses.every((s) => s === "failed")
          ? "failed"
          : statuses.some((s) => s === "failed" || s === "partial")
            ? "partial"
            : "done";
        const updated = await tx.gatherJob.updateMany({
          where: { id: jobId, status: "running" },
          data: { status: jobStatus, finishedAt: new Date() },
        });
        if (updated.count === 1)
          rows.push(jobRow(QUEUES.historyBuild, workspaceId, { fieldId, jobId, provisional: false }));
      }
      await this.outbox.add(tx, rows);
    });
  }

  private async emit(
    workspaceId: string,
    fieldId: string,
    source: SourceId,
    data: Record<string, unknown>,
  ): Promise<void> {
    await this.outbox.add(this.prisma.system, [
      eventRow(EventKeys.fieldGather(fieldId, source), "gather.source", workspaceId, {
        fieldId,
        source,
        ...data,
      }),
    ]);
  }
}
