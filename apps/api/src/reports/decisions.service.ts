import { Inject, Injectable, Logger, Optional } from "@nestjs/common";
import type { Library } from "@terrasight/library";
import type {
  AnswerBody,
  Decision,
  DecisionAnswer,
  DecisionList,
  DecisionState,
  PublicDecisions,
  ThreadEntry,
} from "@terrasight/shared";
import { EventKeys } from "@terrasight/shared";
import { PrismaService } from "../db/prisma.service.js";
import { Prisma } from "../generated/prisma/client.js";
import type { OwnerAnswerKind } from "../generated/prisma/enums.js";
import { ProblemException } from "../http/problem.js";
import { eventRow } from "../messaging/outbox.js";
import { OutboxService } from "../messaging/outbox.service.js";
import { NotificationsService } from "../notifications/notifications.service.js";
import { planReportAnswered } from "../notifications/plan.js";
import { LIBRARY } from "../library/library.module.js";
import { ownerQuestionText } from "../recommendations/text.js";
import { RecommendationsService } from "../recommendations/recommendations.service.js";

type Localised = { en: string; uk: string };
/** The snapshot written by the commit (Tech Design §10.3): a decision never changes by itself. */
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

/** Decided items older than this drop off the public (link) view. */
export const PUBLIC_DECIDED_DAYS = 30;

const TO_DB: Record<DecisionAnswer, OwnerAnswerKind> = {
  approve: "done",
  not_now: "not_yet",
  question: "question",
};
const FROM_DB: Record<OwnerAnswerKind, DecisionAnswer> = {
  done: "approve",
  not_yet: "not_now",
  question: "question",
};

export const DECISIONS_PAGE = 100;
export const DECISIONS_PAGE_MAX = 200;

/** Live (not superseded) decisions with their state worked out in SQL; mirrors decisionState(). */
const stateCte = (workspaceId: string) => Prisma.sql`WITH s AS (
  SELECT ri.id, ri.committed_at,
    CASE
      WHEN la.answer IS NULL THEN 'waiting'
      WHEN la.answer = 'done' THEN 'approved'
      WHEN la.answer = 'not_yet' THEN 'not_now'
      WHEN EXISTS (SELECT 1 FROM report_replies rr WHERE rr.report_item_id = ri.id AND rr.created_at > la.created_at) THEN 'waiting'
      ELSE 'question'
    END AS state
  FROM report_items ri
  LEFT JOIN LATERAL (
    SELECT oa.answer, oa.created_at FROM owner_answers oa
    WHERE oa.report_item_id = ri.id ORDER BY oa.created_at DESC, oa.id DESC LIMIT 1
  ) la ON true
  WHERE ri.workspace_id = ${workspaceId}::uuid AND ri.superseded_by IS NULL)`;

export function encodeCursor(at: Date, id: string): string {
  return Buffer.from(`${at.toISOString()}|${id}`).toString("base64url");
}

export function decodeCursor(cursor: string): { at: string; id: string } {
  const [at, id] = Buffer.from(cursor, "base64url").toString().split("|");
  if (!at || !id || Number.isNaN(Date.parse(at)) || !/^[0-9a-f-]{36}$/i.test(id))
    throw new ProblemException(422, "invalid-input", "Bad cursor");
  return { at, id };
}

const include = {
  answers: { orderBy: { createdAt: "asc" } },
  replies: { orderBy: { createdAt: "asc" } },
  recommendation: { include: { field: { select: { name: true, aliasNo: true } } } },
} satisfies Prisma.ReportItemInclude;
type Row = Prisma.ReportItemGetPayload<{ include: typeof include }>;

/**
 * State from the thread: no answer → waiting; latest answer question with no reply after it → question (a replied
 * question is waiting again); latest approve → approved; latest not_now → not_now.
 */
