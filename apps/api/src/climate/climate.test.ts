import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import type { DailyWeather } from "@terrasight/sources";
import { ProblemException } from "../http/problem.js";
import { ClimateController } from "./climate.controller.js";
import { ClimateService, type GpmCheckProvider } from "./climate.service.js";

const ROOT = fileURLToPath(new URL("../../../../", import.meta.url));
const DATA = `${ROOT}data`;
// Recorded real NASA POWER response for the Garden City cell (lat 38, lon -101.25).
const GARDEN_CITY = JSON.parse(
  readFileSync(`${ROOT}fixtures/power/f802a634bd7bf47d5e4107fb789061454bdba00cebec9e676f6385689a6414eb.json`, "utf8"),
) as { payload: DailyWeather };
const weather = GARDEN_CITY.payload;

const WS = "11111111-1111-4111-8111-111111111111";
const OTHER_WS = "99999999-9999-4999-8999-999999999999";
const F1 = "22222222-2222-4222-8222-222222222222";

interface Opts {
  cached?: DailyWeather | null;
  stored?: DailyWeather | null;
  task?: { status: string; cacheKey: string | null } | null;
  live?: DailyWeather | null;
  seasonCrop?: string | null;
  lastCrop?: string | null;
  gpm?: GpmCheckProvider;
}

function setup(o: Opts = {}) {
  const cached = vi.fn(async (key: string) => {
    const payload = key === "stored-key" ? (o.stored ?? null) : (o.cached ?? null);
    return payload ? { result: { status: "done", payload }, origin: "live", fetchedAt: new Date() } : null;
  });
  const fresh = vi.fn(async () => (o.live ? { result: { status: "done", payload: o.live }, origin: "live" } : null));
  const sources = { adapter: () => ({ id: "power" }), key: () => "today-key", cached, fresh };
  const prisma = {
    db: {
      field: {
        findFirst: vi.fn(async ({ where }: { where: { workspaceId: string; id: string } }) =>
          where.workspaceId === WS && where.id === F1 ? { id: F1, regionId: "us-southern-plains" } : null,
        ),
      },
      seasonRecord: {
        findUnique: vi.fn(async () =>
          o.seasonCrop ? { crop: o.seasonCrop, sowingDate: null, emergenceDate: new Date("2026-05-10T00:00:00Z") } : null,
        ),
      },
      cropSeason: { findFirst: vi.fn(async () => (o.lastCrop ? { mainCrop: o.lastCrop } : null)) },
    },
    system: { gatherTask: { findFirst: vi.fn(async () => o.task ?? null) } },
  };
  const geo = {
    fieldGeometry: vi.fn(async () => ({
      polygons: [],
      centroid: { lon: -101.2, lat: 37.98 },
      bbox: [0, 0, 0, 0],
      country: "US",
    })),
  };
  const limits = { takeWithin: vi.fn(async () => undefined) };
  const svc = new ClimateService(
    prisma as never,
    sources as never,
    geo as never,
    limits as never,
    { DATA_DIR: DATA } as never,
    o.gpm,
  );
  return { svc, prisma, sources, limits };
}

