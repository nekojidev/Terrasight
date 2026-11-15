import { describe, expect, it } from "vitest";
import { etaSeconds, isFirstBuild, progressFraction, type GatherFocusStatus } from "./GatherFocus";

const st = (modis: "running" | "done"): GatherFocusStatus => ({
  status: "running",
  sources: [
    { source: "power", label: "NASA POWER", status: "done", reason: null },
    { source: "modis", label: "MODIS NDVI", status: modis, reason: null },
  ],
});

describe("GatherFocus helpers", () => {
  it("focuses only on the first build", () => {
    expect(isFirstBuild(st("running"), false)).toBe(true);
    expect(isFirstBuild(st("running"), true)).toBe(false);
    expect(isFirstBuild(null, false)).toBe(false);
  });
  it("estimates from the slowest unfinished source", () => {
    expect(etaSeconds(st("running"), 30)).toBe(90);
    expect(etaSeconds(st("done"), 30)).toBeNull();
  });
  it("weights progress by typical duration", () => {
    expect(progressFraction(st("running"))).toBeCloseTo(25 / 145);
    expect(progressFraction(st("done"))).toBe(1);
  });
});
