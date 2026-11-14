import { beforeEach, describe, expect, it } from "vitest";
import { clearDraft, draftKey, loadDraft, saveDraft } from "./offline";

describe("scout draft storage", () => {
  beforeEach(() => localStorage.clear());

  it("round-trips a draft with the queued flag", () => {
    saveDraft("t1", { counts: [1, null, 3, 0, 2], clientId: "c", queued: true });
    expect(loadDraft("t1")).toEqual({ counts: [1, null, 3, 0, 2], clientId: "c", queued: true });
  });

  it("treats old drafts as not queued and drops malformed ones", () => {
    localStorage.setItem(draftKey("t2"), JSON.stringify({ counts: [1], clientId: "c" }));
    expect(loadDraft("t2")?.queued).toBe(false);
    localStorage.setItem(draftKey("t3"), "{oops");
    expect(loadDraft("t3")).toBeNull();
    localStorage.setItem(draftKey("t4"), JSON.stringify({ counts: "x" }));
    expect(loadDraft("t4")).toBeNull();
  });

  it("clears a draft", () => {
    saveDraft("t1", { counts: [1], clientId: "c" });
    clearDraft("t1");
    expect(loadDraft("t1")).toBeNull();
  });
});
