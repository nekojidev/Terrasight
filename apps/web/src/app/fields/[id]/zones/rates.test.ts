import { describe, expect, it } from "vitest";
import { toApiRate, unitSymbol } from "./rates";

describe("rates", () => {
  it("keeps metric rates as typed", () => {
    expect(toApiRate("120,5", "kg/ha", "metric")).toBe(120.5);
  });
  it("converts US rates to the API unit", () => {
    expect(toApiRate("100", "kg/ha", "imperial")).toBeCloseTo(112.085, 2);
    expect(toApiRate("1", "l/ha", "imperial")).toBeCloseTo(9.354, 2);
  });
  it("rejects empty and negative input", () => {
    expect(toApiRate("", "kg/ha", "metric")).toBeNaN();
    expect(toApiRate("-1", "kg/ha", "metric")).toBeNaN();
  });
  it("names the unit by country", () => {
    expect(unitSymbol("kg/ha", "imperial")).toBe("lb/ac");
    expect(unitSymbol("l/ha", "metric")).toBe("l/ha");
  });
});