export function decisionState(
  answers: Array<{ answer: DecisionAnswer; at: Date }>,
  replies: Array<{ at: Date }>,
): DecisionState {
  const latest = answers.reduce<(typeof answers)[number] | null>(
    (m, a) => (!m || a.at.getTime() >= m.at.getTime() ? a : m),
    null,
  );
  if (!latest) return "waiting";
  if (latest.answer === "approve") return "approved";
  if (latest.answer === "not_now") return "not_now";
  return replies.some((r) => r.at.getTime() > latest.at.getTime()) ? "waiting" : "question";
}

/** Owner decisions (PD v2.7, contract packages/shared/src/decisions.ts): list, answer, replies, republish, links. */
@Injectable()
export class DecisionsService {
  private readonly log = new Logger(DecisionsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly outbox: OutboxService,
    private readonly recs: RecommendationsService,
    private readonly notifications: NotificationsService,
    @Optional() @Inject(LIBRARY) private readonly lib: Library | null = null,
  ) {}

  private async names(ids: Array<string | null>): Promise<Map<string, string>> {
    const unique = [...new Set(ids.filter((x): x is string => !!x))];
    const users = unique.length
      ? await this.prisma.system.user.findMany({
          where: { id: { in: unique } },
          select: { id: true, name: true },
        })
      : [];
    return new Map(users.map((u) => [u.id, u.name]));
  }

  private build(i: Row, names: Map<string, string>): Decision {
    const text = i.text as unknown as ItemText;
    const rec = i.recommendation;
    const current = this.recs.view(rec);
    const changed =
      current.level !== text.level ||
      current.deadline !== text.deadline ||
      current.text.title.en !== text.title.en ||
      current.text.action.en !== text.action.en;
    const asker = (i.askedBy && names.get(i.askedBy)) || "";
    const thread: ThreadEntry[] = [];
    if (i.note)
      thread.push({
        id: `${i.id}:note`,
        kind: "note",
        author: { name: asker, role: "agronomist" },
        text: i.note,
        at: i.committedAt.toISOString(),
      });
    for (const a of i.answers)
      thread.push({
        id: a.id,
        kind: "answer",
        author: {
          name: a.via === "link" ? "link" : ((a.userId && names.get(a.userId)) ?? ""),
          role: "owner",
        },
        answer: FROM_DB[a.answer],
        text: a.text,
        at: a.createdAt.toISOString(),
        via: a.via,
      });
    for (const r of i.replies)
      thread.push({
        id: r.id,
        kind: "reply",
        author: { name: names.get(r.userId) ?? "", role: "agronomist" },
        text: r.text,
        at: r.createdAt.toISOString(),
      });
    thread.sort((a, b) => a.at.localeCompare(b.at));
    return {
      id: i.id,
      recommendationId: rec.id,
      fieldId: rec.fieldId,
      fieldName: text.fieldName,
      title: text.title,
      question: ownerQuestionText(rec, this.lib, text.fieldName, asker, text.title),
      action: text.action,
      why: text.why,
      deadline: text.deadline,
      keyNumbers: text.keyNumbers,
      askedAt: i.committedAt.toISOString(),
      askedBy: { name: asker },
      state: decisionState(
        i.answers.map((a) => ({ answer: FROM_DB[a.answer], at: a.createdAt })),
        i.replies.map((r) => ({ at: r.createdAt })),
      ),
      changedSinceAsked: changed && rec.status !== "superseded",
      thread,
    };
  }

  private async decisions(workspaceId: string): Promise<Decision[]> {
    const rows = await this.prisma.db.reportItem.findMany({
      where: { workspaceId, supersededBy: null },
      orderBy: { committedAt: "desc" },
      include,
    });
    const names = await this.names(
      rows.flatMap((r) => [r.askedBy, ...r.answers.map((a) => a.userId), ...r.replies.map((x) => x.userId)]),
    );
    return rows.map((r) => this.build(r, names));
  }

  private async one(workspaceId: string, id: string): Promise<Decision> {
    const row = await this.prisma.db.reportItem.findFirst({ where: { id, workspaceId }, include });
    if (!row) throw new ProblemException(404, "not-found");
    const names = await this.names([
      row.askedBy,
      ...row.answers.map((a) => a.userId),
      ...row.replies.map((r) => r.userId),
    ]);
    return this.build(row, names);
  }