describe("ClimateService.forField", () => {
  it("is pending (valid, empty) while the POWER task runs and nothing is cached", async () => {
    const { svc, sources } = setup({ task: { status: "running", cacheKey: null } });
    const r = await svc.forField(WS, F1);
    expect(r.status).toBe("pending");
    expect(r.metrics).toEqual([]);
    expect(r.source).toBeNull();
    expect(r.gpm).toBeNull();
    expect(r.periods.baseline).toEqual({ from: 1981, to: 2000 });
    expect(r.flowering.fallback).toBe(true);
    expect(sources.fresh).not.toHaveBeenCalled(); // no live fetch while the gather task is working
  });

  it("is ready from today's cache without reading the field history", async () => {
    const { svc, prisma } = setup({ cached: weather, seasonCrop: "corn" });
    const r = await svc.forField(WS, F1);
    expect(r.status).toBe("ready");
    expect(r.crop).toBe("corn");
    expect(r.metrics.map((m) => m.id)).toHaveLength(8);
    expect(r.source).toMatchObject({
      dataset: "NASA POWER",
      from: "1981-01-01",
      cell: { lat: 38, lon: -101.25 },
      resolutionKm: 55,
    });
    expect(r.source!.lastDate).toBe(weather.dates[weather.dates.length - 1]);
    // corn: region-less rule, emergence 10 May + 55..80 days, the cited threshold, labelled unreviewed
    expect(r.flowering).toMatchObject({ thresholdC: 35, from: "07-04", to: "07-29", verified: false, fallback: false });
    expect(r.flowering.source?.url).toContain("u.osu.edu");
    expect(prisma.db.cropSeason.findFirst).not.toHaveBeenCalled();
  });

  it("uses the series the field's own gather task stored when today's key is not cached", async () => {
    const { svc, sources } = setup({ stored: weather, task: { status: "done", cacheKey: "stored-key" } });
    const r = await svc.forField(WS, F1);
    expect(r.status).toBe("ready");
    expect(sources.fresh).not.toHaveBeenCalled();
  });

  it("main crop falls back to the last crop of the history, then to none (fallback window)", async () => {
    const a = await setup({ cached: weather, lastCrop: "sorghum" }).svc.forField(WS, F1);
    expect(a.crop).toBe("sorghum");
    const b = await setup({ cached: weather }).svc.forField(WS, F1);
    expect(b.crop).toBeNull();
    expect(b.flowering).toMatchObject({ fallback: true, thresholdC: 35, from: "06-01", to: "08-31", source: null });
  });

  it("is unavailable with a reason when no weather can be had", async () => {
    const r = await setup({ task: { status: "failed", cacheKey: null } }).svc.forField(WS, F1);
    expect(r).toMatchObject({ status: "unavailable", reason: "weather-missing", metrics: [] });
  });

  it("is unavailable 'too-few-years' for a short series", async () => {
    const n = 365 * 6;
    const short: DailyWeather = {
      ...weather,
      dates: weather.dates.slice(0, n),
      values: Object.fromEntries(Object.entries(weather.values).map(([k, v]) => [k, v.slice(0, n)])) as DailyWeather["values"],
    };
    const r = await setup({ cached: short }).svc.forField(WS, F1);
    expect(r).toMatchObject({ status: "unavailable", reason: "too-few-years" });
  });

  it("does not leak a field of another workspace", async () => {
    const { svc } = setup({ cached: weather });
    await expect(svc.forField(OTHER_WS, F1)).rejects.toMatchObject({ status: 404 });
  });

  it("memoises per field and data date", async () => {
    const gpm: GpmCheckProvider = { check: vi.fn(async () => null) };
    const { svc } = setup({ cached: weather, gpm });
    const a = await svc.forField(WS, F1);
    const b = await svc.forField(WS, F1);
    expect(b).toBe(a);
    expect(gpm.check).toHaveBeenCalledTimes(1);
  });

  it("calls a registered GPM provider and carries its result", async () => {
    const check = {
      status: "ready",
      early: { from: 2001, to: 2013 },
      late: { from: 2014, to: 2025 },
      powerChangePct: 1,
      imergChangePct: 2,
      agree: true,
      lastDate: "2026-10-31",
    } as const;
    const { svc } = setup({ cached: weather, gpm: { check: async () => ({ ...check }) } });
    expect((await svc.forField(WS, F1)).gpm).toEqual(check);
  });
});

describe("ClimateService.forPoint", () => {
  it("computes for a bare coordinate with crop null", async () => {
    const { svc, sources } = setup({ live: weather });
    const r = await svc.forPoint(-101.2, 37.98);
    expect(r.status).toBe("ready");
    expect(r.crop).toBeNull();
    expect(r.flowering.fallback).toBe(true);
    expect(sources.fresh).toHaveBeenCalledTimes(1);
  });

  it("rejects coordinates out of range", async () => {
    await expect(setup().svc.forPoint(200, 10)).rejects.toBeInstanceOf(ProblemException);
  });
});

describe("ClimateController", () => {
  it("rejects a malformed id with 404 and passes the workspace of the request", async () => {
    const forField = vi.fn(async () => ({ status: "pending" }));
    const ctl = new ClimateController({ forField } as never);
    expect(() => ctl.shift("nope", { workspaceId: WS } as never)).toThrow(ProblemException);
    await ctl.shift(F1, { workspaceId: WS } as never);
    expect(forField).toHaveBeenCalledWith(WS, F1);
  });
});
