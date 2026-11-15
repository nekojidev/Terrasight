import type { WeatherDay } from "@terrasight/simulator";
import { describe, expect, it } from "vitest";
import {
  buildDryland,
  buildTable,
  chooseSeries,
  deviationsFromMean,
  fit,
  isModelFlat,
  missReason,
  pearson,
  pickActual,
  trendDeviation,
  type ActualPoint,
  type ActualSources,
  type SeasonRow,
} from "./hindcast.js";

const pts = (practice: ActualPoint["practice"], from: number, vals: number[]): ActualPoint[] =>
  vals.map((tPerHa, i) => ({ year: from + i, tPerHa, practice }));

describe("statistics", () => {
  it("Pearson r is exact, null below 5 pairs and for a constant series", () => {
    expect(pearson([1, 2, 3, 4, 5], [2, 4, 6, 8, 10])).toBeCloseTo(1, 12);
    expect(pearson([1, 2, 3, 4, 5], [5, 4, 3, 2, 1])).toBeCloseTo(-1, 12);
    expect(pearson([1, 2, 3, 4], [1, 2, 3, 4])).toBeNull();
    expect(pearson([0, 0, 0, 0, 0], [1, 2, 3, 4, 5])).toBeNull();
  });
  it("fit reports n, r and the mean absolute error in points", () => {
    expect(fit([[10, 0], [0, 10], [-10, 0]])).toEqual({ n: 3, r: null, mae: 10 });
    expect(fit([])).toEqual({ n: 0, r: null, mae: null });
  });
  it("deviation from the linear trend is 0 on a perfect line, from the mean on a short series", () => {
    const line = Array.from({ length: 10 }, (_, i) => ({ year: 2000 + i, v: 5 + 0.1 * i }));
    const t = trendDeviation(line);
    expect(t.short).toBe(false);
    expect(t.at(2005, 5.5)).toBeCloseTo(0, 9);
    expect(t.at(2005, 5.5 * 1.2)).toBeCloseTo(20, 9);
    const short = trendDeviation([{ year: 1, v: 4 }, { year: 2, v: 6 }]);
    expect(short.short).toBe(true);
    expect(short.at(1, 4)).toBeCloseTo(-20, 9);
  });
  it("model deviation is per crop; a crop with one year gets null, not 0", () => {
    const d = deviationsFromMean(new Map([[1, 1.2], [2, 0.8], [3, null]]));
    expect(d.get(1)).toBeCloseTo(20, 9);
    expect(d.get(2)).toBeCloseTo(-20, 9);
    expect(d.get(3)).toBeNull();
    expect(deviationsFromMean(new Map([[1, 1]])).get(1)).toBeNull();
  });
});

describe("which actual series", () => {
  const years = [2018, 2019, 2020, 2021, 2022];
  it("uses the field's practice only when it covers every compared year; else `all` for the whole series", () => {
    const all = pts("all", 2010, Array(13).fill(9));
    const irrFull = pts("irrigated", 2010, Array(13).fill(12));
    expect(chooseSeries([...all, ...irrFull], "irrigated", years)).toMatchObject({ practice: "irrigated", allUsed: false });
    const irrPartial = pts("irrigated", 2010, Array(9).fill(12)); // stops in 2018
    const c = chooseSeries([...all, ...irrPartial], "irrigated", years)!;
    expect(c.practice).toBe("all");
    expect(c.allUsed).toBe(true);
    expect(c.points.every((p) => p.practice === "all")).toBe(true);
    expect(chooseSeries([], "irrigated", years)).toBeNull();
  });
  it("falls back to the state series when the county has fewer than 8 values in the compared years", () => {
    const wide = Array.from({ length: 10 }, (_, i) => 2013 + i);
    const county = { area: "Finney County, KS", points: pts("all", 2013, [1, 2, 3, 4, 5, 6, 7]).filter((p) => p.year !== 2015) };
    const state = { area: "Kansas", points: pts("all", 1990, Array(36).fill(9)) };
    expect(pickActual(county, state, "irrigated", wide)).toMatchObject({ level: "state", area: "Kansas" });
    const full = { area: "Finney County, KS", points: pts("all", 2013, Array(10).fill(9)) };
    expect(pickActual(full, state, "irrigated", wide)).toMatchObject({ level: "county" });
    expect(pickActual(county, null, "irrigated", wide)).toMatchObject({ level: "county" });
  });
});

