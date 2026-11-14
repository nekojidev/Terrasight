import { Inject, Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from "@nestjs/common";
import { ENV, runsScheduler, type Env } from "../config/config.js";
import { PrismaService } from "../db/prisma.service.js";
import { AnalysisService } from "./analysis.service.js";

/** Arbitrary constant for the scheduler's advisory lock: only one instance schedules runs (Tech Design §8.2). */
const LOCK_ID = 6_0600;
const TICK_MS = 60_000;
export const MORNING = "06:00";

/** Today's date in a time zone, yyyy-mm-dd. */
export function localDate(timeZone: string, now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

/** Local time hh:mm in a time zone. */
export function localTime(timeZone: string, now = new Date()): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(now);
}

/**
 * Every minute: workspaces whose local time has passed 06:00 with no `schedule` run for today get one (RFC §10.2).
 * Runs missed while the process was down are caught up on the next tick, once per day.
 */
@Injectable()
export class AnalysisScheduler implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger(AnalysisScheduler.name);
  private timer: NodeJS.Timeout | null = null;
  private ticking = false;

  constructor(
    @Inject(ENV) private readonly env: Env,
    private readonly prisma: PrismaService,
    private readonly analysis: AnalysisService,
  ) {}

  onModuleInit(): void {
    if (!runsScheduler(this.env) || this.env.NODE_ENV === "test") return;
    this.timer = setInterval(() => void this.tick(), TICK_MS);
    setTimeout(() => void this.tick(), 5_000);
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  /**
   * One scheduling pass; returns the workspaces that got a run. Each workspace is scheduled in its own transaction
   * under a per-workspace advisory lock, so many instances can tick at once and one failure doesn't block the rest.
   */
  async tick(now = new Date()): Promise<string[]> {
    if (this.ticking) return [];
    this.ticking = true;
    const started: string[] = [];
    try {
      const candidates = await this.prisma.system.$queryRaw<Array<{ id: string; time_zone: string }>>`
        SELECT w.id, w.time_zone FROM workspaces w
        WHERE EXISTS (SELECT 1 FROM fields f WHERE f.workspace_id = w.id AND f.archived_at IS NULL)`;
      for (const w of candidates) {
        if (localTime(w.time_zone, now) < MORNING) continue;
        try {
          if (await this.schedule(w.id, localDate(w.time_zone, now), now)) started.push(w.id);
        } catch (e) {
          const err = e as Error & { getResponse?: () => unknown };
          this.log.error(
            `morning run for workspace ${w.id} failed: ${err.getResponse ? JSON.stringify(err.getResponse()) : err.message}`,
          );
        }
      }
      if (started.length) this.log.log(`scheduled morning runs for ${started.length} workspace(s)`);
    } catch (e) {
      this.log.error(`scheduler tick failed: ${(e as Error).message}`);
    } finally {
      this.ticking = false;
    }
    return started;
  }

  private schedule(workspaceId: string, asOf: string, now: Date): Promise<boolean> {
    return this.prisma.system.$transaction(async (tx) => {
      const lock = await tx.$queryRaw<
        Array<{ locked: boolean }>
      >`SELECT pg_try_advisory_xact_lock(${LOCK_ID}, hashtext(${workspaceId})) AS locked`;
      if (!lock[0]?.locked) return false;
      const day = new Date(`${asOf}T00:00:00Z`);
      if (
        await tx.analysisRun.findFirst({
          where: { workspaceId, trigger: "schedule", asOf: day },
          select: { id: true },
        })
      )
        return false;
      // A scheduled run from an earlier day still going (stuck worker) would block today's: close it.
      const stuck = await tx.analysisRun.findMany({
        where: { workspaceId, trigger: "schedule", status: "running", asOf: { lt: day } },
        select: { id: true },
      });
      if (stuck.length) {
        const ids = stuck.map((s) => s.id);
        await tx.analysisRunField.updateMany({
          where: { runId: { in: ids }, status: { in: ["waiting", "running"] } },
          data: { status: "failed", error: "the check did not finish" },
        });
        await tx.analysisRun.updateMany({
          where: { id: { in: ids } },
          data: { status: "done", finishedAt: now },
        });
      }
      await this.analysis.startIn(tx, workspaceId, "schedule", null, asOf);
      return true;
    });
  }
}
