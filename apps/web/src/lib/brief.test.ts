import { describe, expect, it } from "vitest";
import { briefHeadline, formatKeyNumber, humanizeDates, type KeyNumberFormat } from "./brief";

describe("formatKeyNumber", () => {
  const fmt: KeyNumberFormat = {
    date: (iso) => `d:${iso}`,
    number: (n) => `n:${n}`,
    percent: (f) => `p:${f}`,
    temp: (c) => `t:${c}`,
    rain: (mm) => `r:${mm}`,
    money: (a, c) => `${c}${a}`,
  };
  it("formats known ids by kind", () => {
    expect(formatKeyNumber({ id: "daysUntilFrost", value: 6, unit: "days" }, fmt)).toBe("n:6");
    expect(formatKeyNumber({ id: "autumnPercentile", value: 80 }, fmt)).toBe("p:0.8");
    expect(formatKeyNumber({ id: "frostMinC", value: -2, unit: "°C" }, fmt)).toBe("t:-2");
    expect(formatKeyNumber({ id: "depletionMm", value: 40 }, fmt)).toBe("r:40");
    expect(formatKeyNumber({ id: "sowingDate", value: "2026-11-21" }, fmt)).toBe("d:2026-11-21");
    expect(formatKeyNumber({ id: "marginVsCurrent", value: 123, unit: "$/ha" }, fmt)).toBe("USD123");
    expect(formatKeyNumber({ id: "marginVsCurrent", value: 5, unit: "UAH/ha" }, fmt)).toBe("UAH5");
  });
  it("hides unknown ids and values that do not fit", () => {
    expect(formatKeyNumber({ id: "mystery", value: 1 }, fmt)).toBeNull();
    expect(formatKeyNumber({ id: "daysToStress", value: "—" }, fmt)).toBeNull();
    expect(formatKeyNumber({ id: "sowingDate", value: 5 }, fmt)).toBeNull();
    expect(formatKeyNumber({ id: "marginVsCurrent", value: 5, unit: "EUR/ha" }, fmt)).toBeNull();
  });
});

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
