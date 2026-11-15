import { describe, expect, it } from "vitest";
import {
  deriveStage,
  emergenceDefault,
  emergencePromptDue,
  markSownDefault,
  nextStep,
  snoozeUntil,
} from "./seasonStage";

type Src = "confirmed" | "plan" | "estimate" | "regional" | "unknown";
const r = (value: string | null, source: Src) => ({ value, source });

describe("deriveStage", () => {
  it("is planned until sowing is confirmed, whatever the estimates say", () => {
    expect(deriveStage({ sowingDate: r("2026-10-10", "regional"), emergenceDate: r(null, "unknown") })).toBe("planned");
    expect(deriveStage({ sowingDate: r("2026-10-10", "plan"), emergenceDate: r("2026-10-25", "estimate") })).toBe(
      "planned",
    );
  });
  it("is sown once sowing is confirmed, emerged once emergence is too", () => {
    expect(deriveStage({ sowingDate: r("2026-10-10", "confirmed"), emergenceDate: r(null, "unknown") })).toBe("sown");
    expect(
      deriveStage({ sowingDate: r("2026-10-10", "confirmed"), emergenceDate: r("2026-10-24", "confirmed") }),
    ).toBe("emerged");
  });
});

describe("markSownDefault", () => {
  it("uses today within 7 days of the plan, on both sides", () => {
    expect(markSownDefault("2026-11-20", "2026-11-15")).toBe("2026-11-15");
    expect(markSownDefault("2026-11-08", "2026-11-15")).toBe("2026-11-15");
  });
  it("uses the planned date when further away, today when there is no plan", () => {
    expect(markSownDefault("2026-11-23", "2026-11-15")).toBe("2026-11-23");
    expect(markSownDefault("2026-11-01", "2026-11-15")).toBe("2026-11-01");
    expect(markSownDefault(null, "2026-11-15")).toBe("2026-11-15");
  });
});

describe("emergencePromptDue", () => {
  const base = { stage: "sown" as const, expected: "2026-10-25", today: "2026-10-22" };
  it("shows from 3 days before the expected date", () => {
    expect(emergencePromptDue(base)).toBe(true);
    expect(emergencePromptDue({ ...base, today: "2026-10-21" })).toBe(false);
    expect(emergencePromptDue({ ...base, today: "2026-11-10" })).toBe(true);
  });
  it("needs the sown stage and an expected date", () => {
    expect(emergencePromptDue({ ...base, stage: "planned" })).toBe(false);
    expect(emergencePromptDue({ ...base, stage: "emerged" })).toBe(false);
    expect(emergencePromptDue({ ...base, expected: null })).toBe(false);
  });
  it("stays hidden for 3 days after Not yet", () => {
    const until = snoozeUntil("2026-10-22");
    expect(until).toBe("2026-10-25");
    expect(emergencePromptDue({ ...base, snoozedUntil: until })).toBe(false);
    expect(emergencePromptDue({ ...base, today: "2026-10-24", snoozedUntil: until })).toBe(false);
    expect(emergencePromptDue({ ...base, today: "2026-10-25", snoozedUntil: until })).toBe(true);
  });
});

describe("emergenceDefault and nextStep", () => {
  it("never pre-fills a future date", () => {
    expect(emergenceDefault("2026-10-25", "2026-10-27")).toBe("2026-10-25");
    expect(emergenceDefault("2026-10-25", "2026-10-23")).toBe("2026-10-23");
    expect(emergenceDefault(null, "2026-10-23")).toBe("2026-10-23");
  });
  it("names one next step", () => {
    expect(nextStep("planned", false)).toBe("crop");
    expect(nextStep("planned", true)).toBe("sowing");
    expect(nextStep("sown", true)).toBe("emergence");
    expect(nextStep("emerged", true)).toBe("done");
  });
});
