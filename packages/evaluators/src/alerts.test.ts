import { describe, expect, it } from "vitest";
import { frostAlert, waterStress, type WaterSite } from "./alerts.js";
import type { DailyWeather, EvalInputs } from "./types.js";

const ASOF = "2026-05-20";
const addDays = (iso: string, n: number) =>
  new Date(Date.parse(`${iso}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

const NO_RECORD = {
  crop: { value: null, source: "unknown" as const },
  sowingDate: { value: null, source: "unknown" as const },
  emergenceDate: { value: null, source: "unknown" as const },
};

function base(over: Partial<EvalInputs> = {}): EvalInputs {
  return {
    fieldId: "f",
    tier: "A",
    regionId: "us-southern-plains",
    season: 2026,
    crops: [],
    nextCrop: { season: 2026, crop: null, source: "unknown" },
    record: {
      crop: { value: "corn", source: "confirmed" },
      sowingDate: { value: "2026-04-25", source: "confirmed" },
      emergenceDate: { value: "2026-05-08", source: "confirmed" },
    },
    weather: [],
    ndvi: [],
    planningDeadline: null,
    scouted: [],
    ...over,
  };
}

/** History from `from` to the day before ASOF, then 10 forecast days. */
function series(from: string, tmin: (i: number) => number, precip = 0): DailyWeather[] {
  const out: DailyWeather[] = [];
  for (let d = from; d < ASOF; d = addDays(d, 1))
    out.push({ date: d, tminC: 15, tmaxC: 32, tmeanC: 23.5, precipMm: precip, origin: "power" });
  for (let i = 0; i < 10; i++)
    out.push({
      date: addDays(ASOF, i),
      tminC: tmin(i),
      tmaxC: 33,
      tmeanC: 24,
      precipMm: 0,
      origin: "forecast",
      forecastDay: i + 1,
    });
  return out;
}

describe("frost_alert", () => {
  it("fires on the first forecast day with min <= 0 °C within 7 days", () => {
    const r = frostAlert(base({ weather: series("2026-05-01", (i) => (i === 3 ? -1.5 : 4)) }), ASOF)!;
    expect(r.subject).toBe("frost_alert");
    expect(r.type).toBe("weather");
    expect(r.level).toBe("moderate");
    expect(r.deadline).toBe("2026-05-23");
    expect(r.keyNumbers.map((k) => k.id)).toEqual(["frostDate", "frostMinC", "daysUntilFrost"]);
    expect(r.keyNumbers[2]!.value).toBe(3);
    expect(r.citations[0]).toMatchObject({ threshold: "frostC", value: 0, unit: "°C" });
    expect(r.unknowns.join(" ")).toContain("crop-specific damage thresholds are not modelled");
  });

  it("counts exactly 0 °C as frost but not 0.1 °C", () => {
    expect(frostAlert(base({ weather: series("2026-05-01", (i) => (i === 1 ? 0 : 5)) }), ASOF)!.level).toBe(
      "moderate",
    );
    expect(frostAlert(base({ weather: series("2026-05-01", (i) => (i === 1 ? 0.1 : 5)) }), ASOF)!.level).toBe(
      "none",
    );
  });

  it("ignores frost beyond forecast day 7", () => {
    expect(frostAlert(base({ weather: series("2026-05-01", (i) => (i === 8 ? -3 : 5)) }), ASOF)!.level).toBe(
      "none",
    );
  });

  it("produces nothing without a crop, or before sowing", () => {
    const w = series("2026-05-01", () => -2);
    expect(frostAlert(base({ weather: w, record: NO_RECORD }), ASOF)).toBeNull();
    expect(
      frostAlert(
        base({
          weather: w,
          record: {
            crop: { value: "corn", source: "plan" },
            sowingDate: { value: "2026-06-01", source: "plan" },
            emergenceDate: { value: null, source: "unknown" },
          },
        }),
        ASOF,
      ),
    ).toBeNull();
  });

  it("uses the current-season crop from the history when the record has none", () => {
    const r = frostAlert(
      base({
        weather: series("2026-05-01", () => -1),
        record: NO_RECORD,
        crops: [
          {
            season: 2026,
            mainCrop: "winter_wheat",
            secondCrop: null,
            confidence: 0.9,
            source: "cdl",
            isOverride: false,
          },
        ],
      }),
      ASOF,
    );
    expect(r?.level).toBe("moderate");
    expect(r?.unknowns).toContain("sowing and emergence dates are not recorded");
  });
});

const SITE: WaterSite = {
  latDeg: 37.9,
  elevationM: 840,
  awsMmPerM: 150,
  awsEstimated: false,
  hydGroup: "B",
  slopePct: 1,
  irrigated: true,
};

describe("water_stress", () => {
  const SOWN = "2026-04-03";
  const record = { ...base().record, sowingDate: { value: SOWN, source: "confirmed" as const } };
  const dry = () => base({ weather: series(SOWN, () => 15), record });

  it("flags depletion above RAW and gives days to stress with the numbers", () => {
    const r = waterStress(dry(), SITE, ASOF)!;
    expect(r.subject).toBe("water_stress");
    expect(r.type).toBe("irrigation");
    expect(r.level).toBe("moderate");
    expect(r.deadline).toBe("2026-05-23");
    expect(r.deadline).not.toBeNull();
    const kn = Object.fromEntries(r.keyNumbers.map((k) => [k.id, k.value]));
    expect(kn.depletionMm as number).toBeGreaterThan(kn.rawMm as number);
    expect(kn.tawMm as number).toBeGreaterThan(kn.rawMm as number);
    expect(r.citations[0]).toMatchObject({ threshold: "p", value: 0.55, publisher: "FAO" });
    expect(r.citations[0]!.title).toContain("Table 22");
  });

  it("is none when rain keeps depletion below RAW for the next 7 days", () => {
    const wet = base({
      weather: series(SOWN, () => 15, 8).map((w) =>
        w.origin === "forecast" ? { ...w, precipMm: 20 } : w,
      ),
      record,
    });
    expect(waterStress(wet, SITE, ASOF)!.level).toBe("none");
  });

  it("produces nothing for dryland, unknown irrigation, no soil, no crop, no sowing date or unsupported crop", () => {
    expect(waterStress(dry(), { ...SITE, irrigated: false }, ASOF)).toBeNull();
    expect(waterStress(dry(), { ...SITE, irrigated: null }, ASOF)).toBeNull();
    expect(waterStress(dry(), { ...SITE, awsMmPerM: null }, ASOF)).toBeNull();
    expect(waterStress(dry(), null, ASOF)).toBeNull();
    const rec = (crop: string | null, sowing: string | null) => ({
      crop: { value: crop, source: "confirmed" as const },
      sowingDate: { value: sowing, source: "confirmed" as const },
      emergenceDate: { value: null, source: "unknown" as const },
    });
    const w = series("2026-04-25", () => 15);
    expect(waterStress(base({ weather: w, record: rec(null, "2026-04-25") }), SITE, ASOF)).toBeNull();
    expect(waterStress(base({ weather: w, record: rec("corn", null) }), SITE, ASOF)).toBeNull();
    expect(waterStress(base({ weather: w, record: rec("unobtainium", "2026-04-25") }), SITE, ASOF)).toBeNull();
  });

  it("produces nothing when the weather history has gaps", () => {
    const w = series(SOWN, () => 15).map((x, i) => (i % 3 === 0 ? { ...x, precipMm: null } : x));
    expect(waterStress(base({ weather: w, record }), SITE, ASOF)).toBeNull();
  });
});
