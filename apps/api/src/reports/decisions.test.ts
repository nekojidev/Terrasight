import { describe, expect, it } from "vitest";
import { decisionState } from "./decisions.service.js";

const t = (n: number) => new Date(2026, 10, 1, 0, 0, n);

describe("decision state", () => {
  it("no answer is waiting", () => expect(decisionState([], [])).toBe("waiting"));
  it("approve and not_now decide", () => {
    expect(decisionState([{ answer: "approve", at: t(1) }], [])).toBe("approved");
    expect(decisionState([{ answer: "not_now", at: t(1) }], [])).toBe("not_now");
  });
  it("an unreplied question is a question; a reply makes it waiting again", () => {
    const a = [{ answer: "question" as const, at: t(2) }];
    expect(decisionState(a, [])).toBe("question");
    expect(decisionState(a, [{ at: t(1) }])).toBe("question"); // reply before the question does not count
    expect(decisionState(a, [{ at: t(3) }])).toBe("waiting");
  });
  it("the latest answer wins", () => {
    expect(
      decisionState(
        [
          { answer: "not_now", at: t(1) },
          { answer: "question", at: t(2) },
        ],
        [],
      ),
    ).toBe("question");
    expect(
      decisionState(
        [
          { answer: "question", at: t(1) },
          { answer: "approve", at: t(2) },
        ],
        [{ at: t(3) }],
      ),
    ).toBe("approved");
  });
});
