import type { DailyWeather, SeasonalEnsemble } from "@terrasight/sources";
import { describe, expect, it } from "vitest";
import { computeOutlook, daysThrough, outlookMonths, quantile, summarise } from "./outlook.js";

/** Synthetic climate for the maths only: 1991–2020 with year-dependent anomalies so the terciles are defined. */
function weather(opts: { tmin: number; tmax: number; precipPerDay: number }): DailyWeather {
  const dates: string[] = [];
  const v = { T2M_MAX: [] as number[], T2M_MIN: [] as number[], PRECTOTCORR: [] as number[] } as Record<string, number[]>;
  for (let y = 1991; y <= 2020; y++)
    for (let t = Date.UTC(y, 0, 1); t < Date.UTC(y + 1, 0, 1); t += 86_400_000) {
      const d = new Date(t);
      dates.push(d.toISOString().slice(0, 10));
      const wiggle = ((y * 7 + d.getUTCDate() * 3) % 10) - 4.5; // -4.5…4.5, varies by year and day
      v.T2M_MAX!.push(opts.tmax + wiggle * 0.3);
      v.T2M_MIN!.push(opts.tmin + wiggle * 0.3);
      v.PRECTOTCORR!.push(Math.max(0, opts.precipPerDay + wiggle * 0.2));
    }
  return {
    dates,
    values: v as unknown as DailyWeather["values"],
    cell: { lon: 0, lat: 0 },
    elevationM: null,
  };
}

/** 50 members, each constant plus a small spread, for 2027-04 only. */
function ensemble(o: { tmin: number; tmax: number; precip: number; tAnom: number; pAnom: number }): SeasonalEnsemble {
  const dates = Array.from({ length: 30 }, (_, i) => `2027-04-${String(i + 1).padStart(2, "0")}`);
  const member = (base: number, spread: number) =>
    Array.from({ length: 50 }, (_, m) => dates.map((_, i) => base + ((m % 5) - 2) * spread + ((i % 3) - 1) * 0.1));
  return {
    provider: "open-meteo-seasonal",
    cell: { lat: 0, lon: 0 },
    issuedAt: "2027-03-15",
    model: "ECMWF SEAS5",
    dates,
    tmaxC: member(o.tmax, 0.2),
    tminC: member(o.tmin, 0.2),
    precipMm: member(o.precip, 0.05),
    monthly: { months: ["2027-04"], tempAnomalyC: [o.tAnom], precipAnomalyMm: [o.pAnom] },
    attribution: "x",
  };
}

describe("months", () => {
  it("takes complete months after today", () => {
    expect(outlookMonths("2026-11-15")).toEqual(["2026-12", "2027-01", "2027-02"]);
    expect(outlookMonths("2026-11-01")).toEqual(["2026-11", "2026-12", "2027-01"]);
    expect(outlookMonths("2026-12-20")).toEqual(["2027-01", "2027-02", "2027-03"]);
  });
  it("counts the request length through the end of the last month", () => {
    expect(daysThrough("2026-11-15", "2027-02")).toBe(106);
  });
});

describe("quantile", () => {
  it("is the type-7 quantile", () => {
    expect(quantile([1, 2, 3, 4], 0.5)).toBe(2.5);
    expect(quantile([1, 2, 3], 1 / 3)).toBeCloseTo(1.667, 3);
  });
});

describe("outlook", () => {
  const clim = weather({ tmin: 2, tmax: 14, precipPerDay: 2 });
  const months = ["2027-04"];

  it("removes the model's own bias: a +5 °C warmer, wetter model with the same anomalies gives the same answer", () => {
    const a = computeOutlook(ensemble({ tmin: 4, tmax: 16, precip: 1.2, tAnom: 0, pAnom: 0 }), clim, months)!;
    const b = computeOutlook(ensemble({ tmin: 9, tmax: 21, precip: 2.4, tAnom: 0, pAnom: 0 }), clim, months)!;
    expect(b.months[0]!.temp.ensMedian).toBeCloseTo(a.months[0]!.temp.ensMedian, 1);
    expect(b.months[0]!.precip.ensMedian).toBeCloseTo(a.months[0]!.precip.ensMedian, 0);
    expect(b.months[0]!.frost.ensDays).toBeCloseTo(a.months[0]!.frost.ensDays, 0);
    expect(a.months[0]!.precip.below + a.months[0]!.precip.near + a.months[0]!.precip.above).toBeCloseTo(1, 1);
    expect(a.signals.filter((s) => s.kind === "frost_higher")).toEqual([]);
    expect(a.members).toBe(50);
  });

  it("turns a cold anomaly into more frost nights and a below-normal temperature", () => {
    const o = computeOutlook(ensemble({ tmin: 4, tmax: 16, precip: 1.2, tAnom: -3, pAnom: 0 }), clim, months)!;
    const m = o.months[0]!;
    expect(m.temp.below).toBeGreaterThanOrEqual(0.9);
    expect(m.frost.direction).toBe("higher");
    expect(m.heat.direction).toBe("normal");
    expect(o.signals.map((s) => s.kind)).toEqual(expect.arrayContaining(["temp_below", "frost_higher"]));
  });

  it("turns a wet anomaly into rain_above and a dry one into rain_below", () => {
    const wet = computeOutlook(ensemble({ tmin: 4, tmax: 16, precip: 1.2, tAnom: 0, pAnom: 30 }), clim, months)!;
    const dry = computeOutlook(ensemble({ tmin: 4, tmax: 16, precip: 1.2, tAnom: 0, pAnom: -30 }), clim, months)!;
    expect(wet.signals.some((s) => s.kind === "rain_above" && s.probability! >= 0.9)).toBe(true);
    expect(dry.signals.some((s) => s.kind === "rain_below" && s.probability! >= 0.9)).toBe(true);
  });

  it("skips a month without anomalies or without climatology rather than guessing", () => {
    const e = ensemble({ tmin: 4, tmax: 16, precip: 1.2, tAnom: 0, pAnom: 0 });
    e.monthly = { months: [], tempAnomalyC: [], precipAnomalyMm: [] };
    expect(computeOutlook(e, clim, months)).toBeNull();
    const short = { ...clim, dates: clim.dates.slice(0, 365 * 10) };
    expect(
      computeOutlook(ensemble({ tmin: 4, tmax: 16, precip: 1.2, tAnom: 0, pAnom: 0 }), short, months),
    ).toBeNull();
  });

  it("summarises fields for the Home rail", () => {
    const dry = computeOutlook(ensemble({ tmin: 4, tmax: 16, precip: 1.2, tAnom: 0, pAnom: -30 }), clim, months);
    const wet = computeOutlook(ensemble({ tmin: 4, tmax: 16, precip: 1.2, tAnom: 0, pAnom: 30 }), clim, months);
    const s = summarise([dry, dry, wet, null]);
    expect(s).toMatchObject({ month: "2027-04", fields: 4, withOutlook: 3, drier: 2, wetter: 1 });
  });
});
