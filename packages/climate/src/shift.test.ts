import { describe, expect, it } from "vitest";
import { addDays, resolveFlowering, type CropFloweringTable } from "./flowering.js";
import { seasonSeries, type DailySeries } from "./season.js";
import { climateShift, trendShift } from "./shift.js";

interface Day {
  tmin: number | null;
  tmax: number | null;
  tmean: number | null;
  precip: number | null;
}

/** Daily series from `from` to `to` (ISO), values from a function of the date. */
function make(from: string, to: string, f: (iso: string, i: number) => Day): DailySeries {
  const out: DailySeries = { dates: [], tmin: [], tmax: [], tmean: [], precip: [] };
  const end = Date.parse(`${to}T00:00:00Z`);
  for (let t = Date.parse(`${from}T00:00:00Z`), i = 0; t <= end; t += 86_400_000, i++) {
    const iso = new Date(t).toISOString().slice(0, 10);
    const d = f(iso, i);
    out.dates.push(iso);
    out.tmin.push(d.tmin);
    out.tmax.push(d.tmax);
    out.tmean.push(d.tmean);
    out.precip.push(d.precip);
  }
  return out;
}

const flat = (): Day => ({ tmin: 5, tmax: 25, tmean: 15, precip: 2 });

describe("seasonSeries, northern hemisphere", () => {
  const flowering = { from: "07-01", to: "07-10", thresholdC: 30 };

  it("computes every metric on a constructed year", () => {
    // 2000: mean 15 °C all days, 2 mm rain; July 1–10 Tmax 36 on odd days; a 9-day dry spell in May; frost on 10 Apr and 20 Oct.
    const d = make("2000-01-01", "2000-12-31", (iso) => {
      const md = iso.slice(5);
      const day = Number(md.slice(3));
      return {
        tmin: iso === "2000-04-10" || iso === "2000-10-20" ? -1 : 5,
        tmax: md >= "07-01" && md <= "07-10" && day % 2 === 1 ? 36 : 25,
        tmean: 15,
        precip: md >= "05-10" && md <= "05-18" ? 0.5 : 2,
      };
    });
    const r = seasonSeries(d, 40, { years: { from: 2000, to: 2000 }, flowering });
    expect(r.skippedYears).toEqual([]);
    const y = r.years[0]!;
    expect(y.seasonTemp).toBeCloseTo(15, 10);
    expect(y.hotDaysFlowering).toBe(5);
    const seasonDays = 183;
    expect(y.seasonPrecip).toBeCloseTo(2 * seasonDays - 1.5 * 9, 10);
    expect(y.longestDrySpell).toBe(9);
    expect(y.gdd).toBeCloseTo(5 * seasonDays, 10);
    expect(y.lastSpringFrost).toBe(101); // 10 Apr 2000 is day 101 (leap year)
    expect(y.firstAutumnFrost).toBe(294); // 20 Oct 2000
    expect(y.frostFreeDays).toBe(294 - 101 - 1);
  });

  it("caps the daily mean at 30 °C for degree days", () => {
    const d = make("2001-01-01", "2001-12-31", () => ({ tmin: 20, tmax: 45, tmean: 40, precip: 0 }));
    expect(seasonSeries(d, 40, { years: { from: 2001, to: 2001 }, flowering }).years[0]!.gdd).toBeCloseTo(20 * 183, 10);
  });

  it("a year without frost has null frost values, not zero", () => {
    const d = make("2002-01-01", "2002-12-31", flat);
    const y = seasonSeries(d, 40, { years: { from: 2002, to: 2002 }, flowering }).years[0]!;
    expect(y.lastSpringFrost).toBeNull();
    expect(y.firstAutumnFrost).toBeNull();
    expect(y.frostFreeDays).toBeNull();
    expect(y.frostSearched).toEqual({ spring: true, autumn: true });
  });

  it("skips a year with fewer than 90 % of its season days and lists it", () => {
    const d = make("2003-01-01", "2004-12-31", (iso) =>
      iso >= "2003-05-01" && iso <= "2003-07-15" ? { tmin: null, tmax: null, tmean: null, precip: null } : flat(),
    );
    const r = seasonSeries(d, 40, { years: { from: 2003, to: 2005 }, flowering });
    expect(r.skippedYears).toEqual([2003, 2005]); // 2005 has no data at all
    expect(r.years.map((y) => y.year)).toEqual([2004]);
  });

  it("keeps a year at exactly 90 % coverage", () => {
    const d = make("2006-01-01", "2006-12-31", (iso) =>
      iso >= "2006-04-01" && iso <= "2006-04-18" ? { tmin: null, tmax: null, tmean: null, precip: null } : flat(),
    );
    // 18 of 183 missing → 165/183 = 90.2 %
    expect(seasonSeries(d, 40, { years: { from: 2006, to: 2006 }, flowering }).skippedYears).toEqual([]);
  });

  it("a missing day ends a dry spell", () => {
    const d = make("2007-01-01", "2007-12-31", (iso) =>
      iso === "2007-06-05"
        ? { tmin: 5, tmax: 25, tmean: 15, precip: null }
        : iso >= "2007-06-01" && iso <= "2007-06-10"
          ? { tmin: 5, tmax: 25, tmean: 15, precip: 0 }
          : flat(),
    );
    expect(seasonSeries(d, 40, { years: { from: 2007, to: 2007 }, flowering }).years[0]!.longestDrySpell).toBe(5);
  });

  it("uses the T5 fallback window when no flowering window is given", () => {
    const d = make("2008-01-01", "2008-12-31", (iso) =>
      iso >= "2008-06-01" && iso <= "2008-08-31" ? { tmin: 15, tmax: 36, tmean: 25, precip: 2 } : flat(),
    );
    expect(seasonSeries(d, 40, { years: { from: 2008, to: 2008 } }).years[0]!.hotDaysFlowering).toBe(92);
  });
});

