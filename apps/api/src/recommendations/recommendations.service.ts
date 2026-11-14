import { Inject, Injectable } from "@nestjs/common";
import type { Library } from "@terrasight/library";
import { EventKeys } from "@terrasight/shared";
import { localDate, localTime, MORNING } from "../analysis/scheduler.js";
import { PrismaService } from "../db/prisma.service.js";
import type { Prisma } from "../generated/prisma/client.js";
import { ProblemException } from "../http/problem.js";
import { LIBRARY } from "../library/library.module.js";
import { eventRow, jobRow } from "../messaging/outbox.js";
import { OutboxService } from "../messaging/outbox.service.js";
import { QUEUES } from "../messaging/topology.js";
import { recommendationText, type Localised, type RecText } from "./text.js";

/** The Undo window for Accept and Snooze, enforced on the server (RFC §10.4). */
export const UNDO_MS = 8_000;

export interface CommitJob {
  id: string;
  /** The accept this job belongs to: a re-accepted item gets a new job and the old one is ignored. */
  acceptedAt: string;
}

/** Offset of a time zone from UTC at an instant, in ms. */
function tzOffsetMs(at: Date, timeZone: string): number {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    })
      .formatToParts(at)
      .map((x) => [x.type, x.value]),
  );
  return Date.UTC(+p.year!, +p.month! - 1, +p.day!, +p.hour!, +p.minute!, +p.second!) - at.getTime();
}

/** The next 06:00 in the workspace time zone (Snooze "until tomorrow 06:00", or today's if it is still early). */
export function nextMorning(now: Date, timeZone: string): Date {
  let day = localDate(timeZone, now);
  if (localTime(timeZone, now) >= MORNING)
    day = new Date(Date.parse(`${day}T00:00:00Z`) + 864e5).toISOString().slice(0, 10);
  const [h, m] = MORNING.split(":").map(Number) as [number, number];
  const naive = Date.parse(`${day}T00:00:00Z`) + (h * 60 + m) * 60_000;
  let at = new Date(naive - tzOffsetMs(new Date(naive), timeZone));
  at = new Date(naive - tzOffsetMs(at, timeZone)); // second pass settles a DST change on that day
  return at;
}

type Rec = Prisma.RecommendationGetPayload<{ include: { field: { select: { name: true; aliasNo: true } } } }>;

