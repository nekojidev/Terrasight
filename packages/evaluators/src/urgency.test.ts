import { describe, expect, it } from "vitest";
import { classifyUrgency, compareItems, daysUntil } from "./urgency.js";

const TZ = "America/Chicago";
// 2026-11-14 09:00 in Chicago.
const NOW = new Date("2026-11-14T15:00:00Z");
const inDays = (n: number) =>
  new Date(Date.parse("2026-11-14T00:00:00Z") + n * 86_400_000).toISOString().slice(0, 10);
const item = (
  days: number | null,
  o: Partial<{ irreversible: boolean; planning: boolean; openScoutingTask: boolean }> = {},
) => ({
  deadline: days === null ? null : inDays(days),
  irreversible: false,
  planning: false,
  openScoutingTask: false,
  ...o,
});

describe("classifyUrgency (RFC §10.5)", () => {
  it.each([
    [2, false, "urgent"],
    [3, false, "this_week"],
    [6, true, "urgent"],
    [7, true, "urgent"],
    [8, true, "all_good"],
    [6, false, "this_week"],
    [7, false, "this_week"],
    [8, false, "all_good"],
    [-1, false, "urgent"],
    [null, false, "all_good"],
  ] as const)("%s days, irreversible %s → %s", (days, irreversible, expected) => {
    expect(classifyUrgency(item(days, { irreversible }), NOW, TZ)).toBe(expected);
  });

  it.each([
    [13, "this_week"],
    [14, "this_week"],
    [15, "all_good"],
    [5, "this_week"],
    [2, "urgent"],
  ] as const)("planning item %s days before its deadline → %s", (days, expected) => {
    expect(classifyUrgency(item(days, { planning: true }), NOW, TZ)).toBe(expected);
  });

  it("puts every open scouting task in This week", () => {
    expect(classifyUrgency(item(30, { openScoutingTask: true }), NOW, TZ)).toBe("this_week");
    expect(classifyUrgency(item(null, { openScoutingTask: true }), NOW, TZ)).toBe("this_week");
    expect(classifyUrgency(item(1, { openScoutingTask: true }), NOW, TZ)).toBe("urgent");
  });

  it("counts days in the workspace time zone", () => {
    // 2026-11-15 03:00 UTC is still 14 November in Chicago (21:00) but 15 November in Kyiv.
    const late = new Date("2026-11-15T03:00:00Z");
    expect(daysUntil("2026-11-17", late, "America/Chicago")).toBe(3);
    expect(daysUntil("2026-11-17", late, "Europe/Kyiv")).toBe(2);
    expect(
      classifyUrgency(
        { deadline: "2026-11-17", irreversible: false, planning: false, openScoutingTask: false },
        late,
        "Europe/Kyiv",
      ),
    ).toBe("urgent");
  });

  it("is unaffected by the DST change (US: 1 November 2026)", () => {
    const beforeDst = new Date("2026-10-31T17:00:00Z"); // 12:00 CDT
    expect(daysUntil("2026-11-02", beforeDst, TZ)).toBe(2);
    expect(daysUntil("2026-11-08", beforeDst, TZ)).toBe(8);
    expect(classifyUrgency(item(null), beforeDst, TZ)).toBe("all_good");
  });
});

describe("order inside a group", () => {
  it("sorts by deadline, then level, then confidence; no deadline last", () => {
    const xs = [
      { id: "c", deadline: null, level: "high" as const, confidence: "high" as const },
      { id: "b", deadline: "2026-11-16", level: "moderate" as const, confidence: "high" as const },
      { id: "a", deadline: "2026-11-16", level: "high" as const, confidence: "low" as const },
      { id: "d", deadline: "2026-11-15", level: "moderate" as const, confidence: "low" as const },
    ];
    expect([...xs].sort(compareItems).map((x) => x.id)).toEqual(["d", "a", "b", "c"]);
  });
});
