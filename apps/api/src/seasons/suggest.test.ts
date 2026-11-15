import { describe, expect, it } from "vitest";
import {
  bestSowing,
  climatology,
  dailySoilMeans,
  emergenceByGdd,
  gddDay,
  resolveWindow,
  suggestTillage,
  windowStatus,
  type WeatherDay,
} from "./suggest.js";

const CFG = { noTillSlopePct: 6, reducedSlopePct: 3 };

describe("sowing window dates", () => {
  it("puts spring windows in the harvest year and autumn windows in the year before", () => {
    expect(resolveWindow(["04-15", "05-15"], 2027)).toEqual({ from: "2027-04-15", to: "2027-05-15" });
    expect(resolveWindow(["09-15", "10-20"], 2027)).toEqual({ from: "2026-09-15", to: "2026-10-20" });
  });

  it("runs a window across New Year into the next year", () => {
    expect(resolveWindow(["11-15", "01-15"], 2027)).toEqual({ from: "2026-11-15", to: "2027-01-15" });
  });
});

describe("window status against today", () => {
  const corn = resolveWindow(["04-15", "05-15"], 2026);
  it("is not-yet before the window with the days until it opens", () => {
    expect(windowStatus(corn, "2026-04-01")).toEqual({ status: "not-yet", opensInDays: 14 });
  });
  it("is open inside the window, both ends included, with days left", () => {
    expect(windowStatus(corn, "2026-04-15")).toEqual({ status: "open", daysLeft: 30 });
    expect(windowStatus(corn, "2026-05-15")).toEqual({ status: "open", daysLeft: 0 });
  });
  it("is late just after the end and closed once the grace is over", () => {
    expect(windowStatus(corn, "2026-05-16").status).toBe("late");
    expect(windowStatus(corn, "2026-05-29").status).toBe("late");
    expect(windowStatus(corn, "2026-05-30").status).toBe("closed");
  });

  it("winter wheat for next year's harvest: open this autumn, then closed", () => {
    const wheat = resolveWindow(["09-15", "10-20"], 2027);
    expect(windowStatus(wheat, "2026-10-10")).toEqual({ status: "open", daysLeft: 10 });
    expect(windowStatus(wheat, "2026-11-15").status).toBe("closed");
    // The same crop for the season after is still ahead in November.
    expect(windowStatus(resolveWindow(["09-15", "10-20"], 2028), "2026-11-15").status).toBe("not-yet");
  });

  it("southern hemisphere: a summer crop sown Oct-Dec belongs to the harvest year after", () => {
    // Argentina-style corn, sown 1 Oct to 15 Dec for the 2026/27 season, named 2027 by harvest year.
    const corn = resolveWindow(["10-01", "12-15"], 2027);
    expect(corn).toEqual({ from: "2026-10-01", to: "2026-12-15" });
    expect(windowStatus(corn, "2026-11-15")).toEqual({ status: "open", daysLeft: 30 });
    // Wheat sown May-July of the harvest year itself, harvested in December.
    const wheat = resolveWindow(["05-15", "07-15"], 2027);
    expect(wheat).toEqual({ from: "2027-05-15", to: "2027-07-15" });
    expect(windowStatus(wheat, "2026-11-15").status).toBe("not-yet");
  });
});

describe("best sowing date", () => {
  const win = { from: "2026-04-15", to: "2026-05-15" };
  const soil = (vals: number[]) =>
    vals.map((soilC, i) => ({ date: `2026-04-${String(20 + i).padStart(2, "0")}`, soilC }));

  it("uses the typical date, clamped into the window and not before today", () => {
    expect(bestSowing(win, "2026-04-01", "2026-04-25", null, 10)).toEqual({
      date: "2026-04-25",
      basis: "typical",
    });
    expect(bestSowing(win, "2026-05-02", "2026-04-25", null, 10)).toEqual({
      date: "2026-05-02",
      basis: "typical",
    });
    expect(bestSowing(win, "2026-04-01", "2026-03-01", null, 10)?.date).toBe("2026-04-15");
  });

  it("waits for the first forecast day with warm enough soil", () => {
    expect(bestSowing(win, "2026-04-20", "2026-04-20", soil([7, 8, 9.5, 10.2, 11]), 10)).toEqual({
      date: "2026-04-23",
      basis: "soil-temp",
    });
  });

  it("keeps the typical date and says the soil is cold when the whole forecast is below the minimum", () => {
    expect(bestSowing(win, "2026-04-20", "2026-04-22", soil([6, 7, 8, 8, 9]), 10)).toEqual({
      date: "2026-04-22",
      basis: "soil-temp-cold",
    });
  });

  it("ignores soil temperature before the window opens and returns null once it is over", () => {
    expect(bestSowing(win, "2026-04-01", "2026-04-25", soil([12, 12]), 10)?.basis).toBe("typical");
    expect(bestSowing(win, "2026-05-20", "2026-04-25", null, 10)).toBeNull();
  });

  it("averages hourly soil temperature per day and drops days with too few hours", () => {
    const hours = Array.from({ length: 30 }, (_, i) => ({
      time: `2026-04-${i < 24 ? "20" : "21"}T${String(i % 24).padStart(2, "0")}:00`,
      soilTemp6cmC: i < 24 ? 10 + (i % 2) : 20,
    }));
    const d = dailySoilMeans(hours);
    expect(d).toHaveLength(1);
    expect(d[0]).toEqual({ date: "2026-04-20", soilC: 10.5 });
  });
});