  private async item(workspaceId: string, id: string) {
    const i = await this.prisma.db.reportItem.findFirst({ where: { id, workspaceId } });
    if (!i) throw new ProblemException(404, "not-found");
    return i;
  }

  /**
   * The staff view: live decisions newest first, one page at a time (cursor on committedAt, id), counts per state
   * computed in SQL over all decisions, the Owners who receive them.
   */
  async list(
    workspaceId: string,
    state: "waiting" | "question" | "decided" | "all",
    page: { limit?: number; cursor?: string | null } = {},
  ): Promise<DecisionList> {
    const ws = await this.prisma.system.workspace.findUniqueOrThrow({
      where: { id: workspaceId },
      select: { name: true, reportLanguage: true },
    });
    const limit = Math.min(Math.max(Math.trunc(page.limit ?? DECISIONS_PAGE), 1), DECISIONS_PAGE_MAX);
    const cur = page.cursor ? decodeCursor(page.cursor) : null;
    const states = state === "all" ? ["waiting", "question", "approved", "not_now"] : state === "decided" ? ["approved", "not_now"] : [state];
    const [countRows, idRows, owners] = await Promise.all([
      this.prisma.system.$queryRaw<Array<{ state: DecisionState; n: bigint }>>`
        ${stateCte(workspaceId)}
        SELECT state, count(*) AS n FROM s GROUP BY state`,
      this.prisma.system.$queryRaw<Array<{ id: string }>>`
        ${stateCte(workspaceId)}
        SELECT id FROM s
        WHERE state = ANY(${states})
          AND (${cur?.at ?? null}::timestamptz IS NULL OR (committed_at, id) < (${cur?.at ?? null}::timestamptz, ${cur?.id ?? null}::uuid))
        ORDER BY committed_at DESC, id DESC LIMIT ${limit + 1}`,
      this.prisma.system.membership.findMany({
        where: { workspaceId, role: "owner" },
        orderBy: { createdAt: "asc" },
        select: { user: { select: { name: true } } },
      }),
    ]);
    const n = (s: string) => Number(countRows.find((r) => r.state === s)?.n ?? 0);
    const ids = idRows.slice(0, limit).map((r) => r.id);
    const rows = ids.length
      ? await this.prisma.system.reportItem.findMany({ where: { id: { in: ids }, workspaceId }, include })
      : [];
    const byId = new Map(rows.map((r) => [r.id, r]));
    const ordered = ids.map((id) => byId.get(id)).filter((r): r is Row => !!r);
    const names = await this.names(
      ordered.flatMap((r) => [r.askedBy, ...r.answers.map((a) => a.userId), ...r.replies.map((x) => x.userId)]),
    );
    const last = ordered.at(-1);
    return {
      workspaceName: ws.name,
      language: ws.reportLanguage,
      counts: { waiting: n("waiting"), question: n("question"), decided: n("approved") + n("not_now") },
      recipients: owners.map((v) => v.user.name),
      items: ordered.map((r) => this.build(r, names)),
      nextCursor: idRows.length > limit && last ? encodeCursor(last.committedAt, last.id) : null,
    };
  }

  /** The owner's view through a report link: live decisions, without long-decided ones. */
  async publicView(workspaceId: string, language: "en" | "uk"): Promise<PublicDecisions> {
    const ws = await this.prisma.system.workspace.findUniqueOrThrow({
      where: { id: workspaceId },
      select: { name: true },
    });
    const cutoff = Date.now() - PUBLIC_DECIDED_DAYS * 864e5;
    const items = (await this.decisions(workspaceId)).filter((d) => {
      if (d.state !== "approved" && d.state !== "not_now") return true;
      const last = d.thread.filter((t) => t.kind === "answer").at(-1);
      return !last || new Date(last.at).getTime() >= cutoff;
    });
    return { workspaceName: ws.name, language, items };
  }

