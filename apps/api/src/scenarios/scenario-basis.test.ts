import { describe, expect, it } from "vitest";
import { priceBasisText, runDataBasis, type RunBasisInput } from "./scenario-basis.js";

const base: RunBasisInput = {
  weather: { yearSet: "all", from: 1981, to: 2025, count: 45 },
  firstDate: "1980-09-01",
  lastBootstrapDate: "2025-08-31",
  lastDate: "2026-11-12",
  stress2022: true,
  soilBasis: "ssurgo",
  history: [
    { season: 2022, source: "cdl" },
    { season: 2023, source: "cdl" },
    { season: 2024, source: "cdl" },
  ],
};

describe("runDataBasis", () => {
  it("US field: POWER (years, last day, 2022 stress), CDL seasons and SSURGO, NASA first", () => {
    const b = runDataBasis(base);
    expect(b.map((i) => i.dataset)).toEqual(["NASA POWER", "USDA Cropland Data Layer", "USDA SSURGO"]);
    expect(b[0]).toEqual({
      dataset: "NASA POWER",
      agency: "NASA",
      from: "1980-09-01",
      to: "2025-08-31",
      lastDate: "2026-11-12",
      supports: ["weather-years", "stress-2022"],
    });
    expect(b[1]).toMatchObject({ from: "2022-01-01", to: "2024-12-31", supports: ["crop-history"] });
    expect(b[2]!.supports).toEqual(["soil-water"]);
  });

  it("no 2022 stress run: POWER supports only the weather years", () => {
    expect(runDataBasis({ ...base, stress2022: false })[0]!.supports).toEqual(["weather-years"]);
  });

  it("satellite-estimated history is MODIS (NASA), soil from SoilGrids; nothing else is invented", () => {
    const b = runDataBasis({
      ...base,
      soilBasis: "soilgrids",
      history: [
        { season: 2021, source: "ndvi" },
        { season: 2024, source: "ndvi" },
      ],
    });
    expect(b.map((i) => [i.dataset, i.agency])).toEqual([
      ["NASA POWER", "NASA"],
      ["MODIS NDVI (MOD13Q1)", "NASA"],
      ["ISRIC SoilGrids", "other"],
    ]);
    expect(b[1]).toMatchObject({ from: "2021-01-01", to: "2024-12-31", supports: ["crop-estimate"] });
  });

  it("no soil data and no history: only POWER", () => {
    expect(runDataBasis({ ...base, soilBasis: "default", history: [] }).map((i) => i.dataset)).toEqual([
      "NASA POWER",
    ]);
  });
});

describe("priceBasisText", () => {
  const region = {
    corn: {
      asOf: "2025",
      source:
        "Price: USDA NASS Crop Values 2025 Summary (Feb 2026, preliminary), Kansas. Costs and yields: K-State KSU Farm Management Guides 2027",
    },
  };
  it("library prices say they are typed in from the NASS report and the K-State / UNL budgets", () => {
    const t = priceBasisText("library", ["corn", "corn"], region)!;
    expect(t.en).toMatch(/typed in/);
    expect(t.en).toMatch(/USDA NASS Crop Values 2025/);
    expect(t.en).toMatch(/K-State and UNL/);
    expect(t.uk).toMatch(/NASS/);
  });
  it("company prices: your company prices", () => {
    expect(priceBasisText("company", ["corn"], region)).toEqual({
      en: "your company prices",
      uk: "ціни вашої компанії",
    });
  });
  it("mixed says both; no label gives null", () => {
    const m = priceBasisText("mixed", ["corn"], region)!;
    expect(m.en).toMatch(/typed in/);
    expect(m.en).toMatch(/your company prices/);
    expect(priceBasisText(null, [], region)).toBeNull();
  });
  it("a library entry without the known reports shows its own source text", () => {
    const t = priceBasisText("library", ["x"], { x: { asOf: "2026", source: "Some Ministry table" } })!;
    expect(t.en).toContain("Some Ministry table");
  });
});