describe("seasonSeries, southern hemisphere", () => {
  it("labels the season by the year it ends and mirrors the frost search", () => {
    // Season 2001 = 1 Oct 2000 – 31 Mar 2001; spring frost 15 Sep 2000, autumn frost 10 Jun 2001.
    const d = make("2000-01-01", "2001-12-31", (iso) => ({
      tmin: iso === "2000-09-15" || iso === "2001-06-10" ? -2 : 8,
      tmax: 28,
      tmean: 18,
      precip: 1,
    }));
    const r = seasonSeries(d, -34, { years: { from: 2000, to: 2001 }, flowering: { from: "12-01", to: "02-28", thresholdC: 35 } });
    expect(r.hemisphere).toBe("south");
    expect(r.season).toEqual({ from: "10-01", to: "03-31" });
    expect(r.skippedYears).toEqual([2000]); // season 2000 starts in Oct 1999, before the data
    expect(r.years.map((y) => y.year)).toEqual([2001]);
    const y = r.years[0]!;
    expect(y.lastSpringFrost).toBe(259); // 15 Sep 2000 (leap year: day 259)
    expect(y.firstAutumnFrost).toBe(161); // 10 Jun 2001
    expect(y.seasonPrecip).toBeCloseTo(182, 10); // 1 Oct 2000 – 31 Mar 2001 = 182 days at 1 mm
  });

  it("window across the year end counts days in December–February", () => {
    const d = make("2000-01-01", "2001-12-31", () => ({ tmin: 8, tmax: 40, tmean: 24, precip: 1 }));
    const y = seasonSeries(d, -34, { years: { from: 2001, to: 2001 } }).years[0]!;
    expect(y.hotDaysFlowering).toBe(31 + 31 + 28); // Dec 2000, Jan, Feb 2001
  });
});

/** Ten-plus years where every year is 0.05 °C warmer; precipitation constant. */
function warming(slopePerYear: number, years: [number, number], rain: (y: number) => number = () => 2): DailySeries {
  return make(`${years[0]}-01-01`, `${years[1]}-12-31`, (iso) => {
    const y = Number(iso.slice(0, 4));
    const base = 15 + slopePerYear * (y - years[0]) + (y % 3) * 0.01; // tiny wobble keeps ties away
    return { tmin: 5, tmax: 25, tmean: base, precip: rain(y) };
  });
}

describe("climateShift", () => {
  const flowering = { from: "07-01", to: "07-31", thresholdC: 35 };
  const daily = warming(0.05, [1981, 2025]);
  const r = climateShift({ daily, lat: 40, flowering });

  it("returns the eight metrics in order with units", () => {
    expect(r.metrics.map((m) => m.id)).toEqual([
      "seasonTemp",
      "hotDaysFlowering",
      "seasonPrecip",
      "longestDrySpell",
      "gdd",
      "lastSpringFrost",
      "firstAutumnFrost",
      "frostFreeDays",
    ]);
    expect(r.hemisphere).toBe("north");
    expect(r.season).toEqual({ from: "04-01", to: "09-30" });
    expect(r.skippedYears).toEqual([]);
  });

  it("delta, period means and Theil–Sen slope of a steady warming", () => {
    const t = r.metrics.find((m) => m.id === "seasonTemp")!;
    // period centres are 25 years apart (1990.5 vs 2015.5): delta = 0.05 · 25
    expect(t.delta).toBeCloseTo(1.25, 1);
    expect(t.recent! - t.baseline!).toBeCloseTo(t.delta!, 12);
    expect(t.trend.slopePerDecade).toBeCloseTo(0.5, 1);
    expect(t.trend.significant).toBe(true);
    expect(t.trend.years).toBe(45);
  });

  it("a constant metric has no clear trend", () => {
    const p = r.metrics.find((m) => m.id === "seasonPrecip")!;
    expect(p.delta).toBeCloseTo(0, 10);
    expect(p.trend.significant).toBe(false);
  });

  it("frost metrics: no frost anywhere → null period values and yearsWithout counted", () => {
    const f = r.metrics.find((m) => m.id === "lastSpringFrost")!;
    expect(f.baseline).toBeNull();
    expect(f.delta).toBeNull();
    expect(f.yearsWithout).toEqual({ baseline: 20, recent: 20 });
    expect(f.trend.slopePerDecade).toBeNull();
    expect(f.trend.years).toBe(0);
  });

  it("is deterministic", () => {
    expect(climateShift({ daily, lat: 40, flowering })).toEqual(r);
  });

  it("lists skipped years from the periods", () => {
    const short = warming(0.05, [1990, 2025]);
    const s = climateShift({ daily: short, lat: 40, flowering });
    expect(s.skippedYears).toEqual([1981, 1982, 1983, 1984, 1985, 1986, 1987, 1988, 1989]);
    const t = s.metrics[0]!;
    expect(t.trend.years).toBe(36);
    expect(t.baseline).toBeCloseTo(15 + 0.05 * 4.5 + 0.0, 1); // 1990–2000 only
  });
});

