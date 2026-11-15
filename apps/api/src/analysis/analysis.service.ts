import { Injectable, Logger, type OnModuleInit } from "@nestjs/common";
import { EventKeys } from "@terrasight/shared";
import { PrismaService } from "../db/prisma.service.js";
import { EventsService } from "../events/events.service.js";
import type { Prisma } from "../generated/prisma/client.js";
import type { FieldCheckStatus, RunTrigger } from "../generated/prisma/enums.js";
import { ProblemException } from "../http/problem.js";
import { eventRow, jobRow, type OutboxRow } from "../messaging/outbox.js";
import { OutboxService } from "../messaging/outbox.service.js";
import { QUEUES } from "../messaging/topology.js";
import { NotificationsService } from "../notifications/notifications.service.js";
import { planRunFailed, planUrgent } from "../notifications/plan.js";

type Tx = Prisma.TransactionClient;
const ACTIVE: FieldCheckStatus[] = ["waiting", "running"];
const FINAL: FieldCheckStatus[] = ["ok", "stale", "failed"];

/** A check "running" longer than this has lost its worker (the slowest healthy check takes a few minutes). */
export const STALE_RUNNING_MS = 15 * 60_000;
/** A check still "waiting" this long after the run started never got its message (lost job). */
export const STALE_WAITING_MS = 60 * 60_000;
export const STALE_REASON = "the check did not finish (the worker stopped); run the analysis again";

/** While a run is active its summary holds the fields attached to another run's check (RFC §10.2). */
interface RunningSummary {
  attached?: string[];
}

export interface RunSummary {
  total: number;
  checked: number;
  newRecommendations: number;
  /** Fields that ended `stale` or `failed`, for "Pivot 21: NASA POWER didn't respond — showing yesterday's data". */
  problems: Array<{
    fieldId: string;
    name: string;
    status: "stale" | "failed";
    error: string | null;
    dataDate: string | null;
  }>;
}

export interface FieldCheckJob {
  runId: string;
  fieldId: string;
}

const iso = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);

/** Analysis runs (RFC §10.2, Tech Design §8.2): one `field.check` per field, per-field status, run summary. */
@Injectable()
export class AnalysisService implements OnModuleInit {
  private readonly log = new Logger(AnalysisService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly outbox: OutboxService,
    private readonly events: EventsService,
    private readonly notifications: NotificationsService,
  ) {}

  /** On (re)connect the AnalysisPanel first gets the latest run from PostgreSQL. */
  onModuleInit(): void {
    this.events.registerStateProvider(
      "analysis",
      async (workspaceId) => (await this.latest(workspaceId)) ?? undefined,
    );
  }

  /** Starts a run for all or selected active fields and returns it with every field's status. */
  async start(
    workspaceId: string,
    trigger: RunTrigger,
    requestedBy: string | null,
    asOf: string,
    fieldIds?: string[],
  ) {
    const runId = await this.prisma.system.$transaction((tx) =>
      this.startIn(tx, workspaceId, trigger, requestedBy, asOf, fieldIds),
    );
    return this.view(workspaceId, runId);
  }

