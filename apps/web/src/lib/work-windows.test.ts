import { describe, expect, it } from "vitest";
import {
  bestDay,
  factorText,
  unitsForCountry,
  type FactorFormatters,
  type FieldWindows,
  type WindowStatus,
} from "./work-windows";

const field = (id: string, st: WindowStatus[] | null, country: string | null = "US"): FieldWindows => ({
  fieldId: id,
  name: id,
  country,
  sowingCrop: null,
  available: st !== null,
  forecast: null,
  now: null,
  operations: st
    ? [
        {
          operation: "spraying",
          applicable: true,
          days: st.map((status, i) => ({ date: `2026-11-${16 + i}`, status, limiting: null, windows: [] })),
        },
      ]
    : [],
});

describe("bestDay", () => {
  it("picks the day with the most good fields, earliest on a tie", () => {
    const r = bestDay(
      [
        field("a", ["good", "good", "no"]),
        field("b", ["no", "good", "good"]),
        field("c", ["marginal", "good", "good"]),
      ],
      "spraying",
    );
    expect(r).toEqual({ date: "2026-11-17", index: 1, good: 3, total: 3 });
  });
  it("does not count fields without a verdict", () => {
    const r = bestDay(
      [field("a", ["no", "good"]), field("b", ["unknown", "unknown"]), field("c", null)],
      "spraying",
    );
    expect(r).toEqual({ date: "2026-11-17", index: 1, good: 1, total: 1 });
  });
  it("is null when no day is good", () => {
    expect(bestDay([field("a", ["no", "marginal"])], "spraying")).toBeNull();
    expect(bestDay([], "spraying")).toBeNull();
  });
});

describe("unitsForCountry", () => {
  it("follows the field country", () => {
    expect(unitsForCountry("US", "metric")).toBe("imperial");
    expect(unitsForCountry("UA", "imperial")).toBe("metric");
    expect(unitsForCountry(null, "imperial")).toBe("imperial");
  });
});

const fmt: FactorFormatters = {
  wind: (n) => `${n} wind`,
  temp: (n) => `${n} temp`,
  rain: (n) => `${n} rain`,
  number: (n) => String(n),
};

describe("factorText", () => {
  it("uses the unit formatter of the factor", () => {
    expect(factorText({ factor: "gust", value: 5 }, fmt, "wwLim")).toEqual({
      key: "wwLim_gust",
      v: "5 wind",
      h: "",
    });
    expect(factorText({ factor: "soil_temp", value: 7 }, fmt, "wwCond").v).toBe("7 temp");
    expect(factorText({ factor: "rain_day", value: 2 }, fmt, "wwCond").v).toBe("2 rain");
  });
  it("keeps Delta T as a plain number and hours for rain_soon", () => {
    expect(factorText({ factor: "delta_t", value: 12 }, fmt, "wwCond").v).toBe("12");
    expect(factorText({ factor: "rain_soon", value: 2 }, fmt, "wwLim").h).toBe("2");
  });
  it("tolerates a missing value", () => {
    expect(factorText({ factor: "wind", value: null }, fmt, "wwLim").v).toBe("");
  });
});
