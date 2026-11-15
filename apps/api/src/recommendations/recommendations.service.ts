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
import { NotificationsService } from "../notifications/notifications.service.js";
import { planDecisionAsked } from "../notifications/plan.js";
import { recommendationText, type Localised, type RecText } from "./text.js";

/** The Undo window for Accept and Snooze, enforced on the server (RFC §10.4). */
export const UNDO_MS = 8_000;

export interface CommitJob {
  id: string;
  /** The accept this job belongs to: a re-accepted item gets a new job and the old one is ignored. */
  acceptedAt: string;
  /** Set when the job commits an "ask the owner": the decision is created only if this ask is still live. */
  askedAt?: string;
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

/** When the running Undo window started: a pending ask, an accept not yet committed, or a snooze. */
function undoStart(r: {
  status: string;
  acceptedAt: Date | null;
  snoozedAt: Date | null;
  committedAt: Date | null;
  askOwnerAt: Date | null;
  askCommittedAt: Date | null;
}): Date | null {
  if (r.askOwnerAt && !r.askCommittedAt) return r.askOwnerAt;
  if (r.status === "accepted" && !r.committedAt) return r.acceptedAt;
  if (r.status === "snoozed") return r.snoozedAt;
  return null;
}

type Rec = Prisma.RecommendationGetPayload<{ include: { field: { select: { name: true; aliasNo: true } } } }>;

/** Recommendation lifecycle (RFC §10.4, Tech Design §10.3): accept / snooze with 8 s Undo, dismiss, edit, commit. */
@Injectable()
export class RecommendationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly outbox: OutboxService,
    private readonly notifications: NotificationsService,
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
    const undoFrom = undoStart(rec);
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
      askedOwnerAt: rec.askOwnerAt,
      /** Asked and the 8 s Undo window has not closed into a decision yet. */
      decisionPending: !!rec.askOwnerAt && !rec.askCommittedAt,
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

  /**
   * The detail page (design 09): the view plus the field's last crops (the "grows here in a row" step) and the pest's
   * library facts (season, damage, what raises the risk) for the reasoning steps and the options.
   */
  async get(workspaceId: string, id: string) {
    const rec = await this.load(workspaceId, id);
    const crops = await this.prisma.system.cropSeason.findMany({
      where: { fieldId: rec.fieldId, season: { lt: rec.season } },
      orderBy: { season: "desc" },
      take: 4,
    });
    const name = (crop: string) => {
      const c = this.lib.rotations.crops[crop];
      return c ? { en: c.en, uk: c.uk } : { en: crop.replace(/_/g, " "), uk: crop.replace(/_/g, " ") };
    };
    const pest = this.lib.pests.pests.find((p) => p.id === rec.subject);
    return {
      ...this.view(rec),
      recentCrops: crops
        .reverse()
        .map((c) => ({ season: c.season, crop: c.mainCrop, name: name(c.mainCrop) })),
      pest: pest
        ? {
            season: pest.season,
            damage: pest.damage,
            riskWhen: pest.riskWhen,
            note: pest.note ?? null,
            hostCrops: pest.crops,
          }
        : null,
    };
  }

  /** Accept: the item goes into the agronomist's own plan; it never reaches the owner (that is `askOwner`). */
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

  /** Undo within 8 s of Accept, Ask owner (not yet committed) or Snooze; afterwards 409 (RFC §10.4). */
  async undo(workspaceId: string, userId: string, id: string) {
    const now = Date.now();
    await this.prisma.system.$transaction(async (tx) => {
      const [row] = await tx.$queryRaw<
        Array<{
          status: string;
          accepted_at: Date | null;
          snoozed_at: Date | null;
          committed_at: Date | null;
          ask_owner_at: Date | null;
          ask_committed_at: Date | null;
        }>
      >`
        SELECT status, accepted_at, snoozed_at, committed_at, ask_owner_at, ask_committed_at FROM recommendations WHERE id = ${id}::uuid AND workspace_id = ${workspaceId}::uuid FOR UPDATE`;
      if (!row) throw new ProblemException(404, "not-found");
      const from = undoStart({
        status: row.status,
        acceptedAt: row.accepted_at,
        snoozedAt: row.snoozed_at,
        committedAt: row.committed_at,
        askOwnerAt: row.ask_owner_at,
        askCommittedAt: row.ask_committed_at,
      });
      if (!from || now - from.getTime() > UNDO_MS)
        throw new ProblemException(409, "undo-expired", "The 8-second Undo window has closed");
      const askOnly = !!row.ask_owner_at && row.status === "in_report";
      await tx.recommendation.update({
        where: { id },
        data: {
          askOwnerAt: null,
          askOwnerBy: null,
          askNote: null,
          // Cancelling an ask on an item that was already accepted and committed keeps it accepted.
          ...(askOnly
            ? {}
            : { status: "open", acceptedAt: null, acceptedBy: null, snoozedAt: null, snoozedUntil: null }),
        },
      });
      await tx.auditLog.create({ data: { workspaceId, userId, action: "recommendation.undo", target: id } });
      await this.outbox.add(tx, [
        eventRow(EventKeys.brief(workspaceId), "recommendation.undone", workspaceId, { id }),
      ]);
    });
    return this.get(workspaceId, id);
  }

