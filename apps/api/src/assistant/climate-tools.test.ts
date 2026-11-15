import { AllowedSet, checkSentence, functionDeclarations, isTool, parseArgs, systemPrompt } from "@terrasight/assistant-core";
import type { ClimateMetric, ClimateShift, YearSetComparison } from "@terrasight/shared";
import { describe, expect, it } from "vitest";
import { climateShiftResult, yearSetResult } from "./climate-tools.js";

const metric = (id: ClimateMetric["id"], unit: ClimateMetric["unit"], b: number, r: number, significant: boolean): ClimateMetric => ({
  id,
  unit,
  baseline: b,
  recent: r,
  delta: r - b,
  trend: { slopePerDecade: significant ? (r - b) / 2.4 : null, pValue: significant ? 0.01 : 0.4, significant, years: 45 },
});

const shift: ClimateShift = {
  status: "ready",
  periods: { baseline: { from: 1981, to: 2000 }, recent: { from: 2006, to: 2025 } },
  hemisphere: "north",
  season: { from: "04-15", to: "10-15" },
  crop: "corn",
  flowering: { from: "07-01", to: "07-31", thresholdC: 35, verified: true, fallback: false, source: null },
  metrics: [
    metric("seasonTemp", "degC", 21.51, 22.22, true),
    metric("seasonPrecip", "mm", 375, 363, false),
  ],
  alpha: 0.05,
  skippedYears: [],
  source: { dataset: "NASA POWER", from: "1981-01-01", lastDate: "2026-11-12", cell: { lat: 38, lon: -100.5 }, resolutionKm: 55 },
  gpm: null,
};

const allowedFrom = (result: unknown) => {
  const a = new AllowedSet();
  a.addResult(result);
  return a;
};

describe("get_climate_shift result", () => {
  const result = climateShiftResult("F1", shift, "en");
  it("carries baseline, recent, change and the trend verdict per metric", () => {
    const [t, p] = result.metrics as Array<Record<string, unknown>>;
    expect(t).toMatchObject({ baseline: { value: 21.51 }, recent: { value: 22.22 }, change: { value: 0.71 }, trend: "clear_trend" });
    expect(p).toMatchObject({ change: { value: -12 }, trend: "no_clear_trend" });
  });
  it("lets the number check pass the stated numbers and the 55 km note, and reject others", () => {
    const allowed = allowedFrom(result);
    for (const s of [
      "Season temperature rose from 21.51 to 22.22 °C, 0.71 °C more.",
      "Season rainfall is 375 mm against 363 mm, with no clear trend.",
      "These NASA POWER numbers belong to a grid cell of about 55 km.",
      "The record covers 1981–2025.",
    ])
      expect(checkSentence(s, allowed, "en").ok, s).toBe(true);
    expect(checkSentence("It will be 3 °C hotter by 2030.", allowed, "en").ok).toBe(false);
  });
  it("answers plainly when the shift is pending or unavailable", () => {
    expect(climateShiftResult("F1", { ...shift, status: "pending" }, "en")).toMatchObject({ status: "pending" });
    expect(climateShiftResult("F1", { ...shift, status: "unavailable", reason: "too-few-years" }, "uk")).toMatchObject({ reason: "too-few-years" });
  });
  it("names metrics in the user's language", () => {
    expect((climateShiftResult("F1", shift, "uk").metrics as Array<{ title: string }>)[0]!.title).toMatch(/Температура/);
  });
});

describe("get_year_set_ranking result", () => {
  const comparison: YearSetComparison = {
    mode: "money",
    currency: "USD",
    bestChanges: true,
    names: { current: { en: "Current rotation", uk: "Поточна сівозміна" }, r1: { en: "Corn–soy", uk: "Кукурудза–соя" } },
    sets: [
      { id: "all", years: { from: 1981, to: 2025, count: 45 }, shift: null, best: "r1", options: [{ id: "r1", rank: 1, margin: 410.4, drought: 120, score: 1 }, { id: "current", rank: 2, margin: 380, drought: 90, score: 0.5 }] },
      { id: "trend-2030", years: { from: 2006, to: 2025, count: 20 }, shift: { deltaT: 0.5, precipFactor: 1, applied: { temperature: true, precipitation: false } }, best: "current", options: [{ id: "current", rank: 1, margin: 400, drought: 100, score: 1 }] },
    ],
  };
  const result = yearSetResult("F1", comparison, "en");
  it("is a sensitivity analysis, with names, ranks and money in the workspace currency", () => {
    expect(JSON.stringify(result)).toMatch(/sensitivity analysis/);
    expect(result.sets[0]!.options[0]).toMatchObject({ rank: 1, title: "Corn–soy (All weather years)", marginPerHaPerYear: { value: 410.4, unit: "USD" } });
    expect(checkSentence("Corn–soy earns 410.4 USD per hectare in all years.", allowedFrom(result), "en").ok).toBe(true);
  });
});

describe("tool registration and system rules", () => {
  it("both tools are declared, validated and described as past / sensitivity only", () => {
    for (const name of ["get_climate_shift", "get_year_set_ranking"] as const) {
      expect(isTool(name)).toBe(true);
      expect(functionDeclarations().some((d) => d.name === name)).toBe(true);
      expect(parseArgs(name, { field: "F1" }).ok).toBe(true);
      expect(parseArgs(name, { field: "Pivot" }).ok).toBe(false);
    }
    const d = Object.fromEntries(functionDeclarations().map((x) => [x.name, x.description]));
    expect(d.get_climate_shift).toMatch(/never a forecast/);
    expect(d.get_year_set_ranking).toMatch(/NOT a forecast/);
  });
  it("the system prompt keeps the rules", () => {
    const p = systemPrompt("en", "2026-11-15");
    expect(p).toMatch(/not a forecast/);
    expect(p).toMatch(/no clear trend/);
    expect(p).toMatch(/sensitivity analysis/);
    expect(p).toMatch(/5 seasons, 2026–2030/);
    expect(p).toMatch(/55 km/);
  });
});
