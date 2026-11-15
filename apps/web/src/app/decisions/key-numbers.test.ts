import { describe, expect, it } from "vitest";
import { keyNumberViews, unitSymbol } from "./key-numbers";

const fmt = { number: (n: number) => String(n), date: (iso: string) => `D(${iso})` };
const labels: Record<string, string> = {
  a: "°C mean this autumn",
  b: "days until frost",
  c: "sowing date",
  d: "seasons in a row",
};
const label = (id: string) => labels[id] ?? null;

describe("keyNumberViews", () => {
  it("hides numbers without a translated label", () => {
    const v = keyNumberViews({ keyNumbers: [{ id: "kn_missing", value: 1 }, { id: "b", value: 4, unit: "days" }] }, fmt, label);
    expect(v).toHaveLength(1);
    expect(v[0]?.id).toBe("b");
  });

  it("puts the unit on the value and cuts it from the label", () => {
    const [v] = keyNumberViews({ keyNumbers: [{ id: "a", value: 12, unit: "°C" }] }, fmt, label);
    expect(v).toEqual({ id: "a", value: "12 °C", label: "mean this autumn" });
  });

  it("formats dates and skips descriptive units", () => {
    const v = keyNumberViews(
      { keyNumbers: [{ id: "c", value: "2026-04-20" }, { id: "d", value: 3, unit: "host seasons in a row" }] },
      fmt,
      label,
    );
    expect(v.map((x) => x.value)).toEqual(["D(2026-04-20)", "3"]);
  });

  it("returns at most three", () => {
    const keyNumbers = ["a", "b", "c", "d"].map((id) => ({ id, value: 1 }));
    expect(keyNumberViews({ keyNumbers }, fmt, label)).toHaveLength(3);
  });
});

describe("unitSymbol", () => {
  it("takes the leading known unit", () => {
    expect(unitSymbol("mm depletion")).toBe("mm");
    expect(unitSymbol("seasons")).toBeNull();
    expect(unitSymbol(undefined)).toBeNull();
  });
});