  /**
   * Creates the run inside the caller's transaction and returns its id (Tech Design §8.2): one `field.check` per
   * field; a field already being checked is attached to that check instead of starting another (RFC §10.2).
   */
  async startIn(
    t: Tx,
    workspaceId: string,
    trigger: RunTrigger,
    requestedBy: string | null,
    asOf: string,
    fieldIds?: string[],
  ): Promise<string> {
    const fields = await t.field.findMany({
      where: { workspaceId, archivedAt: null, ...(fieldIds?.length ? { id: { in: fieldIds } } : {}) },
      select: { id: true },
      orderBy: { aliasNo: "asc" },
    });
    if (fieldIds?.length && fields.length !== new Set(fieldIds).size)
      throw new ProblemException(404, "not-found");
    if (!fields.length) throw new ProblemException(422, "no-fields", "There are no fields to analyse");
    const busy = new Set(
      (
        await t.analysisRunField.findMany({
          where: { fieldId: { in: fields.map((f) => f.id) }, status: { in: ACTIVE } },
          select: { fieldId: true },
        })
      ).map((r) => r.fieldId),
    );
    const fresh = fields.filter((f) => !busy.has(f.id));
    const attached = fields.filter((f) => busy.has(f.id)).map((f) => f.id);
    const run = await t.analysisRun.create({
      data: {
        workspaceId,
        trigger,
        requestedBy,
        asOf: new Date(`${asOf}T00:00:00Z`),
        summary: { attached } as Prisma.InputJsonValue,
      },
    });
    if (fresh.length)
      await t.analysisRunField.createMany({ data: fresh.map((f) => ({ runId: run.id, fieldId: f.id })) });
    await this.outbox.add(t, [
      ...fresh.map((f) =>
        jobRow(QUEUES.fieldCheck, workspaceId, { runId: run.id, fieldId: f.id } satisfies FieldCheckJob),
      ),
      eventRow(EventKeys.analysis(workspaceId), "analysis.started", workspaceId, {
        runId: run.id,
        trigger,
        fields: fields.map((f) => f.id),
      }),
    ]);
    this.log.log(
      `analysis run ${run.id} (${trigger}) for workspace ${workspaceId}: ${fresh.length} checks, ${attached.length} attached`,
    );
    return run.id;
  }

  /**
   * Marks a field's check as running (the event drives the AnalysisPanel). A redelivered message (`reclaimAfterMs`
   * given, after a worker crash) also re-claims a row stuck in "running" for longer than that, so the check is not
   * silently dropped; a fresh message only claims "waiting".
   */
  async running(
    workspaceId: string,
    runId: string,
    fieldId: string,
    reclaimAfterMs?: number,
    now = new Date(),
  ): Promise<boolean> {
    const r = await this.prisma.system.analysisRunField.updateMany({
      where: {
        runId,
        fieldId,
        OR: [
          { status: "waiting" },
          ...(reclaimAfterMs === undefined
            ? []
            : [{ status: "running" as const, updatedAt: { lt: new Date(now.getTime() - reclaimAfterMs) } }]),
        ],
      },
      data: { status: "running" },
    });
    if (r.count)
      await this.outbox.add(this.prisma.system, [this.fieldEvent(workspaceId, runId, fieldId, "running")]);
    return r.count === 1;
  }

  /** Hands a check back to "waiting" before a retry (the retry message claims it again). */
  async release(runId: string, fieldId: string): Promise<void> {
    await this.prisma.system.analysisRunField.updateMany({
      where: { runId, fieldId, status: "running" },
      data: { status: "waiting" },
    });
  }

  /**
   * Reaper: checks stuck in "running" (worker died, no redelivery) or never started ("waiting" far too long) are
   * marked failed with a reason; `finish` then completes the run and notifies as usual. Returns the number reaped.
   */
  async reapStale(
    now = new Date(),
    runningMs = STALE_RUNNING_MS,
    waitingMs = STALE_WAITING_MS,
  ): Promise<number> {
    const stale = await this.prisma.system.analysisRunField.findMany({
      where: {
        OR: [
          { status: "running", updatedAt: { lt: new Date(now.getTime() - runningMs) } },
          { status: "waiting", updatedAt: { lt: new Date(now.getTime() - waitingMs) } },
        ],
      },
      select: { runId: true, fieldId: true, status: true, run: { select: { workspaceId: true, status: true } } },
    });
    let reaped = 0;
    for (const row of stale) {
      if (row.run.status !== "running") continue;
      // Claim atomically so two reapers don't both finish it; a late worker result may still overwrite.
      const claimed = await this.prisma.system.analysisRunField.updateMany({
        where: {
          runId: row.runId,
          fieldId: row.fieldId,
          status: row.status,
          updatedAt: { lt: new Date(now.getTime() - (row.status === "running" ? runningMs : waitingMs)) },
        },
        data: { status: "failed", error: STALE_REASON },
      });
      if (claimed.count !== 1) continue;
      await this.finish(row.run.workspaceId, row.runId, row.fieldId, "failed", null, STALE_REASON, 0);
      this.log.warn(`reaped stale ${row.status} check: run ${row.runId} field ${row.fieldId}`);
      reaped += 1;
    }
    return reaped;
  }

