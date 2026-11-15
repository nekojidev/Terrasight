import { describe, expect, it } from "vitest";
import { factorText, type FactorFormatters } from "./work-windows";

const fmt: FactorFormatters = {
  wind: (n) => `${n} wind`,
  temp: (n) => `${n} temp`,
  rain: (n) => `${n} rain`,
  number: (n) => String(n),
};

describe("factorText", () => {
  it("uses the unit formatter of the factor", () => {
    expect(factorText({ factor: "gust", value: 5 }, fmt, "wwLim")).toEqual({ key: "wwLim_gust", v: "5 wind", h: "" });
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