describe("emergence by growing degree days", () => {
  const day = (date: string, tminC: number, tmaxC: number, origin = "power"): WeatherDay => ({
    date,
    tminC,
    tmaxC,
    tmeanC: null,
    origin,
  });
  // Mean 20 C with base 10: 10 degree days a day.
  const warm = (from: number, n: number, origin = "power") =>
    Array.from({ length: n }, (_, i) => day(`2026-05-${String(from + i).padStart(2, "0")}`, 14, 26, origin));

  it("floors a cold day at zero", () => {
    expect(gddDay({ tminC: 0, tmaxC: 8, tmeanC: null }, 10)).toBe(0);
    expect(gddDay({ tminC: 14, tmaxC: 26, tmeanC: null }, 10)).toBe(10);
    expect(gddDay({ tminC: null, tmaxC: null, tmeanC: 15 }, 10)).toBe(5);
  });

  it("counts from the sowing day and stops on the day the requirement is met (observed weather)", () => {
    const r = emergenceByGdd({ sowing: "2026-05-01", weather: warm(1, 20), baseC: 10, requiredGdd: 65 });
    expect(r).toEqual({ date: "2026-05-07", method: "gdd-observed", gdd: 70 });
  });

  it("is slower in a cold spell", () => {
    const weather = [
      ...Array.from({ length: 5 }, (_, i) => day(`2026-05-0${1 + i}`, 2, 10)), // mean 6 C: 0
      ...warm(6, 15),
    ];
    expect(emergenceByGdd({ sowing: "2026-05-01", weather, baseC: 10, requiredGdd: 65 })?.date).toBe(
      "2026-05-12",
    );
  });

  it("is a forecast result when forecast days were needed", () => {
    const weather = [...warm(1, 3), ...warm(4, 10, "forecast")];
    const r = emergenceByGdd({ sowing: "2026-05-01", weather, baseC: 10, requiredGdd: 65 });
    expect(r?.method).toBe("gdd-forecast");
    expect(r?.date).toBe("2026-05-07");
  });

  it("fills days beyond the weather from the climatology and says so", () => {
    const climate = new Map<string, { tminC: number; tmaxC: number }>();
    for (let d = 1; d <= 31; d++) climate.set(`05-${String(d).padStart(2, "0")}`, { tminC: 10, tmaxC: 20 }); // 5 a day
    const r = emergenceByGdd({
      sowing: "2026-05-01",
      weather: warm(1, 2),
      baseC: 10,
      requiredGdd: 65,
      climate,
    });
    expect(r?.method).toBe("gdd-climatology");
    // 2 days x 10 + 5 a day: 65 reached on day 11 (index 10).
    expect(r).toMatchObject({ date: "2026-05-11", gdd: 65 });
  });

  it("returns null when the weather runs out and there is no climatology", () => {
    expect(
      emergenceByGdd({ sowing: "2026-05-01", weather: warm(1, 2), baseC: 10, requiredGdd: 65 }),
    ).toBeNull();
  });

  it("builds the climatology from past years only and smooths over a week", () => {
    const dates = ["2010-05-01", "2011-05-01", "2012-05-02", "1990-05-01"];
    const c = climatology(dates, [8, 10, 12, -40], [18, 20, 22, 50], 2000);
    // 1990 is before the start year; the 3 kept days all fall within +-3 days of 05-01.
    expect(c.get("05-01")).toEqual({ tminC: 10, tmaxC: 20 });
    expect(c.get("05-02")).toEqual({ tminC: 10, tmaxC: 20 });
    expect(c.get("05-04")).toBeUndefined();
  });
});

describe("tillage suggestion", () => {
  const base = { annualPrecipMm: 450, crop: "corn", cfg: CFG };

  it("keeps residue on the surface on steep land", () => {
    const t = suggestTillage({ ...base, slopePct: 6, regionPractice: "reduced" });
    expect(t).toMatchObject({
      value: "no_till",
      reasonCode: "slope-high",
      reason: "slope 6%: keep residue on the surface",
    });
    expect(t?.rusle).toBeGreaterThan(0);
  });

  it("suggests reduced tillage on a moderate slope", () => {
    expect(suggestTillage({ ...base, slopePct: 3, regionPractice: null })).toMatchObject({
      value: "reduced",
      reasonCode: "slope-moderate",
    });
  });

  it("follows the regional practice on a gentle slope, with or without a slope", () => {
    expect(suggestTillage({ ...base, slopePct: 1, regionPractice: "no_till" })).toMatchObject({
      value: "no_till",
      reasonCode: "regional-practice",
    });
    const unknown = suggestTillage({ ...base, slopePct: null, regionPractice: "reduced" });
    expect(unknown).toMatchObject({ value: "reduced", rusle: null });
    expect(unknown?.reason).toContain("slope unknown");
  });

  it("leaves conventional tillage open on a gentle slope without a regional practice, and says nothing without data", () => {
    expect(suggestTillage({ ...base, slopePct: 1, regionPractice: null })).toMatchObject({
      value: "conventional",
      reasonCode: "gentle-slope",
    });
    expect(suggestTillage({ ...base, slopePct: null, regionPractice: null })).toBeNull();
  });

  it("gives a higher relative erosion index to row crops than to small grain on the same slope", () => {
    const corn = suggestTillage({ ...base, slopePct: 7, regionPractice: null })!.rusle!;
    const wheat = suggestTillage({
      ...base,
      crop: "winter_wheat",
      slopePct: 7,
      regionPractice: null,
    })!.rusle!;
    expect(corn).toBeGreaterThan(wheat);
  });
});