describe("the table", () => {
  const rows: SeasonRow[] = Array.from({ length: 10 }, (_, i) => ({
    year: 2010 + i,
    crop: "corn",
    relative: 1 + (i % 2 ? 0.1 : -0.1),
    ndviPeak: 0.8 + (i % 2 ? 0.02 : -0.02),
  }));
  const county = Object.fromEntries([["corn", { area: "Test County, KS", points: pts("all", 2000, Array.from({ length: 25 }, (_, i) => 9 + 0.1 * i + (i % 2 ? 0.5 : -0.5))) }]]);
  const actual: ActualSources = { kind: "nass", connected: true, county, state: {}, oblast: false };

  it("computes deviations, fit and says exactly which series it is; a miss gets a reason only when |Δ| > 20", () => {
    const t = buildTable(rows, actual, "non-irrigated", () => "unknown");
    expect(t.years).toHaveLength(10);
    expect(t.years[0]).toMatchObject({ year: 2010, crop: "corn", practice: "all", miss: false, reason: null });
    expect(t.years[0]!.model).toBeCloseTo(-10 / 1, 0);
    expect(t.area).toBe("Test County, KS (all practices)");
    expect(t.vsCounty!.n).toBe(10);
    expect(t.vsNdvi!.n).toBe(10);
    expect(t.caveats).toContain("practice-all-used:corn");
    const wild = buildTable(
      rows.map((r) => ({ ...r, relative: r.year === 2013 ? 3 : r.relative })),
      actual,
      "non-irrigated",
      () => "heat",
    );
    const y = wild.years.find((x) => x.year === 2013)!;
    expect(y.miss).toBe(true);
    expect(y.reason).toBe("heat");
  });
  it("keeps a missing county value as null and never marks it a miss", () => {
    const sparse = { corn: { area: "Test County, KS", points: pts("all", 2000, Array(25).fill(9)).filter((p) => p.year !== 2015) } };
    const t = buildTable(rows, { ...actual, county: sparse }, "non-irrigated", () => "unknown");
    const y = t.years.find((x) => x.year === 2015)!;
    expect(y).toMatchObject({ county: null, countyYield: null, practice: null, miss: false });
    expect(t.vsCounty!.n).toBe(9);
  });
  it("without any actual series there is no county fit", () => {
    const t = buildTable(rows, { kind: "none", connected: true, county: {}, state: {}, oblast: false }, "irrigated", () => "unknown");
    expect(t.vsCounty).toBeNull();
    expect(t.area).toBeNull();
    expect(t.years.every((y) => y.county === null)).toBe(true);
  });
  it("short county series: deviation from the mean and a caveat", () => {
    const six = { corn: { area: "Test County, KS", points: pts("all", 2010, [8, 9, 10, 9, 8, 10]) } };
    const t = buildTable(rows.slice(0, 6), { ...actual, county: six }, "non-irrigated", () => "unknown");
    expect(t.caveats).toContain("short-county-series:corn");
  });
});

describe("reasons for a miss (T12)", () => {
  /** A harvest-year window 1 Sep (y−1) → 31 Aug (y), mild weather; overrides per date. */
  function weather(over: (date: string) => Partial<WeatherDay>): Map<number, WeatherDay[]> {
    const out = new Map<number, WeatherDay[]>();
    for (let y = 2000; y <= 2020; y++) {
      const days: WeatherDay[] = [];
      for (let t = Date.parse(`${y - 1}-09-01T00:00:00Z`); t < Date.parse(`${y}-09-01T00:00:00Z`); t += 86_400_000) {
        const date = new Date(t).toISOString().slice(0, 10);
        days.push({ date, tmin: 8, tmax: 24, precip: 0, ...over(date) });
      }
      out.set(y, days);
    }
    return out;
  }
  const corn = { sowing: "2010-04-25", harvest: "2010-09-22" };
  it("heat: more days above 35 °C than 80 % of the field's years", () => {
    const w = weather((d) => (d.startsWith("2010-07") ? { tmax: 38 } : {}));
    expect(missReason(2010, w, corn)).toBe("heat");
    expect(missReason(2011, w, { sowing: "2011-04-25", harvest: "2011-09-22" })).not.toBe("heat");
  });
  it("frost: Tmin <= -2 in the last 6 weeks before harvest; winter crop: after 1 April", () => {
    const w = weather((d) => (d === "2010-09-05" ? { tmin: -3 } : {}));
    expect(missReason(2010, w, corn)).toBe("frost");
    const apr = weather((d) => (d === "2010-04-10" ? { tmin: -3 } : {}));
    expect(missReason(2010, apr, corn)).toBe("unknown");
    expect(missReason(2010, apr, { sowing: "2009-10-01", harvest: "2010-07-05" })).toBe("frost");
  });
  it("harvest-rain: 30 days before harvest wetter than 90 % of years; else unknown", () => {
    const w = weather((d) => (d >= "2010-08-25" && d <= "2010-09-20" ? { precip: 20 } : {}));
    expect(missReason(2010, w, corn)).toBe("harvest-rain");
    expect(missReason(2010, weather(() => ({})), corn)).toBe("unknown");
    expect(missReason(1990, w, corn)).toBe("unknown"); // no weather for that year
  });
});

