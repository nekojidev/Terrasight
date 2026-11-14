import { describe, expect, it } from "vitest";
import { nextMorning } from "./recommendations.service.js";

describe("nextMorning (Snooze until 06:00 in the workspace time zone)", () => {
  it("is tomorrow 06:00 after 06:00, today 06:00 before it", () => {
    expect(nextMorning(new Date("2026-11-14T15:00:00Z"), "America/Chicago").toISOString()).toBe(
      "2026-11-15T12:00:00.000Z",
    );
    expect(nextMorning(new Date("2026-11-14T09:00:00Z"), "America/Chicago").toISOString()).toBe(
      "2026-11-14T12:00:00.000Z",
    );
    expect(nextMorning(new Date("2026-11-14T10:00:00Z"), "Europe/Kyiv").toISOString()).toBe(
      "2026-11-15T04:00:00.000Z",
    );
  });
  it("handles the DST change (US clocks go back on 1 November 2026)", () => {
    // 31 Oct 12:00 CDT → 1 Nov 06:00 CST = 12:00 UTC
    expect(nextMorning(new Date("2026-10-31T17:00:00Z"), "America/Chicago").toISOString()).toBe(
      "2026-11-01T12:00:00.000Z",
    );
  });
});
