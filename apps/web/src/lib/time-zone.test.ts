import { describe, expect, it } from "vitest";
import { allZones, commonZones, filterZones } from "./time-zone";

describe("time zones", () => {
  it("puts the current zone first, then its region, never the whole list", () => {
    const list = commonZones("America/Chicago", "America/Chicago");
    expect(list[0]).toBe("America/Chicago");
    expect(list).toContain("America/Denver");
    expect(list).toContain("UTC");
    expect(list.length).toBeLessThan(20);
    expect(new Set(list).size).toBe(list.length);
  });

  it("keeps an unusual current zone in the short list", () => {
    expect(commonZones("Asia/Tbilisi", "Europe/Kyiv")[0]).toBe("Asia/Tbilisi");
  });

  it("falls back to the detected zone and UTC for a region without a curated list", () => {
    expect(commonZones("Antarctica/Troll")).toEqual(["Antarctica/Troll", "UTC"]);
  });

  it("filters by city with spaces or underscores", () => {
    const zones = allZones();
    expect(filterZones(zones, "new york")).toContain("America/New_York");
    expect(filterZones(zones, "zzzz-none")).toEqual([]);
    expect(filterZones(zones, "  ")).toBe(zones);
  });
});
