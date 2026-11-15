import { describe, expect, it } from "vitest";
import { planDecisionAsked, planReportAnswered, planRunFailed, planUrgent, type Member } from "./plan.js";

const members: Member[] = [
  { userId: "o", role: "owner" },
  { userId: "a", role: "agronomist" },
  { userId: "b", role: "agronomist" },
];
const NOW = new Date("2026-06-10T08:00:00Z");

describe("notification producers (RFC §15.4)", () => {
  it("report answer goes to everyone except the actor", () => {
    const d = planReportAnswered(members, {
      reportItemId: "i",
      answer: "question",
      fieldName: "Pivot 12",
      actorId: "o",
    });
    expect(d.map((x) => x.userId).sort()).toEqual(["a", "b"]);
    expect(d[0]).toMatchObject({
      kind: "report_answered",
      payload: { reportItemId: "i", answer: "question" },
    });
  });

  it("an answer by report link notifies all staff", () => {
    expect(
      planReportAnswered(members, { reportItemId: "i", answer: "done", fieldName: "F", actorId: null }),
    ).toHaveLength(3);
  });

  it("an asked decision notifies the Owners only", () => {
    const d = planDecisionAsked(members, { decisionId: "d", recommendationId: "r", fieldName: "Pivot 12" });
    expect(d.map((x) => x.userId).sort()).toEqual(["o"]);
    expect(d[0]).toMatchObject({
      kind: "decision_asked",
      payload: { decisionId: "d", recommendationId: "r", fieldName: "Pivot 12" },
    });
  });

  it("only Urgent new recommendations notify", () => {
    const recs = [
      { id: "r1", fieldName: "A", deadline: "2026-06-11", irreversible: false, planning: false },
      { id: "r2", fieldName: "B", deadline: "2026-06-30", irreversible: false, planning: false },
      { id: "r3", fieldName: "C", deadline: "2026-06-16", irreversible: true, planning: false },
      { id: "r4", fieldName: "D", deadline: null, irreversible: false, planning: false },
    ];
    const d = planUrgent(members, recs, NOW, "America/Chicago");
    expect(d.filter((x) => x.userId === "a").map((x) => x.payload.recommendationId)).toEqual(["r1", "r3"]);
    // The Owner does field work too, so Urgent items reach them as well.
    expect(d.some((x) => x.userId === "o")).toBe(true);
  });

  it("failed run: the requester, or staff for the scheduled run; nothing when no failures", () => {
    expect(
      planRunFailed(members, { runId: "x", requestedBy: "a", failed: 1, total: 3 }).map((x) => x.userId),
    ).toEqual(["a"]);
    expect(planRunFailed(members, { runId: "x", requestedBy: null, failed: 2, total: 3 })).toHaveLength(3);
    expect(planRunFailed(members, { runId: "x", requestedBy: null, failed: 0, total: 3 })).toEqual([]);
  });
});
