import { describe, expect, it } from "vitest";
import { buildDataBasis, type BasisInput } from "./data-basis.js";

const base: BasisInput = {
  evidence: [],
  crops: [],
  weather: [],
  ndviDates: [],
  powerDataDate: "2026-11-12",
  gathered: { power: "2026-11-12", modis: "2026-10-16", cdl: null },
};

const by = (items: ReturnType<typeof buildDataBasis>, dataset: string) => items.find((i) => i.dataset === dataset);

describe("buildDataBasis", () => {
  it("is empty when there is no evidence: nothing is claimed", () => {
    expect(buildDataBasis(base)).toEqual([]);
  });

  it("degree-day evidence with forecast days: POWER (degree-days) and Open-Meteo (forecast)", () => {
    const items = buildDataBasis({
      ...base,
      evidence: [
        {
          source: "NASA POWER + Open-Meteo, air temperature, base 3 °C",
          from: "2026-09-20",
          to: "2026-11-19",
          series: [
            { date: "2026-11-12", dd: 300 },
            { date: "2026-11-15", dd: 310, forecast: true },
          ],
        },
        { kind: "citation", source: "ignored" } as never,
      ],
      weather: [
        { date: "2026-11-12", origin: "power" },
        { date: "2026-11-13", origin: "observed" },
        { date: "2026-11-15", origin: "forecast" },
      ],
    });
    expect(items.map((i) => i.dataset)).toEqual(["NASA POWER", "Open-Meteo"]);
    expect(by(items, "NASA POWER")).toMatchObject({
      agency: "NASA",
      from: "2026-09-20",
      to: "2026-11-12",
      lastDate: "2026-11-12",
      supports: ["degree-days"],
    });
    expect(by(items, "Open-Meteo")).toMatchObject({ agency: "other", from: "2026-11-13", lastDate: "2026-11-15", supports: ["forecast"] });
  });

  it("a rotation item on CDL seasons lists CDL, never MODIS or POWER", () => {
    const items = buildDataBasis({
      ...base,
      evidence: [{ source: "Crop history", from: "2023", to: "2025" }],
      crops: [
        { season: 2022, source: "cdl", isOverride: false },
        { season: 2023, source: "cdl", isOverride: false },
        { season: 2024, source: "cdl", isOverride: false },
        { season: 2025, source: "cdl", isOverride: true },
      ],
    });
    expect(items).toEqual([
      {
        dataset: "USDA Cropland Data Layer",
        agency: "USDA",
        from: "2023-01-01",
        to: "2024-12-31",
        lastDate: null,
        supports: ["crop-history"],
      },
    ]);
  });

  it("NDVI-estimated seasons bring in MODIS (NASA, listed first) with the last composite", () => {
    const items = buildDataBasis({
      ...base,
      evidence: [{ source: "Crop history", from: "2024", to: "2025" }],
      crops: [
        { season: 2024, source: "ndvi", isOverride: false },
        { season: 2025, source: "cdl", isOverride: false },
      ],
    });
    expect(items.map((i) => i.dataset)).toEqual(["MODIS NDVI (MOD13Q1)", "USDA Cropland Data Layer"]);
    expect(items[0]).toMatchObject({ agency: "NASA", lastDate: "2026-10-16", supports: ["crop-estimate"] });
  });

  it("green bridge: Sentinel-2 (ESA) only, last image inside the window", () => {
    const items = buildDataBasis({
      ...base,
      evidence: [{ source: "Copernicus Sentinel-2 NDVI (10 m)", from: "2026-08-15", to: "2026-08-29" }],
      ndviDates: ["2026-08-10", "2026-08-20", "2026-08-27", "2026-09-05"],
    });
    expect(items).toEqual([
      {
        dataset: "Copernicus Sentinel-2 NDVI",
        agency: "ESA",
        from: "2026-08-15",
        to: "2026-08-29",
        lastDate: "2026-08-27",
        supports: ["green-bridge"],
      },
    ]);
  });

  it("autumn warmth vs past years: POWER supports weather-years; water balance adds SSURGO", () => {
    const items = buildDataBasis({
      ...base,
      evidence: [
        { source: "NASA POWER daily mean air temperature vs 40 past years", from: "2026-09-01", to: "2026-11-12" },
        {
          source: "FAO-56 water balance: NASA POWER + Open-Meteo observed and forecast weather, soil water capacity from SSURGO",
          from: "2026-04-25",
          to: "2026-11-19",
        },
      ],
    });
    expect(by(items, "NASA POWER")?.supports.sort()).toEqual(["soil-water", "weather-years"]);
    expect(by(items, "USDA SSURGO")?.supports).toEqual(["soil-water"]);
    expect(by(items, "Open-Meteo")?.supports).toEqual(["forecast"]);
    expect(items.some((i) => i.dataset.includes("MODIS"))).toBe(false);
  });

  it("observed-only Open-Meteo days do not claim a forecast", () => {
    const items = buildDataBasis({
      ...base,
      evidence: [{ source: "NASA POWER + Open-Meteo, soil temperature, base 5 °C", from: "2026-10-01", to: "2026-11-14" }],
      weather: [{ date: "2026-11-14", origin: "observed" }],
    });
    expect(by(items, "Open-Meteo")?.supports).toEqual([]);
  });
});
