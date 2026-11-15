import { describe, expect, it } from "vitest";
import {
  dayShift,
  formatArea,
  formatDayOfYear,
  formatRainDelta,
  formatSigned,
  formatTempDelta,
  formatDate,
  formatDistance,
  formatMoney,
  formatNumber,
  formatPercent,
  formatRain,
  formatTemp,
  formatWind,
  formatYield,
  plural,
} from "./format";

describe("formatDate", () => {
  const d = "2026-11-15T10:30:00Z";
  it("formats in the given zone and locale", () => {
    expect(formatDate(d, "en", "dayMonth", { timeZone: "UTC" })).toBe("Nov 15");
    expect(formatDate(d, "en", "full", { timeZone: "UTC" })).toBe("November 15, 2026");
    expect(formatDate(d, "en", "time", { timeZone: "Europe/Kyiv" })).toMatch(/12:30/);
    expect(formatDate(d, "uk", "day", { timeZone: "UTC" })).toBe("15");
    expect(formatDate(d, "uk", "dayMonth", { timeZone: "UTC" })).toMatch(/15\s+лист/);
  });
});

describe("numbers", () => {
  it("formats numbers and percents per locale", () => {
    expect(formatNumber(1234.56, "en")).toBe("1,234.6");
    expect(formatNumber(1234.56, "en", { maximumFractionDigits: 0 })).toBe("1,235");
    expect(formatNumber(0.5, "uk")).toBe("0,5");
    expect(formatPercent(0.256, "en")).toBe("26%");
  });
  it("formats money, compact via Intl", () => {
    expect(formatMoney(1234, "USD", "en")).toBe("$1,234");
    expect(formatMoney(12_000, "USD", "en", { compact: true })).toBe("$12K");
    expect(formatMoney(1500, "UAH", "uk")).toContain("₴");
  });
});

describe("units", () => {
  it("converts area ha <-> ac", () => {
    expect(formatArea(10, "metric", "en")).toBe("10 ha");
    expect(formatArea(10, "imperial", "en")).toBe("24.7 ac");
  });
  it("converts distance", () => {
    expect(formatDistance(500, "metric", "en")).toBe("500 m");
    expect(formatDistance(2500, "metric", "en")).toBe("2.5 km");
    expect(formatDistance(100, "imperial", "en")).toBe("328 ft");
    expect(formatDistance(2000, "imperial", "en")).toBe("1.2 mi");
  });
  it("converts yield, temperature, wind and rain", () => {
    expect(formatYield(10, "metric", "en")).toBe("10\u00A0t/ha");
    expect(formatYield(10, "imperial", "en")).toBe("4\u00A0t/ac");
    expect(formatYield(8, "metric", "uk")).toBe("8\u00A0т/га");
    expect(formatTemp(20, "imperial", "en")).toBe("68°F");
    expect(formatTemp(20, "metric", "en")).toBe("20°C");
    expect(formatWind(10, "metric", "en")).toBe("10 m/s");
    expect(formatWind(10, "imperial", "en")).toBe("22 mph");
    expect(formatRain(25.4, "imperial", "en")).toBe("1 in");
    expect(formatRain(4.25, "metric", "en")).toBe("4.3 mm");
  });
});

describe("plural", () => {
  const forms = { one: "{n} field", other: "{n} fields" };
  const uk = { one: "{n} поле", few: "{n} поля", many: "{n} полів", other: "{n} поля" };
  it("English one/other", () => {
    expect(plural(1, "en", forms)).toBe("1 field");
    expect(plural(3, "en", forms)).toBe("3 fields");
  });
  it("Ukrainian one/few/many", () => {
    expect(plural(1, "uk", uk)).toBe("1 поле");
    expect(plural(2, "uk", uk)).toBe("2 поля");
    expect(plural(5, "uk", uk)).toBe("5 полів");
    expect(plural(21, "uk", uk)).toBe("21 поле");
    expect(plural(11, "uk", uk)).toBe("11 полів");
  });
});

describe("signed values and climate differences", () => {
  it("uses a true minus and an explicit plus, never -0", () => {
    expect(formatSigned(1.44, "en")).toBe("+1.4");
    expect(formatSigned(-0.6, "en")).toBe("\u22120.6");
    expect(formatSigned(-0.04, "en")).toBe("0");
    expect(formatSigned(0, "en")).toBe("0");
    expect(formatSigned(-3, "uk", { maximumFractionDigits: 0 })).toBe("\u22123");
    expect(formatSigned(2.5, "uk")).toBe("+2,5");
  });
  it("scales a temperature difference without the +32 offset", () => {
    expect(formatTempDelta(1, "imperial", "en")).toBe("+1.8°F");
    expect(formatTempDelta(1, "imperial", "en")).not.toContain("33");
    expect(formatTempDelta(-1, "metric", "en")).toMatch(/^\u22121 ?°C$/);
  });
  it("converts a rain difference to inches", () => {
    expect(formatRainDelta(25.4, "imperial", "en")).toMatch(/^\+1(\.00)? ?in$/);
    expect(formatRainDelta(-30, "metric", "en")).toMatch(/^\u221230 ?mm$/);
  });
  it("turns a day of year into a date and a shift", () => {
    expect(formatDayOfYear(132, "en")).toBe("May 12");
    expect(formatDayOfYear(1, "en")).toBe("Jan 1");
    expect(dayShift(-8.2)).toEqual({ days: 8, direction: "earlier" });
    expect(dayShift(3)).toEqual({ days: 3, direction: "later" });
    expect(dayShift(0.2)).toEqual({ days: 0, direction: "same" });
    expect(dayShift(-1.46, 1)).toEqual({ days: 1.5, direction: "earlier" });
  });
});