/** Recommendation lifecycle (RFC §10.4, Tech Design §10.3): accept / snooze with 8 s Undo, dismiss, edit, commit. */
@Injectable()
export class RecommendationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly outbox: OutboxService,
    @Inject(LIBRARY) private readonly lib: Library,
  ) {}

  text(
    rec: Pick<
      Rec,
      "type" | "subject" | "season" | "level" | "planning" | "keyNumbers" | "drivers" | "textOverride"
    >,
  ): RecText {
    const base = recommendationText(rec, this.lib);
    const o = rec.textOverride as Partial<Record<"title" | "action", Localised>> | null;
    return o
      ? { ...base, ...(o.title ? { title: o.title } : {}), ...(o.action ? { action: o.action } : {}) }
      : base;
  }

  view(rec: Rec, now = new Date()) {
    const undoFrom =
      rec.status === "accepted" && !rec.committedAt
        ? rec.acceptedAt
        : rec.status === "snoozed"
          ? rec.snoozedAt
          : null;
    const undoUntil =
      undoFrom && undoFrom.getTime() + UNDO_MS > now.getTime()
        ? new Date(undoFrom.getTime() + UNDO_MS)
        : null;
    return {
      id: rec.id,
      fieldId: rec.fieldId,
      fieldName: rec.field.name,
      type: rec.type,
      subject: rec.subject,
      season: rec.season,
      status: rec.status,
      level: rec.level,
      confidence: rec.confidence,
      tier: rec.tier,
      deadline: rec.deadline ? rec.deadline.toISOString().slice(0, 10) : null,
      irreversible: rec.irreversible,
      planning: rec.planning,
      keyNumbers: rec.keyNumbers,
      drivers: rec.drivers,
      evidence: rec.evidence,
      unknowns: rec.unknowns,
      modelRef: rec.modelRef,
      text: this.text(rec),
      edited: rec.textOverride !== null,
      snoozedUntil: rec.snoozedUntil,
      acceptedAt: rec.acceptedAt,
      committedAt: rec.committedAt,
      undoUntil,
      updatedAt: rec.updatedAt,
    };
  }

  private async load(workspaceId: string, id: string): Promise<Rec> {
    const rec = await this.prisma.db.recommendation.findFirst({
      where: { id, workspaceId },
      include: { field: { select: { name: true, aliasNo: true } } },
    });
    if (!rec) throw new ProblemException(404, "not-found");
    return rec;
  }

  async get(workspaceId: string, id: string) {
    return this.view(await this.load(workspaceId, id));
  }

  /** Accept: the item goes to the Owner report when the 8 s Undo window closes (`commit.8s`). */
  async accept(
    workspaceId: string,
    userId: string,
    id: string,
    input: { note?: string; text?: { title?: Localised; action?: Localised } },
  ) {
    const now = new Date();
    await this.prisma.system.$transaction(async (tx) => {
      const [row] = await tx.$queryRaw<
        Array<{ status: string }>
      >`SELECT status FROM recommendations WHERE id = ${id}::uuid AND workspace_id = ${workspaceId}::uuid FOR UPDATE`;
      if (!row) throw new ProblemException(404, "not-found");
      if (row.status !== "open")
        throw new ProblemException(409, "not-open", "Only open items can be accepted");
      await tx.recommendation.update({
        where: { id },
        data: {
          status: "accepted",
          acceptedAt: now,
          acceptedBy: userId,
          ...(input.text ? { textOverride: input.text as Prisma.InputJsonValue, editedBy: userId } : {}),
        },
      });
      if (input.note)
        await tx.auditLog.create({
          data: {
            workspaceId,
            userId,
            action: "recommendation.note",
            target: `${id}:${input.note.slice(0, 500)}`,
          },
        });
      await tx.auditLog.create({
        data: { workspaceId, userId, action: "recommendation.accept", target: id },
      });
      await this.outbox.add(tx, [
        jobRow(
          QUEUES.recommendationCommit,
          workspaceId,
          { id, acceptedAt: now.toISOString(), ...(input.note ? { note: input.note } : {}) },
          "8s",
        ),
        eventRow(EventKeys.brief(workspaceId), "recommendation.accepted", workspaceId, { id }),
      ]);
    });
    return this.get(workspaceId, id);
  }

  /** Snooze until the next 06:00 in the workspace time zone; the morning run reopens it if it still fires. */
  async snooze(workspaceId: string, userId: string, id: string) {
    const ws = await this.prisma.system.workspace.findUniqueOrThrow({
      where: { id: workspaceId },
      select: { timeZone: true },
    });
    const now = new Date();
    await this.prisma.system.$transaction(async (tx) => {
      const [row] = await tx.$queryRaw<
        Array<{ status: string }>
      >`SELECT status FROM recommendations WHERE id = ${id}::uuid AND workspace_id = ${workspaceId}::uuid FOR UPDATE`;
      if (!row) throw new ProblemException(404, "not-found");
      if (row.status !== "open")
        throw new ProblemException(409, "not-open", "Only open items can be snoozed");
      await tx.recommendation.update({
        where: { id },
        data: { status: "snoozed", snoozedAt: now, snoozedUntil: nextMorning(now, ws.timeZone) },
      });
      await tx.auditLog.create({
        data: { workspaceId, userId, action: "recommendation.snooze", target: id },
      });
      await this.outbox.add(tx, [
        eventRow(EventKeys.brief(workspaceId), "recommendation.snoozed", workspaceId, { id }),
      ]);
    });
    return this.get(workspaceId, id);
  }

  /** Undo within 8 s of Accept (not yet committed) or Snooze; afterwards 409 (RFC §10.4). */
  async undo(workspaceId: string, userId: string, id: string) {
    const now = Date.now();
    await this.prisma.system.$transaction(async (tx) => {
      const [row] = await tx.$queryRaw<
        Array<{
          status: string;
          accepted_at: Date | null;
          snoozed_at: Date | null;
          committed_at: Date | null;
        }>
      >`
        SELECT status, accepted_at, snoozed_at, committed_at FROM recommendations WHERE id = ${id}::uuid AND workspace_id = ${workspaceId}::uuid FOR UPDATE`;
      if (!row) throw new ProblemException(404, "not-found");
      const from =
        row.status === "accepted" && !row.committed_at
          ? row.accepted_at
          : row.status === "snoozed"
            ? row.snoozed_at
            : null;
      if (!from || now - from.getTime() > UNDO_MS)
        throw new ProblemException(409, "undo-expired", "The 8-second Undo window has closed");
      await tx.recommendation.update({
        where: { id },
        data: { status: "open", acceptedAt: null, acceptedBy: null, snoozedAt: null, snoozedUntil: null },
      });
      await tx.auditLog.create({ data: { workspaceId, userId, action: "recommendation.undo", target: id } });
      await this.outbox.add(tx, [
        eventRow(EventKeys.brief(workspaceId), "recommendation.undone", workspaceId, { id }),
      ]);
    });
    return this.get(workspaceId, id);
  }

  async dismiss(workspaceId: string, userId: string, id: string) {
    const r = await this.prisma.db.recommendation.updateMany({
      where: { id, workspaceId, status: { in: ["open", "snoozed"] } },
      data: { status: "dismissed", dismissedAt: new Date() },
    });
    if (!r.count) {
      await this.load(workspaceId, id);
      throw new ProblemException(409, "not-open", "Only open or snoozed items can be dismissed");
    }
    await this.prisma.db.auditLog.create({
      data: { workspaceId, userId, action: "recommendation.dismiss", target: id },
    });
    await this.outbox.add(this.prisma.system, [
      eventRow(EventKeys.brief(workspaceId), "recommendation.dismissed", workspaceId, { id }),
    ]);
    return this.get(workspaceId, id);
  }

  /** Edit the text; marked "edited by the agronomist" (D6). */
  async edit(
    workspaceId: string,
    userId: string,
    id: string,
    text: { title?: Localised; action?: Localised },
  ) {
    await this.load(workspaceId, id);
    await this.prisma.db.recommendation.updateMany({
      where: { id, workspaceId },
      data: { textOverride: text as Prisma.InputJsonValue, editedBy: userId },
    });
    return this.get(workspaceId, id);
  }

  /**
   * `recommendation.commit` after 8 s: if the item is still accepted by that same Accept, snapshot it into the Owner
   * report. Undo and commit lock the same row, so exactly one of them wins (Tech Design §10.3).
   */
  async commit(job: CommitJob & { note?: string }): Promise<"committed" | "skipped" | "early"> {
    return this.prisma.system.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<
        Array<{ id: string }>
      >`SELECT id FROM recommendations WHERE id = ${job.id}::uuid FOR UPDATE`;
      if (!rows.length) return "skipped";
      const rec = await tx.recommendation.findUniqueOrThrow({
        where: { id: job.id },
        include: { field: { select: { name: true, aliasNo: true } } },
      });
      if (rec.status !== "accepted" || rec.committedAt || rec.acceptedAt?.toISOString() !== job.acceptedAt)
        return "skipped";
      if (Date.now() - rec.acceptedAt.getTime() < UNDO_MS) return "early";
      const now = new Date();
      const text = this.text(rec);
      await tx.reportItem.create({
        data: {
          workspaceId: rec.workspaceId,
          recommendationId: rec.id,
          committedAt: now,
          note: job.note ?? null,
          text: {
            fieldName: rec.field.name,
            ...text,
            level: rec.level,
            confidence: rec.confidence,
            deadline: rec.deadline?.toISOString().slice(0, 10) ?? null,
            keyNumbers: rec.keyNumbers,
            edited: rec.textOverride !== null,
          } as unknown as Prisma.InputJsonValue,
        },
      });
      await tx.recommendation.update({
        where: { id: rec.id },
        data: { status: "in_report", committedAt: now },
      });
      await tx.auditLog.create({
        data: {
          workspaceId: rec.workspaceId,
          userId: rec.acceptedBy,
          action: "recommendation.commit",
          target: rec.id,
        },
      });
      await this.outbox.add(tx, [
        eventRow(EventKeys.brief(rec.workspaceId), "recommendation.committed", rec.workspaceId, {
          id: rec.id,
        }),
      ]);
      return "committed";
    });
  }
}
