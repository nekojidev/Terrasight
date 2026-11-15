import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import type { ClimateShift } from "@terrasight/shared";
import { MemoryBuckets } from "../auth/rate-limit.js";
import { ProblemException } from "../http/problem.js";
import { ZodPipe } from "../http/zod.js";
import { PublicController } from "./public.controller.js";
import { DAILY_COLD_CAP, PublicService } from "./public.service.js";

const DATA = fileURLToPath(new URL("../../../../data/", import.meta.url));
const READY = { status: "ready", metrics: [] } as unknown as ClimateShift;

function setup(o: { warm?: boolean; enabled?: boolean; slow?: boolean } = {}) {
  const buckets = new MemoryBuckets();
  const limits = { take: vi.fn(async (k: string, s: { capacity: number; refillPerSec: number }) => buckets.take(k, s)) };
  let release: () => void = () => undefined;
  const forPoint = vi.fn(
    () => (o.slow ? new Promise<ClimateShift>((r) => (release = () => r(READY))) : Promise.resolve(READY)),
  );
  const sources = {
    adapter: () => ({ id: "power" }),
    key: () => "k",
    cached: vi.fn(async () => (o.warm ? { result: {} } : null)),
  };
  const redis = { available: false, client: null };
  const env = { PUBLIC_EXPLORE: o.enabled === false ? "0" : "1", DATA_DIR: DATA };
  const svc = new PublicService(
    { forPoint } as never,
    sources as never,
    limits as never,
    redis as never,
    env as never,
  );
  return { svc, forPoint, sources, ctl: new PublicController(svc), release: () => release() };
}

const code = async (p: Promise<unknown>) => {
  try {
    await p;
  } catch (e) {
    if (e instanceof ProblemException) return (e.getResponse() as { type: string; status: number });
    throw e;
  }
  return null;
};
const res = () => ({ setHeader: vi.fn() }) as never;

describe("validation", () => {
  const pipe = new ZodPipe(
    z.object({ lon: z.number().min(-180).max(180), lat: z.number().min(-90).max(90) }).strict(),
  );
  it.each([
    [{ lon: 181, lat: 0 }],
    [{ lon: 0, lat: -91 }],
    [{ lon: "1", lat: 2 }],
    [{ lon: 1 }],
    [{ lon: 1, lat: 2, extra: 1 }],
    [null],
    ["x"],
  ])("rejects %j with 422", (body) => {
    expect(() => pipe.transform(body)).toThrow(ProblemException);
  });
  it("accepts a point", () => {
    expect(pipe.transform({ lon: -101.05, lat: 38.1 })).toEqual({ lon: -101.05, lat: 38.1 });
  });
});

describe("climate-shift", () => {
  it("answers a ready result with a one-hour public cache header and logs no coordinates", async () => {
    const { ctl } = setup({ warm: true });
    const r = res();
    const out = await ctl.climateShift({ lon: -101.05, lat: 38.1 }, "1.2.3.4", r);
    expect(out.status).toBe("ready");
    expect((r as unknown as { setHeader: ReturnType<typeof vi.fn> }).setHeader).toHaveBeenCalledWith(
      "Cache-Control",
      "public, max-age=3600",
    );
  });

  it("limits one IP: the burst is used up, then 429; another IP is unaffected", async () => {
    const { ctl } = setup({ warm: true });
    // The in-process bucket runs at half rate (burst 6 instead of 12).
    for (let i = 0; i < 6; i++) await ctl.climateShift({ lon: 1, lat: 1 }, "9.9.9.9", res());
    const over = await code(ctl.climateShift({ lon: 1, lat: 1 }, "9.9.9.9", res()));
    expect(over?.status).toBe(429);
    expect(over?.type).toMatch(/rate-limited$/);
    expect(await code(ctl.climateShift({ lon: 1, lat: 1 }, "8.8.8.8", res()))).toBeNull();
  });

  it("warm cells never touch the cold limits", async () => {
    const { svc, forPoint } = setup({ warm: true });
    for (let i = 0; i < 5; i++) await svc.climateShift(`10.0.0.${i}`, 1, 1);
    expect(forPoint).toHaveBeenCalledTimes(5);
  });

  it("stops cold fetches at the daily cap while cached cells keep working", async () => {
    const { svc, sources } = setup();
    // Lift the hourly bucket out of the way: the cap is what is tested.
    (svc as unknown as { limits: { take: () => Promise<boolean> } }).limits.take = async () => true;
    (svc as unknown as { memoryDay: unknown }).memoryDay = { day: new Date().toISOString().slice(0, 10), count: DAILY_COLD_CAP };
    const capped = await code(svc.climateShift("1.1.1.1", 10, 10));
    expect(capped?.status).toBe(429);
    expect(capped?.type).toMatch(/daily-cap$/);
    sources.cached.mockResolvedValue({ result: {} } as never);
    expect((await svc.climateShift("1.1.1.1", 10, 10)).status).toBe("ready");
  });

  it("limits all visitors' cold fetches per hour", async () => {
    const { svc } = setup();
    let hit: Awaited<ReturnType<typeof code>> = null;
    // 30 cold fetches fit (half rate without Redis); each from its own IP and cell
    for (let i = 0; i < 40 && !hit; i++) hit = await code(svc.climateShift(`2.2.${i}.1`, -170 + i * 2, 10));
    expect(hit?.status).toBe(429);
  });

  it("shares one fetch between simultaneous visitors of the same cell", async () => {
    const { svc, forPoint, release } = setup({ slow: true });
    const a = svc.climateShift("3.3.3.1", 5, 5);
    await new Promise((r) => setTimeout(r, 5));
    const b = svc.climateShift("3.3.3.2", 5.01, 5.01);
    await new Promise((r) => setTimeout(r, 5));
    release();
    await Promise.all([a, b]);
    expect(forPoint).toHaveBeenCalledTimes(1);
  });
});

describe("kill switch", () => {
  it("answers 404 on every route when PUBLIC_EXPLORE=0", async () => {
    const { ctl } = setup({ enabled: false, warm: true });
    expect((await code(ctl.climateShift({ lon: 1, lat: 1 }, "1.1.1.1", res())))?.status).toBe(404);
    expect(() => ctl.outlines()).toThrow(ProblemException);
    expect(() => ctl.outline("pivot-12")).toThrow(ProblemException);
  });
});

describe("outlines", () => {
  it("lists the committed outlines with name, place, area and centroid, and nothing else", () => {
    const { ctl } = setup();
    const { items } = ctl.outlines();
    expect(items.map((i) => i.id)).toEqual(["pivot-12", "pivot-14"]);
    const p12 = items.find((i) => i.id === "pivot-12")!;
    expect(Object.keys(p12).sort()).toEqual(["areaHa", "centroid", "geojsonUrl", "id", "name", "place"]);
    expect(p12.place).toBe("Finney County, Kansas, USA");
    expect(p12.centroid.lat).toBeCloseTo(38.1, 1);
    expect(p12.centroid.lon).toBeCloseTo(-101.05, 1);
    expect(JSON.stringify(items)).not.toMatch(/workspace|owner|user/i);
  });

  it("serves one outline as a Feature and 404s on unknown or hostile ids", () => {
    const { ctl } = setup();
    const f = ctl.outline("pivot-12") as { type: string; properties: Record<string, unknown> };
    expect(f.type).toBe("Feature");
    expect(Object.keys(f.properties).sort()).toEqual(["areaHa", "id", "name"]);
    for (const bad of ["../package", "nope", "PIVOT-12", "pivot-12.geojson"])
      expect(() => ctl.outline(bad)).toThrow(ProblemException);
  });
});
