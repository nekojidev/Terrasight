import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  computeWorkWindows,
  deltaT,
  unverifiedThresholds,
  type HourlyPoint,
  type WorkWindowsConfig,
} from "./index.js";

const cfg = JSON.parse(
  readFileSync(new URL("../../../data/work-windows.json", import.meta.url), "utf8"),
) as WorkWindowsConfig;

/** `days` days from 2026-04-20 00:00 with one function per hour. */
function series(days: number, f: (day: number, hour: number) => Partial<HourlyPoint>): HourlyPoint[] {
  const out: HourlyPoint[] = [];
  for (let d = 0; d < days; d++)
    for (let h = 0; h < 24; h++)
      out.push({
        time: `2026-04-${String(20 + d).padStart(2, "0")}T${String(h).padStart(2, "0")}:00`,
        tempC: 18,
        rhPct: 60,
        precipMm: 0,
        windMs: 3,
        gustMs: 4,
        soilTemp6cmC: 14,
        ...f(d, h),
      });
  return out;
}
const NOW = "2026-04-20T00:00";
const op = (r: ReturnType<typeof computeWorkWindows>, name: string) => r.operations.find((o) => o.operation === name)!;

describe("delta T", () => {
  it("is about 5 C at 25 C / 50 % and small in humid air", () => {
    expect(deltaT(25, 50)).toBeGreaterThan(6);
    expect(deltaT(25, 50)).toBeLessThan(8);
    expect(deltaT(20, 95)).toBeLessThan(1.5);
  });
});

describe("spraying", () => {
  it("is good on a calm, mild, dry day and says why a windy day is not", () => {
    const r = computeWorkWindows(series(2, (d) => (d === 1 ? { windMs: 7 } : {})), cfg, NOW, { days: 2 });
    const s = op(r, "spraying");
    expect(s.days[0]!.status).toBe("good");
    expect(s.days[0]!.limiting).toBeNull();
    expect(s.days[1]!.status).toBe("no");
    expect(s.days[1]!.limiting).toEqual({ factor: "wind", value: 7 });
  });
  it("blocks the hours before rain and opens the morning", () => {
    // Rain from 14:00 on day 0: the last 2 h before are "no", 6 h before marginal, earlier hours good.
    const r = computeWorkWindows(series(1, (_d, h) => (h >= 14 ? { precipMm: 1 } : {})), cfg, NOW, { days: 1 });
    const day = op(r, "spraying").days[0]!;
    const good = day.windows.find((w) => w.status === "good")!;
    expect(good.from).toBe("06:00");
    expect(good.to).toBe("09:00");
    expect(day.windows.find((w) => w.status === "marginal")!.limiting).toEqual({ factor: "rain_soon", value: 5 });
    expect(day.windows.at(-1)!.status).toBe("no");
    // A 3 h good morning is enough for a good day.
    expect(day.status).toBe("good");
    expect(day.limiting).toBeNull();
  });
  it("treats very calm air and gusts above the ceiling as marginal", () => {
    const calm = op(computeWorkWindows(series(1, () => ({ windMs: 0.5 })), cfg, NOW, { days: 1 }), "spraying");
    expect(calm.days[0]!.status).toBe("marginal");
    expect(calm.days[0]!.limiting?.factor).toBe("wind_low");
    const gusty = op(computeWorkWindows(series(1, () => ({ gustMs: 8 })), cfg, NOW, { days: 1 }), "spraying");
    expect(gusty.days[0]!.limiting).toEqual({ factor: "gust", value: 8 });
  });
  it("uses delta T: dry hot air is no, humid air near 0 is marginal", () => {
    const dry = op(computeWorkWindows(series(1, () => ({ tempC: 29, rhPct: 15 })), cfg, NOW, { days: 1 }), "spraying");
    expect(dry.days[0]!.status).toBe("no");
    expect(dry.days[0]!.limiting?.factor).toBe("delta_t");
    const humid = op(computeWorkWindows(series(1, () => ({ tempC: 15, rhPct: 97 })), cfg, NOW, { days: 1 }), "spraying");
    expect(humid.days[0]!.status).toBe("marginal");
  });
  it("skips hours already past today and reports a finished day", () => {
    const r = computeWorkWindows(series(2, () => ({})), cfg, "2026-04-20T22:00", { days: 2 });
    const days = op(r, "spraying").days;
    expect(days[0]!.limiting).toEqual({ factor: "daylight", value: null });
    expect(days[1]!.status).toBe("good");
  });
});

