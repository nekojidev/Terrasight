import { describe, expect, it, vi } from "vitest";
import type { HourlyForecast } from "@terrasight/sources";
import { fileURLToPath } from "node:url";
import { ProblemException } from "../http/problem.js";
import { WorkWindowsController } from "./work-windows.controller.js";
import { WorkWindowsService, sowingSeason } from "./work-windows.service.js";

const WS = "11111111-1111-4111-8111-111111111111";
const F1 = "22222222-2222-4222-8222-222222222222";
const F2 = "33333333-3333-4333-8333-333333333333";

/** 3 days from 2026-04-20 00:00 (cell local time, UTC-6), calm and dry; day 1 is windy. */
const hours: HourlyForecast["hours"] = Array.from({ length: 72 }, (_, i) => {
  const day = Math.floor(i / 24);
  return {
    time: `2026-04-${20 + day}T${String(i % 24).padStart(2, "0")}:00`,
    tempC: 18,
    rhPct: 60,
    precipMm: 0,
    windMs: day === 1 ? 8 : 3,
    gustMs: 4,
    soilTemp6cmC: 14,
    soilTemp0cmC: 14,
    soilMoisture: 0.2,
  };
});
const forecast: HourlyForecast = {
  provider: "open-meteo",
  cell: { lat: 38.1, lon: -101.1 },
  issuedAt: "2026-04-20T05:00:00Z",
  hours,
  utcOffsetSeconds: -21600,
  attribution: "Weather data by Open-Meteo.com (CC BY 4.0)",
};

function setup(opts: { hourly?: boolean } = {}) {
  const getHourly = vi.fn(async () =>
    opts.hourly === false ? null : { forecast, origin: "cache" as const, ageHours: 2 },
  );
  const prisma = {
    system: {
      $queryRaw: vi.fn(async () => [
        { id: F1, name: "North pivot", alias_no: 1, lat: 38.1, lon: -101.1 },
        { id: F2, name: "South pivot", alias_no: 2, lat: 38.12, lon: -101.08 },
      ]),
      workspace: { findUnique: vi.fn(async () => ({ timeZone: "America/Chicago" })) },
      cropSeason: { findFirst: vi.fn(async () => ({ mainCrop: "corn" })) },
    },
  };
  const seasons = { planFor: vi.fn(async (_id: string, _season: number) => null) };
  const svc = new WorkWindowsService(prisma as never, { getHourly } as never, seasons as never, { DATA_DIR: fileURLToPath(new URL("../../../../data/", import.meta.url)) } as never, { rotations: { crops: { corn: { en: "Corn (grain)", uk: "Кукурудза на зерно" } } } } as never);
  return { svc, getHourly, seasons };
}

// 2026-04-20 07:30 in Kansas = 12:30 UTC; cell local hour is 06:00.
const NOW = new Date("2026-04-20T12:30:00Z");

describe("WorkWindowsService", () => {
  it("builds windows per field from one hourly request per forecast cell", async () => {
    const { svc, getHourly, seasons } = setup();
    const v = await svc.forWorkspace(WS, 3, NOW);
    expect(getHourly).toHaveBeenCalledTimes(1);
    expect(seasons.planFor).toHaveBeenCalledWith(F1, 2026);
    expect(v.thresholdsUnverified).toBe(false);
    expect(v.cropNames.corn?.uk).toBe("Кукурудза на зерно");
    expect(v.fields.map((f) => f.fieldId)).toEqual([F1, F2]);
    const f = v.fields[0]!;
    expect(f).toMatchObject({ available: true, sowingCrop: "corn", now: "2026-04-20T06:00" });
    expect(f.operations.map((o) => o.operation)).toEqual(["spraying", "sowing", "traffic", "fertiliser"]);
    const spraying = f.operations[0]!;
    // Thresholds are verified for the MVP: verdicts with the limiting factor, next to the measured conditions.
    expect(spraying.days.every((d) => d.status !== "unknown")).toBe(true);
    expect(spraying.days[1]!.status).toBe("no"); // wind 8 m/s is above the 4.5 m/s ceiling
    expect(spraying.days[1]!.limiting).toMatchObject({ factor: "wind" });
    expect(spraying.days[1]!.conditions).toContainEqual({ factor: "wind", value: 8, verified: true });
    expect(f.operations[1]!.days[0]!.status).not.toBe("unknown");
    expect(f.operations[1]!.days[0]!.conditions).toContainEqual({ factor: "soil_temp", value: 14, verified: true });
  });

  it("returns one field and 404s for an unknown one", async () => {
    const { svc } = setup();
    expect((await svc.forField(WS, F2, 2, NOW)).fields).toHaveLength(1);
    await expect(svc.forField(WS, "44444444-4444-4444-8444-444444444444", 2, NOW)).rejects.toBeInstanceOf(
      ProblemException,
    );
  });

  it("marks a field unavailable when no hourly forecast exists", async () => {
    const { svc } = setup({ hourly: false });
    const v = await svc.forWorkspace(WS, 7, NOW);
    expect(v.fields[0]).toMatchObject({ available: false, operations: [], forecast: null });
  });

  it("uses next year's season for sowing from September", () => {
    expect(sowingSeason("2026-11-15")).toBe(2027);
    expect(sowingSeason("2026-04-20")).toBe(2026);
  });
});

describe("WorkWindowsController", () => {
  it("rejects days outside 1..7 and a malformed field id", () => {
    const svc = { forWorkspace: vi.fn(), forField: vi.fn() };
    const c = new WorkWindowsController(svc as never);
    const req = { workspaceId: WS } as never;
    expect(() => c.all("9", req)).toThrow(ProblemException);
    expect(() => c.one("nope", undefined, req)).toThrow(ProblemException);
    c.all(undefined, req);
    expect(svc.forWorkspace).toHaveBeenCalledWith(WS, 7);
  });
});