  /** One-tap answer (Approve / Not now / Ask…); all answers are kept, the latest decides the state. */
  async answer(workspaceId: string, id: string, body: AnswerBody, by: { userId: string } | { link: true }) {
    const item = await this.item(workspaceId, id);
    if (item.supersededBy)
      throw new ProblemException(409, "superseded", "This decision was replaced by a newer one");
    await this.prisma.db.ownerAnswer.create({
      data: {
        reportItemId: id,
        answer: TO_DB[body.answer],
        text: body.text?.trim() || null,
        via: "link" in by ? "link" : "user",
        userId: "userId" in by ? by.userId : null,
      },
    });
    await this.outbox.add(this.prisma.system, [
      eventRow(EventKeys.brief(workspaceId), "report.answered", workspaceId, {
        id,
        answer: TO_DB[body.answer],
      }),
    ]);
    // Notify the staff (RFC §15.4); a failure here must not lose the owner's answer.
    try {
      await this.notifications.create(
        this.prisma.system,
        workspaceId,
        planReportAnswered(await this.notifications.members(workspaceId), {
          reportItemId: id,
          answer: TO_DB[body.answer],
          fieldName: (item.text as unknown as ItemText).fieldName,
          actorId: "userId" in by ? by.userId : null,
        }),
      );
    } catch (e) {
      this.log.warn(`report.answered notification for item ${id} failed: ${(e as Error).message}`);
    }
    return this.one(workspaceId, id);
  }

  async reply(workspaceId: string, userId: string, id: string, text: string) {
    await this.item(workspaceId, id);
    await this.prisma.db.reportReply.create({
      data: { reportItemId: id, text: text.trim(), userId },
    });
    await this.prisma.db.auditLog.create({
      data: { workspaceId, userId, action: "decision.reply", target: id },
    });
    return this.one(workspaceId, id);
  }

  /**
   * Reply draft (RFC §12.6, S-08.05): a template from the decision (what was recommended, why, the deadline, next
   * step) in the report language, phrased as a reply to the owner's latest unanswered question or as a summary.
   */
  async replyDraft(workspaceId: string, id: string) {
    const d = await this.one(workspaceId, id);
    const ws = await this.prisma.system.workspace.findUniqueOrThrow({
      where: { id: workspaceId },
      select: { reportLanguage: true },
    });
    const L = ws.reportLanguage;
    const date = d.deadline
      ? new Intl.DateTimeFormat(L === "uk" ? "uk-UA" : "en-US", {
          timeZone: "UTC",
          day: "numeric",
          month: "long",
        }).format(new Date(`${d.deadline}T12:00:00Z`))
      : null;
    const q = d.state === "question" ? d.thread.filter((t) => t.kind === "answer").at(-1) : undefined;
    const question = q?.answer === "question" ? q.text?.trim() : null;
    const lines =
      L === "uk"
        ? [
            question ? `Щодо вашого запитання «${question}»:` : "",
            `${d.fieldName}: ${d.title.uk}.`,
            d.action.uk,
            `Чому: ${d.why.uk}.`,
            date ? `Вирішити до ${date}.` : "",
            "Якщо зручно, обговоримо деталі.",
          ]
        : [
            question ? `On your question “${question}”:` : "",
            `${d.fieldName}: ${d.title.en}.`,
            d.action.en,
            `Why: ${d.why.en}.`,
            date ? `Decide by ${date}.` : "",
            "Happy to talk it through.",
          ];
    return { draft: lines.filter(Boolean).join(" "), language: L };
  }

  /** Republish: a new snapshot from the current recommendation supersedes the old decision (agronomist decides). */
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
          askedBy: old.askedBy,
          committedAt: new Date(),
        },
      });
      await tx.reportItem.update({ where: { id: old.id }, data: { supersededBy: n.id } });
      await tx.auditLog.create({
        data: { workspaceId, userId, action: "decision.republish", target: `${old.id}->${n.id}` },
      });
      return n;
    });
    return this.one(workspaceId, created.id);
  }
}