  /**
   * Ask the owner (PD v2.7): a deliberate action, separate from Accept. Same 8 s Undo; then the commit creates the
   * Decision. From Open the accept is implied. Idempotent: a pending or already created ask is returned as it is.
   */
  async askOwner(workspaceId: string, userId: string, id: string, input: { note?: string }) {
    const now = new Date();
    await this.prisma.system.$transaction(async (tx) => {
      const [row] = await tx.$queryRaw<
        Array<{ status: string; committed_at: Date | null; ask_owner_at: Date | null }>
      >`SELECT status, committed_at, ask_owner_at FROM recommendations WHERE id = ${id}::uuid AND workspace_id = ${workspaceId}::uuid FOR UPDATE`;
      if (!row) throw new ProblemException(404, "not-found");
      if (row.ask_owner_at) return; // pending or already a decision
      if (!["open", "accepted", "in_report"].includes(row.status))
        throw new ProblemException(409, "not-open", "This item cannot be sent to the owner");
      const accepting = row.status === "open" || (row.status === "accepted" && !row.committed_at);
      const note = input.note?.trim() || null;
      await tx.recommendation.update({
        where: { id },
        data: {
          askOwnerAt: now,
          askOwnerBy: userId,
          askNote: note,
          // A new accept stamp: an earlier commit job for this item is ignored, the ask job takes over.
          ...(accepting ? { status: "accepted", acceptedAt: now, acceptedBy: userId } : {}),
        },
      });
      await tx.auditLog.create({
        data: { workspaceId, userId, action: "recommendation.ask_owner", target: id },
      });
      await this.outbox.add(tx, [
        jobRow(
          QUEUES.recommendationCommit,
          workspaceId,
          { id, acceptedAt: now.toISOString(), askedAt: now.toISOString() },
          "8s",
        ),
        eventRow(EventKeys.brief(workspaceId), "recommendation.asked", workspaceId, { id }),
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
   * `recommendation.commit` after 8 s. A plain Accept only becomes final (it never reaches the owner); an "ask the
   * owner" also snapshots a Decision. Undo and commit lock the same row, so exactly one wins (Tech Design §10.3).
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
      const now = new Date();
      if (job.askedAt) {
        // The ask this job belongs to must still be the live, uncommitted one.
        if (rec.askOwnerAt?.toISOString() !== job.askedAt || rec.askCommittedAt) return "skipped";
        if (rec.status !== "accepted" && rec.status !== "in_report") return "skipped";
        if (rec.status === "accepted" && rec.acceptedAt?.toISOString() !== job.acceptedAt) return "skipped";
        if (now.getTime() - rec.askOwnerAt.getTime() < UNDO_MS) return "early";
        const text = this.text(rec);
        const item = await tx.reportItem.create({
          data: {
            workspaceId: rec.workspaceId,
            recommendationId: rec.id,
            committedAt: now,
            note: rec.askNote,
            askedBy: rec.askOwnerBy,
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
          data: {
            askCommittedAt: now,
            ...(rec.status === "accepted" ? { status: "in_report", committedAt: now } : {}),
          },
        });
        await tx.auditLog.create({
          data: {
            workspaceId: rec.workspaceId,
            userId: rec.askOwnerBy,
            action: "recommendation.ask_owner.commit",
            target: rec.id,
          },
        });
        // Viewers (the owner / manager) hear about the new decision.
        await this.notifications.create(
          tx,
          rec.workspaceId,
          planDecisionAsked(await this.notifications.members(rec.workspaceId, tx), {
            decisionId: item.id,
            recommendationId: rec.id,
            fieldName: rec.field.name,
          }),
        );
        await this.outbox.add(tx, [
          eventRow(EventKeys.brief(rec.workspaceId), "recommendation.committed", rec.workspaceId, {
            id: rec.id,
          }),
        ]);
        return "committed";
      }
      if (rec.status !== "accepted" || rec.committedAt || rec.acceptedAt?.toISOString() !== job.acceptedAt)
        return "skipped";
      if (now.getTime() - rec.acceptedAt.getTime() < UNDO_MS) return "early";
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
