import { createHash, randomBytes } from "node:crypto";
import { Injectable } from "@nestjs/common";
import { classifyUrgency, compareItems, type Urgency } from "@terrasight/evaluators";
import { EventKeys } from "@terrasight/shared";
import { PrismaService } from "../db/prisma.service.js";
import type { Prisma } from "../generated/prisma/client.js";
import type { Language, OwnerAnswerKind } from "../generated/prisma/enums.js";
import { ProblemException } from "../http/problem.js";
import { eventRow } from "../messaging/outbox.js";
import { OutboxService } from "../messaging/outbox.service.js";
import { RecommendationsService } from "../recommendations/recommendations.service.js";

type Localised = { en: string; uk: string };
/** The snapshot written by the commit consumer (Tech Design §10.3): the report never changes by itself. */
interface ItemText {
  fieldName: string;
  title: Localised;
  action: Localised;
  why: Localised;
  scout: Localised | null;
  level: string;
  confidence: string;
  deadline: string | null;
  keyNumbers: Array<{ id: string; value: number | string; unit?: string }>;
  edited: boolean;
}

const hashToken = (t: string) => createHash("sha256").update(t).digest("hex");
const URGENCY_RANK: Record<Urgency, number> = { urgent: 0, this_week: 1, all_good: 2 };

