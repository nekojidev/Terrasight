import { classifyUrgency } from "@terrasight/evaluators";

/** Notification kinds (RFC §15.4); the client builds the text from kind + payload. */
export type NotificationKind = "report_answered" | "decision_asked" | "urgent_recommendation" | "run_failed";

export interface NotificationDraft {
  userId: string;
  kind: NotificationKind;
  payload: Record<string, unknown>;
}

export interface Member {
  userId: string;
  role: "owner" | "admin" | "agronomist" | "viewer";
}

/** Who works on recommendations: everyone except Viewers (the company owner / manager reads the report). */
export const staff = (members: Member[]): string[] =>
  members.filter((m) => m.role !== "viewer").map((m) => m.userId);

/** The owner answered a report item: tell the staff, except the person who did it (none for a report link). */
export function planReportAnswered(
  members: Member[],
  e: { reportItemId: string; answer: string; fieldName: string; actorId: string | null },
): NotificationDraft[] {
  return staff(members)
    .filter((id) => id !== e.actorId)
    .map((userId) => ({
      userId,
      kind: "report_answered" as const,
      payload: { reportItemId: e.reportItemId, answer: e.answer, fieldName: e.fieldName },
    }));
}

/** A decision was asked: tell the Owners and Viewers (the company owner / manager who answer it). */
export function planDecisionAsked(
  members: Member[],
  e: { decisionId: string; recommendationId: string; fieldName: string },
): NotificationDraft[] {
  return members
    .filter((m) => m.role === "viewer" || m.role === "owner")
    .map((m) => ({
      userId: m.userId,
      kind: "decision_asked" as const,
      payload: { decisionId: e.decisionId, recommendationId: e.recommendationId, fieldName: e.fieldName },
    }));
}

export interface NewRecommendation {
  id: string;
  fieldName: string;
  deadline: string | null;
  irreversible: boolean;
  planning: boolean;
}

/** New recommendations of a finished run that classify as Urgent (RFC §10.5) go to the staff. */
export function planUrgent(
  members: Member[],
  recs: NewRecommendation[],
  now: Date,
  timeZone: string,
): NotificationDraft[] {
  const urgent = recs.filter(
    (r) =>
      classifyUrgency(
        { deadline: r.deadline, irreversible: r.irreversible, planning: r.planning, openScoutingTask: false },
        now,
        timeZone,
      ) === "urgent",
  );
  return staff(members).flatMap((userId) =>
    urgent.map((r) => ({
      userId,
      kind: "urgent_recommendation" as const,
      payload: { recommendationId: r.id, fieldName: r.fieldName, deadline: r.deadline },
    })),
  );
}

/** A finished run with failed fields: whoever started it, or the staff for the scheduled run. */
export function planRunFailed(
  members: Member[],
  run: { runId: string; requestedBy: string | null; failed: number; total: number },
): NotificationDraft[] {
  if (run.failed <= 0) return [];
  const to = run.requestedBy ? [run.requestedBy] : staff(members);
  return to.map((userId) => ({
    userId,
    kind: "run_failed" as const,
    payload: { runId: run.runId, failed: run.failed, total: run.total },
  }));
}
