import { describe, expect, it } from "vitest";
import { briefHeadline, humanizeDates } from "./brief";

describe("humanizeDates", () => {
  const fmt = (iso: string) => `<${iso.slice(5)}>`;
  it("replaces every ISO date and leaves the rest", () => {
    expect(humanizeDates("by 2026-11-21, frost on 2026-11-16.", fmt)).toBe("by <11-21>, frost on <11-16>.");
  });
  it("leaves invalid dates and long numbers alone", () => {
    expect(humanizeDates("id 2026-13-45 and 12026-11-21", fmt)).toBe("id 2026-13-45 and 12026-11-21");
  });
});

describe("briefHeadline", () => {
  it("owner with decisions leads with decisions", () => {
    expect(briefHeadline({ isOwner: true, decisions: 2, urgent: 1 })).toEqual({ kind: "decisions", n: 2 });
  });
  it("owner without decisions and agronomist fall back to urgent items", () => {
    expect(briefHeadline({ isOwner: true, decisions: 0, urgent: 1 })).toEqual({ kind: "urgent", n: 1 });
    expect(briefHeadline({ isOwner: false, decisions: 3, urgent: 2 })).toEqual({ kind: "urgent", n: 2 });
  });
  it("nothing urgent", () => {
    expect(briefHeadline({ isOwner: false, decisions: 0, urgent: 0 })).toEqual({ kind: "none", n: 0 });
  });
});
