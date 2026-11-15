import { describe, expect, it } from "vitest";
import { displayText, formatDates, restoreAliases } from "./assistant-text";

const aliases = { F1: { name: "Поле Test" }, F2: { name: "North 40" }, F12: { name: "Twelve" } };

describe("restoreAliases", () => {
  it("maps aliases back to field names, whole tokens only", () => {
    expect(restoreAliases("On F2 and F12, not F3 or F22 or F1x.", aliases)).toBe(
      "On North 40 and Twelve, not F3 or F22 or F1x.",
    );
  });
  it("works next to Cyrillic letters and punctuation", () => {
    expect(restoreAliases("Поле F1: сухо. (F2)", aliases)).toBe("Поле Поле Test: сухо. (North 40)");
  });
});

describe("formatDates", () => {
  it("formats ISO dates and month-day pairs in English", () => {
    expect(formatDates("Sow from 2026-09-05 to 09-10.", "en")).toBe("Sow from September 5, 2026 to September 10.");
  });
  it("formats them in Ukrainian with the genitive month", () => {
    expect(formatDates("Сівба з 2026-09-05 до 09-10.", "uk")).toBe("Сівба з 5 вересня 2026 до 10 вересня.");
  });
  it("leaves impossible dates, ratios and longer numbers alone", () => {
    expect(formatDates("2026-13-40, 13-40, 12-2026, 1234-56-78, 10:30-11:45, 10-15 mm", "en")).toBe(
      "2026-13-40, 13-40, 12-2026, 1234-56-78, 10:30-11:45, 10-15 mm",
    );
  });
});

describe("displayText", () => {
  it("restores names then formats dates", () => {
    expect(displayText("F2: 2026-09-05", aliases, "uk")).toBe("North 40: 5 вересня 2026");
  });
});
