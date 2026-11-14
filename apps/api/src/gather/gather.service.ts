import { Injectable, type OnModuleInit } from "@nestjs/common";
import { EventKeys, type StreamTopic } from "@terrasight/shared";
import type { SourceId } from "@terrasight/sources";
import { PrismaService } from "../db/prisma.service.js";
import { EventsService } from "../events/events.service.js";
import { ProblemException } from "../http/problem.js";
import { eventRow, jobRow } from "../messaging/outbox.js";
import { OutboxService } from "../messaging/outbox.service.js";
import { QUEUES } from "../messaging/topology.js";
import { SOURCE_LABELS } from "../sources/sources.service.js";

@Injectable()
export class GatherService implements OnModuleInit {
  constructor(
    private readonly prisma: PrismaService,
    private readonly outbox: OutboxService,
    private readonly events: EventsService,
  ) {}

  /** On (re)connect the browser first gets the current gather state from PostgreSQL (RFC §5.3). */
  onModuleInit(): void {
    this.events.registerStateProvider("field", async (workspaceId: string, topic: StreamTopic) => {
      const fieldId = topic.slice("field:".length);
      return this.status(workspaceId, fieldId).catch(() => undefined);
    });
  }

  async status(workspaceId: string, fieldId: string) {
    const field = await this.prisma.db.field.findFirst({
      where: { id: fieldId, workspaceId },
      select: { id: true },
    });
    if (!field) throw new ProblemException(404, "not-found");
    const job = await this.prisma.system.gatherJob.findFirst({
      where: { fieldId },
      orderBy: { startedAt: "desc" },
      include: { tasks: { orderBy: { source: "asc" } } },
    });
    if (!job) return null;
    return {
      jobId: job.id,
      status: job.status,
      startedAt: job.startedAt,
      finishedAt: job.finishedAt,
      sources: job.tasks.map((t) => ({
        source: t.source,
        label: SOURCE_LABELS[t.source as SourceId] ?? t.source,
        status: t.status,
        reason: t.error,
        dataDate: t.dataDate ? t.dataDate.toISOString().slice(0, 10) : null,
        attempts: t.attempts,
      })),
    };
  }

  /** "Retry" for one failed source (S-02.04). */
  async retry(workspaceId: string, fieldId: string, source: string) {
    const status = await this.status(workspaceId, fieldId);
    if (!status) throw new ProblemException(404, "not-found");
    const task = status.sources.find((s) => s.source === source);
    if (!task) throw new ProblemException(404, "not-found");
    if (task.status !== "failed" && task.status !== "partial")
      throw new ProblemException(409, "not-retryable", "Only failed or partial sources can be retried");
    await this.prisma.system.$transaction(async (tx) => {
      await tx.gatherTask.update({
        where: { jobId_source: { jobId: status.jobId, source } },
        data: { status: "queued", error: null, attempts: 0, finishedAt: null },
      });
      await tx.gatherJob.update({
        where: { id: status.jobId },
        data: { status: "running", finishedAt: null },
      });
      await this.outbox.add(tx, [
        jobRow(QUEUES.gatherSource, workspaceId, { jobId: status.jobId, fieldId, source }),
        eventRow(EventKeys.fieldGather(fieldId, source), "gather.source", workspaceId, {
          fieldId,
          source,
          status: "queued",
        }),
      ]);
    });
    return this.status(workspaceId, fieldId);
  }

  /** A full re-gather (e.g. to pick up fresh data); refused while one is active (RFC §3: 409). */
  async regather(workspaceId: string, fieldId: string, sources: SourceId[]) {
    try {
      return await this.prisma.system.$transaction(async (tx) => {
        const job = await tx.gatherJob.create({
          data: { fieldId, status: "running", tasks: { create: sources.map((source) => ({ source })) } },
        });
        await this.outbox.add(
          tx,
          sources.map((source) =>
            jobRow(QUEUES.gatherSource, workspaceId, { jobId: job.id, fieldId, source }),
          ),
        );
        return job.id;
      });
    } catch (e) {
      if (
        (e as { code?: string }).code === "P2002" ||
        String(e).includes("gather_jobs_one_active_per_field")
      ) {
        throw new ProblemException(409, "gather-active", "Data for this field is already being gathered");
      }
      throw e;
    }
  }
}
