import { describe, expect, it } from "vitest";
import { dateShortIn, greetingKey, hourIn, isAutumn, isSameDayIn, timeIn } from "./time";

describe("time helpers (zone-fixed, no browser zone)", () => {
  const noonUtc = new Date("2026-11-15T12:00:00Z");

  it("greets by the workspace hour, not the host zone", () => {
    expect(hourIn(noonUtc, "America/Chicago")).toBe(6);
    expect(greetingKey(noonUtc, "America/Chicago")).toBe("hiMorning");
    expect(greetingKey(noonUtc, "UTC")).toBe("hiDay");
    expect(greetingKey(new Date("2026-11-15T20:00:00Z"), "UTC")).toBe("hiEvening");
  });

  it("uses a neutral greeting until the time is known", () => {
    expect(greetingKey(null, "UTC")).toBe("hiDay");
  });

  it("formats the day and time in the given zone", () => {
    const iso = "2026-11-15T03:40:00Z";
    expect(dateShortIn(iso, "en", "America/Chicago")).toBe("Nov 14");
    expect(dateShortIn(iso, "en", "Europe/Kyiv")).toBe("Nov 15");
    expect(timeIn(iso, "en", "UTC")).toBe("03:40 AM");
  });

  it("compares calendar days in the zone", () => {
    expect(isSameDayIn(new Date("2026-11-15T03:00:00Z"), new Date("2026-11-14T23:00:00Z"), "America/Chicago")).toBe(true);
    expect(isSameDayIn(new Date("2026-11-15T03:00:00Z"), new Date("2026-11-14T23:00:00Z"), "UTC")).toBe(false);
  });

  it("detects autumn only once the time is known", () => {
    expect(isAutumn(noonUtc, "UTC")).toBe(true);
    expect(isAutumn(new Date("2026-04-01T00:00:00Z"), "UTC")).toBe(false);
    expect(isAutumn(null, "UTC")).toBe(false);
  });
});