describe("trendShift", () => {
  const north = (rain: (y: number) => number) => warming(0.04, [1981, 2025], rain);

  it("applies a significant temperature slope times the horizon from the middle of the last 15 years", () => {
    const s = trendShift(north(() => 2), 40, { targetYear: 2028 });
    // last 15 years 2011–2025: mean year 2018; horizon 10; slope 0.04 °C/yr
    expect(s.applied).toEqual({ temperature: true, precipitation: false });
    expect(s.deltaT).toBeCloseTo(0.4, 1);
    expect(s.precipFactor).toBe(1);
  });

  it("applies a significant rainfall slope as a fraction of the last-15 mean, clamped to 0.5–1.5", () => {
    // wetter by 0.02 mm/day per year: season precipitation rises ~3.66 mm/yr
    const s = trendShift(north((y) => 2 + 0.02 * (y - 1981)), 40, { targetYear: 2028 });
    expect(s.applied.precipitation).toBe(true);
    expect(s.precipFactor).toBeGreaterThan(1);
    expect(s.precipFactor).toBeLessThanOrEqual(1.5);
    const extreme = trendShift(north((y) => 0.1 + 5 * (y - 1981)), 40, { targetYear: 2060 });
    expect(extreme.precipFactor).toBe(1.5);
  });

  it("gives 0 / 1 and applied false when there is no clear trend", () => {
    const flatSeries = warming(0, [1981, 2025]);
    const s = trendShift(flatSeries, 40, { targetYear: 2028 });
    expect(s).toEqual({ deltaT: 0, precipFactor: 1, applied: { temperature: false, precipitation: false } });
  });

  it("too short a series gives the neutral shift", () => {
    const s = trendShift(warming(0.1, [2015, 2020]), 40, { targetYear: 2028 });
    expect(s.applied).toEqual({ temperature: false, precipitation: false });
  });
});

describe("resolveFlowering", () => {
  const src = { title: "t", publisher: "p", url: "https://example.org", accessed: "2026-11-15" };
  const table: CropFloweringTable = {
    version: 1,
    fallback: { thresholdC: 35, north: { from: "06-01", to: "08-31" }, south: { from: "12-01", to: "02-28" } },
    crops: {
      corn: {
        threshold: { valueC: 35, sources: [src] },
        window: {
          afterEmergence: { from: 60, to: 80, sources: [src] },
          regions: { "us-southern-plains": { from: "07-01", to: "07-20", sources: [src] } },
        },
        verified: false,
      },
    },
  };

  it("prefers the region window, then days after sowing, then the fallback", () => {
    const a = resolveFlowering(table, { crop: "corn", regionId: "us-southern-plains", emergenceMmdd: "04-25", hemisphere: "north" });
    expect([a.from, a.to, a.fallback, a.verified]).toEqual(["07-01", "07-20", false, false]);
    const b = resolveFlowering(table, { crop: "corn", regionId: null, emergenceMmdd: "04-25", hemisphere: "north" });
    expect([b.from, b.to]).toEqual(["06-24", "07-14"]);
    const c = resolveFlowering(table, { crop: "corn", regionId: null, emergenceMmdd: null, hemisphere: "north" });
    expect(c.fallback).toBe(true);
    expect(c.source).toBeNull();
    const d = resolveFlowering(table, { crop: null, regionId: null, emergenceMmdd: null, hemisphere: "south" });
    expect([d.from, d.to, d.thresholdC, d.fallback]).toEqual(["12-01", "02-28", 35, true]);
  });

  it("adds days across the year end", () => {
    expect(addDays("12-20", 20)).toBe("01-09");
    expect(addDays("04-25", 60)).toBe("06-24");
  });
});