  /** Finishes a field check; completes every run waiting on it and writes their summaries. */
  async finish(
    workspaceId: string,
    runId: string,
    fieldId: string,
    status: "ok" | "stale" | "failed",
    dataDate: string | null,
    error: string | null,
    newRecommendations: number,
  ) {
    await this.prisma.system.$transaction(async (tx) => {
      const data = {
        status,
        dataDate: dataDate ? new Date(`${dataDate}T00:00:00Z`) : null,
        error,
        newRecommendations,
      };
      await tx.analysisRunField.updateMany({ where: { runId, fieldId }, data });
      const rows: OutboxRow[] = [this.fieldEvent(workspaceId, runId, fieldId, status, { dataDate, error })];
      // Runs that attached this field to our check get the same result.
      const waiting = await tx.analysisRun.findMany({
        where: { workspaceId, status: "running", id: { not: runId } },
        select: { id: true, summary: true },
      });
      const runIds = [runId];
      for (const w of waiting) {
        const attached = (w.summary as RunningSummary | null)?.attached ?? [];
        if (!attached.includes(fieldId)) continue;
        await tx.analysisRunField.upsert({
          where: { runId_fieldId: { runId: w.id, fieldId } },
          create: { runId: w.id, fieldId, ...data },
          update: data,
        });
        await tx.analysisRun.update({
          where: { id: w.id },
          data: { summary: { attached: attached.filter((x) => x !== fieldId) } as Prisma.InputJsonValue },
        });
        rows.push(this.fieldEvent(workspaceId, w.id, fieldId, status, { dataDate, error }));
        runIds.push(w.id);
      }
      for (const id of runIds) rows.push(...(await this.completeIfDone(tx, workspaceId, id)));
      await this.outbox.add(tx, rows);
    });
  }

  private async completeIfDone(tx: Tx, workspaceId: string, runId: string): Promise<OutboxRow[]> {
    await tx.$queryRaw`SELECT id FROM analysis_runs WHERE id = ${runId}::uuid FOR UPDATE`;
    const run = await tx.analysisRun.findUnique({ where: { id: runId } });
    if (!run || run.status !== "running") return [];
    if ((run.summary as RunningSummary | null)?.attached?.length) return [];
    // Count statuses in SQL; the rows are loaded only once, when the run is really done.
    const counts = await tx.analysisRunField.groupBy({
      by: ["status"],
      where: { runId },
      _count: { _all: true },
    });
    if (counts.some((c) => !FINAL.includes(c.status))) return [];
    const fields = await tx.analysisRunField.findMany({
      where: { runId },
      include: { field: { select: { name: true } } },
    });
    const done = { ...run, fields };
    const summary: RunSummary = {
      total: fields.length,
      checked: fields.filter((f) => f.status !== "failed").length,
      newRecommendations: fields.reduce((n, f) => n + f.newRecommendations, 0),
      problems: fields
        .filter(
          (f): f is typeof f & { status: "stale" | "failed" } =>
            f.status === "stale" || f.status === "failed",
        )
        .map((f) => ({
          fieldId: f.fieldId,
          name: f.field.name,
          status: f.status,
          error: f.error,
          dataDate: iso(f.dataDate),
        })),
    };
    await tx.analysisRun.update({
      where: { id: runId },
      data: { status: "done", finishedAt: new Date(), summary: summary as unknown as Prisma.InputJsonValue },
    });
    await this.notify(tx, workspaceId, done, summary);
    return [
      eventRow(EventKeys.analysis(workspaceId), "analysis.done", workspaceId, { runId, summary }),
      eventRow(EventKeys.brief(workspaceId), "brief.changed", workspaceId, { runId }),
    ];
  }

