import { describe, expect, it } from "vitest";
import type { DailyWeather, GpmSeries } from "@terrasight/sources";
import { computeGpmCheck } from "./gpm-check.js";

/** Synthetic series: constant seasonal rain per year given by `perYear`, spread evenly over the season. */
function build(perYear: (y: number) => { imerg: number; power: number }, south = false) {
  const months: GpmSeries["months"] = [];
  const dates: string[] = [];
  const pr: number[] = [];
  for (let y = 2001; y <= 2024; y++) {
    const { imerg, power } = perYear(y);
    for (let m = 1; m <= 12; m++) {
      const inSeason = south ? m >= 10 || m <= 3 : m >= 4 && m <= 9;
      months.push({ month: `${y}-${String(m).padStart(2, "0")}`, mm: inSeason ? imerg / 6 : 1 });
      const days = new Date(Date.UTC(y, m, 0)).getUTCDate();
      for (let d = 1; d <= days; d++) {
        dates.push(`${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`);
        pr.push(inSeason ? power / 6 / days : 0.1);
      }
    }
  }
  const series: GpmSeries = { months, cell: { lat: 38.05, lon: -101.05 }, lastDate: "2024-12-01", product: "GPM_3IMERGM.07" };
  const weather = { dates, values: { PRECTOTCORR: pr }, cell: { lon: -101.25, lat: 38 }, elevationM: null } as unknown as DailyWeather;
  return { series, weather };
}

describe("GPM check", () => {
  it("agrees when both datasets show a rise", () => {
    const { series, weather } = build((y) => ({ imerg: y < 2013 ? 400 : 440, power: y < 2013 ? 380 : 390 }));
    const r = computeGpmCheck(series, weather, 38.1);
    expect(r.status).toBe("ready");
    expect(r.early).toEqual({ from: 2001, to: 2012 });
    expect(r.late).toEqual({ from: 2013, to: 2024 });
    expect(r.imergChangePct).toBe(10);
    expect(r.powerChangePct).toBe(2.6);
    expect(r.agree).toBe(true);
    expect(r.lastDate).toBe("2024-12-01");
  });

  it("disagrees when the signs differ beyond ±2 %", () => {
    const { series, weather } = build((y) => ({ imerg: y < 2013 ? 400 : 440, power: y < 2013 ? 400 : 360 }));
    expect(computeGpmCheck(series, weather, 38.1).agree).toBe(false);
  });

  it("agrees when both are within ±2 % even with opposite signs", () => {
    const { series, weather } = build((y) => ({ imerg: y < 2013 ? 400 : 404, power: y < 2013 ? 400 : 396 }));
    expect(computeGpmCheck(series, weather, 38.1).agree).toBe(true);
  });

  it("uses Oct–Mar in the south", () => {
    const { series, weather } = build((y) => ({ imerg: y < 2012 ? 300 : 330, power: y < 2012 ? 300 : 330 }), true);
    const r = computeGpmCheck(series, weather, -33);
    expect(r.status).toBe("ready");
    expect(r.agree).toBe(true);
  });

  it("is unavailable when POWER has gaps everywhere", () => {
    const { series, weather } = build(() => ({ imerg: 400, power: 400 }));
    weather.values.PRECTOTCORR = weather.values.PRECTOTCORR.map(() => null);
    const r = computeGpmCheck(series, weather, 38.1);
    expect(r).toMatchObject({ status: "unavailable", agree: null, early: null });
  });
});