/** Owner report (RFC D12, Tech Design §5.1, §14): items, one-tap answers, replies, report links. */
@Injectable()
export class ReportsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly outbox: OutboxService,
    private readonly recs: RecommendationsService,
  ) {}

  /** Live (not superseded) items grouped by field and urgency; answers and replies; "changed since accepted". */
  async report(workspaceId: string, lang?: Language, fieldId?: string) {
    const ws = await this.prisma.system.workspace.findUniqueOrThrow({
      where: { id: workspaceId },
      select: { name: true, timeZone: true, reportLanguage: true },
    });
    const items = await this.prisma.system.reportItem.findMany({
      where: { workspaceId, supersededBy: null, ...(fieldId ? { recommendation: { fieldId } } : {}) },
      orderBy: { committedAt: "desc" },
      include: {
        answers: { orderBy: { createdAt: "desc" } },
        replies: { orderBy: { createdAt: "asc" } },
        recommendation: { include: { field: { select: { name: true, aliasNo: true } } } },
      },
    });
    const now = new Date();
    const rows = items.map((i) => {
      const text = i.text as unknown as ItemText;
      const rec = i.recommendation;
      const current = this.recs.view(rec);
      const changed =
        current.level !== text.level ||
        current.deadline !== text.deadline ||
        current.text.title.en !== text.title.en ||
        current.text.action.en !== text.action.en;
      const urgency = classifyUrgency(
        {
          deadline: text.deadline,
          irreversible: rec.irreversible,
          planning: rec.planning,
          openScoutingTask: false,
        },
        now,
        ws.timeZone,
      );
      return {
        id: i.id,
        recommendationId: rec.id,
        fieldId: rec.fieldId,
        fieldName: text.fieldName,
        text,
        note: i.note,
        committedAt: i.committedAt,
        urgency,
        changedSinceAccepted: changed && rec.status !== "superseded",
        latestAnswer: i.answers[0]
          ? {
              answer: i.answers[0].answer,
              text: i.answers[0].text,
              via: i.answers[0].via,
              at: i.answers[0].createdAt,
            }
          : null,
        answers: i.answers.map((a) => ({ answer: a.answer, text: a.text, via: a.via, at: a.createdAt })),
        replies: i.replies.map((r) => ({ text: r.text, at: r.createdAt })),
      };
    });
    rows.sort(
      (a, b) =>
        URGENCY_RANK[a.urgency] - URGENCY_RANK[b.urgency] ||
        compareItems(
          { deadline: a.text.deadline, level: a.text.level as never, confidence: a.text.confidence as never },
          { deadline: b.text.deadline, level: b.text.level as never, confidence: b.text.confidence as never },
        ),
    );
    const byField = new Map<string, typeof rows>();
    for (const r of rows) (byField.get(r.fieldId) ?? byField.set(r.fieldId, []).get(r.fieldId)!).push(r);
    // Who reads the report: the company's Viewers (owner / manager), named on the month card.
    const viewers = await this.prisma.system.membership.findMany({
      where: { workspaceId, role: "viewer" },
      orderBy: { createdAt: "asc" },
      select: { user: { select: { name: true } } },
    });
    return {
      workspaceName: ws.name,
      recipients: viewers.map((v) => v.user.name),
      language: lang ?? ws.reportLanguage,
      counts: {
        items: rows.length,
        done: rows.filter((r) => r.latestAnswer?.answer === "done").length,
        questions: rows.filter((r) => r.latestAnswer?.answer === "question").length,
      },
      fields: [...byField.entries()].map(([id, list]) => ({
        fieldId: id,
        fieldName: list[0]!.fieldName,
        items: list,
      })),
    };
  }

  private async item(workspaceId: string, id: string) {
    const i = await this.prisma.system.reportItem.findFirst({
      where: { id, workspaceId },
      include: { recommendation: true },
    });
    if (!i) throw new ProblemException(404, "not-found");
    return i;
  }

  /** Republish: a new snapshot from the current recommendation supersedes the old item (agronomist decides). */
  async republish(workspaceId: string, userId: string, id: string) {
    const old = await this.item(workspaceId, id);
    if (old.supersededBy) throw new ProblemException(409, "superseded", "This item was already republished");
    const rec = await this.prisma.system.recommendation.findUniqueOrThrow({
      where: { id: old.recommendationId },
      include: { field: { select: { name: true, aliasNo: true } } },
    });
    const view = this.recs.view(rec);
    const text: ItemText = {
      fieldName: rec.field.name,
      title: view.text.title,
      action: view.text.action,
      why: view.text.why,
      scout: view.text.scout,
      level: rec.level,
      confidence: rec.confidence,
      deadline: view.deadline,
      keyNumbers: rec.keyNumbers as ItemText["keyNumbers"],
      edited: view.edited,
    };
    const created = await this.prisma.system.$transaction(async (tx) => {
      const n = await tx.reportItem.create({
        data: {
          workspaceId,
          recommendationId: rec.id,
          text: text as unknown as Prisma.InputJsonValue,
          note: old.note,
          committedAt: new Date(),
        },
      });
      await tx.reportItem.update({ where: { id: old.id }, data: { supersededBy: n.id } });
      await tx.auditLog.create({
        data: { workspaceId, userId, action: "report.republish", target: `${old.id}->${n.id}` },
      });
      return n;
    });
    return { id: created.id };
  }

  /** One-tap answer: Done / Not yet / Question (+ optional text). Latest shown, all kept (RFC §15.2). */
  async answer(
    workspaceId: string,
    id: string,
    body: { answer: OwnerAnswerKind; text?: string },
    by: { userId: string } | { link: true },
  ) {
    const item = await this.item(workspaceId, id);
    if (item.supersededBy)
      throw new ProblemException(409, "superseded", "This item was replaced by a newer one");
    const a = await this.prisma.system.ownerAnswer.create({
      data: {
        reportItemId: id,
        answer: body.answer,
        text: body.text?.trim() || null,
        via: "link" in by ? "link" : "user",
        userId: "userId" in by ? by.userId : null,
      },
    });
    await this.outbox.add(this.prisma.system, [
      eventRow(EventKeys.brief(workspaceId), "report.answered", workspaceId, { id, answer: body.answer }),
    ]);
    return { answer: a.answer, text: a.text, via: a.via, at: a.createdAt };
  }

  /**
   * Reply draft (RFC §12.6, S-08.05): a template from the item — what was recommended, why (top drivers and key
   * numbers), the deadline and the next step — in the report language. The owner's question is never sent anywhere.
   */
  async replyDraft(workspaceId: string, id: string) {
    const item = await this.item(workspaceId, id);
    const ws = await this.prisma.system.workspace.findUniqueOrThrow({
      where: { id: workspaceId },
      select: { reportLanguage: true },
    });
    const L = ws.reportLanguage;
    const t = item.text as unknown as ItemText;
    const date = t.deadline
      ? new Intl.DateTimeFormat(L === "uk" ? "uk-UA" : "en-US", {
          timeZone: "UTC",
          day: "numeric",
          month: "long",
        }).format(new Date(`${t.deadline}T12:00:00Z`))
      : null;
    const lines =
      L === "uk"
        ? [
            `${t.fieldName}: ${t.title.uk}.`,
            t.action.uk,
            `Чому: ${t.why.uk}.`,
            date ? `Вирішити до ${date}.` : "",
            "Якщо зручно, обговоримо деталі.",
          ]
        : [
            `${t.fieldName}: ${t.title.en}.`,
            t.action.en,
            `Why: ${t.why.en}.`,
            date ? `Decide by ${date}.` : "",
            "Happy to talk it through.",
          ];
    const question = await this.prisma.system.ownerAnswer.findFirst({
      where: { reportItemId: id, answer: "question" },
      orderBy: { createdAt: "desc" },
      select: { text: true, createdAt: true },
    });
    return { draft: lines.filter(Boolean).join(" "), language: L, question };
  }

  async reply(workspaceId: string, userId: string, id: string, text: string) {
    await this.item(workspaceId, id);
    const r = await this.prisma.system.reportReply.create({
      data: { reportItemId: id, text: text.trim(), userId },
    });
    await this.prisma.db.auditLog.create({
      data: { workspaceId, userId, action: "report.reply", target: id },
    });
    return { text: r.text, at: r.createdAt };
  }

  // ---------- report links (RFC §14.1) ----------

  async createLink(
    workspaceId: string,
    userId: string,
    body: { language: Language; expiresAt?: string | null },
  ) {
    const token = randomBytes(32).toString("base64url");
    const link = await this.prisma.system.reportLink.create({
      data: {
        workspaceId,
        tokenHash: hashToken(token),
        language: body.language,
        expiresAt: body.expiresAt ? new Date(body.expiresAt) : null,
      },
    });
    await this.prisma.db.auditLog.create({
      data: { workspaceId, userId, action: "reportLink.create", target: link.id },
    });
    // The token is shown once; only its hash is stored.
    return { id: link.id, token, path: `/r/${token}`, language: link.language, expiresAt: link.expiresAt };
  }

  async links(workspaceId: string) {
    const rows = await this.prisma.system.reportLink.findMany({
      where: { workspaceId },
      orderBy: { createdAt: "desc" },
    });
    return rows.map((l) => ({
      id: l.id,
      language: l.language,
      expiresAt: l.expiresAt,
      revokedAt: l.revokedAt,
      createdAt: l.createdAt,
    }));
  }

  async revokeLink(workspaceId: string, userId: string, id: string) {
    const r = await this.prisma.system.reportLink.updateMany({
      where: { id, workspaceId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    if (!r.count) throw new ProblemException(404, "not-found");
    await this.prisma.db.auditLog.create({
      data: { workspaceId, userId, action: "reportLink.revoke", target: id },
    });
  }

  /** Resolves a report link: valid, not revoked, not expired; else 404 (nothing else is reachable through it). */
  async byToken(token: string) {
    const link = await this.prisma.system.reportLink.findUnique({ where: { tokenHash: hashToken(token) } });
    if (!link || link.revokedAt || (link.expiresAt && link.expiresAt < new Date()))
      throw new ProblemException(404, "not-found");
    return link;
  }
}