  /** Notifications from a finished run (RFC §15.4): new Urgent items and failed fields. */
  private async notify(
    tx: Tx,
    workspaceId: string,
    run: { id: string; requestedBy: string | null; startedAt: Date; fields: Array<{ fieldId: string }> },
    summary: RunSummary,
  ): Promise<void> {
    const members = await this.notifications.members(workspaceId, tx);
    const ws = await tx.workspace.findUniqueOrThrow({
      where: { id: workspaceId },
      select: { timeZone: true },
    });
    const fresh = await tx.recommendation.findMany({
      where: {
        workspaceId,
        fieldId: { in: run.fields.map((f) => f.fieldId) },
        createdAt: { gte: run.startedAt },
        status: "open",
      },
      select: {
        id: true,
        deadline: true,
        irreversible: true,
        planning: true,
        field: { select: { name: true } },
      },
    });
    await this.notifications.create(tx, workspaceId, [
      ...planUrgent(
        members,
        fresh.map((r) => ({
          id: r.id,
          fieldName: r.field.name,
          deadline: iso(r.deadline),
          irreversible: r.irreversible,
          planning: r.planning,
        })),
        new Date(),
        ws.timeZone,
      ),
      ...planRunFailed(members, {
        runId: run.id,
        requestedBy: run.requestedBy,
        failed: summary.problems.filter((p) => p.status === "failed").length,
        total: summary.total,
      }),
    ]);
  }

  private fieldEvent(
    workspaceId: string,
    runId: string,
    fieldId: string,
    status: FieldCheckStatus,
    extra: Record<string, unknown> = {},
  ): OutboxRow {
    return eventRow(EventKeys.analysis(workspaceId), "analysis.field", workspaceId, {
      runId,
      fieldId,
      status,
      ...extra,
    });
  }

  /** Run with every field's status; attached fields show the status of the check they wait for. */
  async view(workspaceId: string, runId: string) {
    const run = await this.prisma.system.analysisRun.findFirst({
      where: { id: runId, workspaceId },
      include: { fields: true },
    });
    if (!run) throw new ProblemException(404, "not-found");
    const attached = run.status === "running" ? ((run.summary as RunningSummary | null)?.attached ?? []) : [];
    const borrowed = attached.length
      ? await this.prisma.system.analysisRunField.findMany({
          where: { fieldId: { in: attached }, status: { in: ACTIVE } },
        })
      : [];
    const rows = [...run.fields, ...borrowed];
    const names = new Map(
      (
        await this.prisma.system.field.findMany({
          where: { id: { in: rows.map((r) => r.fieldId) } },
          select: { id: true, name: true, aliasNo: true },
        })
      ).map((f) => [f.id, f]),
    );
    return {
      id: run.id,
      trigger: run.trigger,
      asOf: iso(run.asOf),
      status: run.status,
      startedAt: run.startedAt,
      finishedAt: run.finishedAt,
      summary: run.status === "done" ? (run.summary as unknown as RunSummary) : null,
      fields: rows
        .map((r) => ({
          fieldId: r.fieldId,
          name: names.get(r.fieldId)?.name ?? "",
          aliasNo: names.get(r.fieldId)?.aliasNo ?? 0,
          status: r.status,
          dataDate: iso(r.dataDate),
          error: r.error,
          newRecommendations: r.newRecommendations,
        }))
        .sort((a, b) => a.aliasNo - b.aliasNo),
    };
  }

  async latest(workspaceId: string) {
    const run = await this.prisma.system.analysisRun.findFirst({
      where: { workspaceId },
      orderBy: { startedAt: "desc" },
      select: { id: true },
    });
    return run ? this.view(workspaceId, run.id) : null;
  }

  /** "Retry" re-runs only that field, as a new single-field manual run (RFC §10.2). */
  async retry(workspaceId: string, userId: string, runId: string, fieldId: string, asOf: string) {
    const row = await this.prisma.system.analysisRunField.findFirst({
      where: { runId, fieldId, run: { workspaceId } },
    });
    if (!row) throw new ProblemException(404, "not-found");
    return this.start(workspaceId, "manual", userId, asOf, [fieldId]);
  }
}