describe("flat model", () => {
  it("is flat with at least 3 non-null years all within 0.05 points of 0", () => {
    expect(isModelFlat([{ model: 0 }, { model: 0.04 }, { model: -0.05 }, { model: null }])).toBe(true);
    expect(isModelFlat([{ model: 0 }, { model: 0 }])).toBe(false);
    expect(isModelFlat([{ model: 0 }, { model: 0 }, { model: 0.2 }])).toBe(false);
    expect(isModelFlat([])).toBe(false);
  });
});

describe("the dryland check", () => {
  const years = Array.from({ length: 10 }, (_, i) => 2013 + i);
  const rowsFor = (crop: string): SeasonRow[] =>
    years.map((year, i) => ({ year, crop, relative: 1 + (i % 3) * 0.1, ndviPeak: null }));
  const series = (practice: ActualPoint["practice"], from: number, n: number, base = 5): ActualPoint[] =>
    pts(practice, from, Array.from({ length: n }, (_, i) => base + (i % 3) * 0.5));
  const src = (county: ActualSources["county"], state: ActualSources["state"]): ActualSources => ({
    kind: "nass",
    connected: true,
    county,
    state,
    oblast: false,
  });

  it("uses the county non-irrigated series when it has 8+ values in the compared years; ignores irrigated and all", () => {
    const d = buildDryland(
      rowsFor("corn"),
      src({ corn: { area: "Finney County, KS", points: [...series("non-irrigated", 2013, 10), ...series("irrigated", 2013, 10, 12), ...series("all", 2013, 10, 9)] } }, {}),
      () => "unknown",
    )!;
    expect(d.area).toBe("Finney County, KS (non-irrigated)");
    expect(d.years.every((y) => y.practice === "non-irrigated")).toBe(true);
    expect(d.fit!.n).toBe(10);
    expect(d.fit!.r).toBeCloseTo(1, 2);
    expect(d.case2022!.year).toBe(2022);
  });

  it("falls back to the state non-irrigated series when the county has fewer than 8 values, never mixing", () => {
    const d = buildDryland(
      rowsFor("corn"),
      src(
        { corn: { area: "Finney County, KS", points: series("non-irrigated", 2013, 5) } },
        { corn: { area: "Kansas", points: series("non-irrigated", 2005, 20) } },
      ),
      () => "unknown",
    )!;
    expect(d.area).toBe("Kansas (state level, non-irrigated)");
    expect(d.years.every((y) => y.county !== null)).toBe(true);
  });

  it("a crop without any non-irrigated series carries county null; no series at all gives null", () => {
    const rows = [...rowsFor("corn"), ...rowsFor("soybean")];
    const d = buildDryland(
      rows,
      src({ corn: { area: "Kansas", points: series("non-irrigated", 2013, 10) }, soybean: { area: "Finney County, KS", points: series("all", 2013, 10) } }, {}),
      () => "unknown",
    )!;
    expect(d.years.filter((y) => y.crop === "soybean").every((y) => y.county === null && !y.miss)).toBe(true);
    expect(d.years.filter((y) => y.crop === "corn").every((y) => y.county !== null)).toBe(true);
    expect(buildDryland(rowsFor("corn"), src({ corn: { area: "X", points: series("irrigated", 2013, 10) } }, {}), () => "unknown")).toBeNull();
    expect(buildDryland(rowsFor("corn"), { ...src({}, {}), kind: "none" }, () => "unknown")).toBeNull();
  });
});