describe("sowing", () => {
  it("needs the crop's soil temperature (corn 10 C) and rain-free soil", () => {
    const warm = op(computeWorkWindows(series(1, () => ({})), cfg, NOW, { days: 1, sowingCrop: "corn" }), "sowing");
    expect(warm.days[0]!.status).toBe("good");
    const cold = op(
      computeWorkWindows(series(1, () => ({ soilTemp6cmC: 7 })), cfg, NOW, { days: 1, sowingCrop: "corn" }),
      "sowing",
    );
    expect(cold.days[0]!.status).toBe("no");
    expect(cold.days[0]!.limiting).toEqual({ factor: "soil_temp", value: 7 });
    // Soybean needs more than corn: 11 C is fine for corn, not for soybean.
    const mid = (crop: string) =>
      op(computeWorkWindows(series(1, () => ({ soilTemp6cmC: 11 })), cfg, NOW, { days: 1, sowingCrop: crop }), "sowing")
        .days[0]!.status;
    expect(mid("corn")).toBe("good");
    expect(mid("soybean")).toBe("no");
  });
  it("is not applicable without a crop threshold", () => {
    const r = computeWorkWindows(series(1, () => ({})), cfg, NOW, { days: 1, sowingCrop: "winter_wheat" });
    expect(op(r, "sowing").applicable).toBe(false);
    expect(op(computeWorkWindows(series(1, () => ({})), cfg, NOW, { days: 1 }), "sowing").applicable).toBe(false);
  });
  it("waits after heavy rain", () => {
    const r = computeWorkWindows(series(2, (d, h) => (d === 0 && h === 3 ? { precipMm: 20 } : {})), cfg, NOW, {
      days: 2,
      sowingCrop: "corn",
    });
    const s = op(r, "sowing");
    expect(s.days[0]!.status).toBe("no");
    expect(s.days[0]!.limiting?.factor).toBe("rain_past");
    expect(s.days[1]!.status).toBe("good");
  });
});

describe("traffic and fertiliser", () => {
  it("traffic is no after 15 mm in 48 h and recovers once it drops out of the window", () => {
    const r = computeWorkWindows(series(4, (d, h) => (d === 0 && h === 2 ? { precipMm: 16 } : {})), cfg, NOW, {
      days: 4,
    });
    const t = op(r, "traffic").days.map((d) => d.status);
    expect(t).toEqual(["no", "no", "good", "good"]);
  });
  it("fertiliser is blocked in the 24 h before a heavy rain, good in a dry spell", () => {
    const r = computeWorkWindows(series(3, (d, h) => (d === 1 && h === 10 ? { precipMm: 12 } : {})), cfg, NOW, {
      days: 3,
    });
    const f = op(r, "fertiliser").days;
    // Day 0 evening is inside the 24 h before the downpour.
    expect(f[0]!.windows.at(-1)).toMatchObject({ status: "no", limiting: { factor: "rain_next", value: 12 } });
    expect(f[2]!.status).toBe("good");
  });
});

describe("thresholds file", () => {
  it("is entirely unverified and every number is sourced", () => {
    expect(unverifiedThresholds(cfg)).toBe(true);
    const walk = (n: unknown, path: string): void => {
      if (!n || typeof n !== "object") return;
      const o = n as Record<string, unknown>;
      if (typeof o.verified === "boolean") {
        const s = o.source as { url?: string; accessed?: string } | undefined;
        expect(s?.url, path).toMatch(/^https:\/\//);
        expect(s?.accessed, path).toBeTruthy();
        return;
      }
      for (const [k, x] of Object.entries(o)) walk(x, `${path}.${k}`);
    };
    for (const k of ["spraying", "sowing", "traffic", "fertiliser"]) walk((cfg as unknown as Record<string, unknown>)[k], k);
  });
});
