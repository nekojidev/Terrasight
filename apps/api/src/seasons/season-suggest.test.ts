import { fileURLToPath } from "node:url";
import { loadLibrary } from "@terrasight/library";
import { describe, expect, it, vi } from "vitest";
import type { Env } from "../config/config.js";
import { ProblemException } from "../http/problem.js";
import { SeasonSuggestController } from "./season-suggest.controller.js";
import { SeasonSuggestService } from "./season-suggest.service.js";
import { SeasonsService } from "./seasons.service.js";

const DATA_DIR = fileURLToPath(new URL("../../../../data/", import.meta.url));
const env = { DATA_DIR, PLAN_FIRST_SEASON: 2026 } as Env;
const lib = loadLibrary(DATA_DIR);
const WS = "11111111-1111-4111-8111-111111111111";
const F = "22222222-2222-4222-8222-222222222222";

/** 60 days from 2026-04-01, mean 20 C (tmin 14, tmax 26): 10 degree days a day for a base of 10. */
const power = {
  dates: Array.from({ length: 60 }, (_, i) => new Date(Date.UTC(2026, 3, 1 + i)).toISOString().slice(0, 10)),
  values: {
    T2M: Array(60).fill(20),
    T2M_MIN: Array(60).fill(14),
    T2M_MAX: Array(60).fill(26),
    PRECTOTCORR: Array(60).fill(0),
    TS: Array(60).fill(15),
  },
};

function build(opts: {
  regionId?: string | null;
  slopePct?: number | null;
  withPower?: boolean;
  soilC?: number | null;
}) {
  const regionId = opts.regionId === undefined ? "us-southern-plains" : opts.regionId;
  const prisma = {
    db: {
      field: {
        findFirst: vi.fn().mockResolvedValue({ regionId, slopePct: opts.slopePct ?? null, country: "US" }),
      },
    },
    system: { workspace: { findUnique: vi.fn().mockResolvedValue({ timeZone: "America/Chicago" }) } },
  };
  const seasons = new SeasonsService(prisma as never, env);
  const sources = {
    fresh: vi.fn().mockResolvedValue(opts.withPower ? { result: { payload: power } } : null),
  };
  const hours = Array.from({ length: 48 }, (_, i) => ({
    time: `2026-04-${25 + Math.floor(i / 24)}T${String(i % 24).padStart(2, "0")}:00`,
    soilTemp6cmC: opts.soilC ?? null,
  }));
  const forecasts = {
    get: vi.fn().mockResolvedValue(null),
    getHourly: vi.fn().mockResolvedValue(opts.soilC == null ? null : { forecast: { hours } }),
  };
  const limits = { takeWithin: vi.fn().mockResolvedValue(undefined) };
  const geo = { fieldGeometry: vi.fn().mockResolvedValue({ centroid: { lat: 37.9, lon: -100.8 } }) };
  const service = new SeasonSuggestService(
    prisma as never,
    seasons,
    forecasts as never,
    sources as never,
    limits as never,
    geo as never,
    env,
    lib,
  );
  return { service };
}

const at = (iso: string) => new Date(`${iso}T18:00:00Z`);

describe("GET season-records/:season/suggest", () => {
  it("open window: window, best date from soil temperature, emergence by degree days, tillage with reason", async () => {
    const { service } = build({ withPower: true, soilC: 12, slopePct: 6 });
    const s = await service.suggest(WS, F, 2026, "corn", null, at("2026-04-20"));
    expect(s.sowing).toMatchObject({
      window: { from: "2026-04-15", to: "2026-05-15" },
      status: "open",
      daysLeft: 25,
      best: "2026-04-25",
      bestBasis: "soil-temp",
      verified: false,
    });
    // Corn: base 10 C, 65 degree days; 14/26 C days give 10 a day, so the 7th day counting the sowing day (the sowing day counts).
    expect(s.emergence).toMatchObject({ date: "2026-05-01", method: "gdd-observed", verified: false });
    expect(s.emergence?.source?.title).toMatch(/Corn/);
    expect(s.tillage).toMatchObject({
      value: "no_till",
      reason: "slope 6%: keep residue on the surface",
      verified: false,
    });
    expect(s.alternatives).toBeUndefined();
  });

  it("recomputes emergence from a sowing date the user typed", async () => {
    const { service } = build({ withPower: true });
    const s = await service.suggest(WS, F, 2026, "corn", "2026-04-10", at("2026-04-20"));
    expect(s.emergence?.date).toBe("2026-04-16");
  });

  it("falls back to typical days, labelled so, when there is no weather", async () => {
    const { service } = build({});
    const s = await service.suggest(WS, F, 2026, "sunflower", null, at("2026-05-25"));
    expect(s.sowing.status).toBe("open");
    expect(s.emergence).toMatchObject({ method: "typical-days", verified: false });
  });

  it("too late: closed window with alternatives still open, plus winter crops for next season", async () => {
    const { service } = build({});
    const s = await service.suggest(WS, F, 2026, "corn", null, at("2026-07-05"));
    expect(s.sowing).toMatchObject({ status: "closed", best: null });
    expect(s.emergence).toBeNull();
    const alt = s.alternatives ?? [];
    expect(alt.map((a) => a.crop)).toEqual(
      expect.arrayContaining(["millet", "forage_sorghum", "winter_wheat"]),
    );
    expect(alt.find((a) => a.crop === "millet")).toMatchObject({
      status: "open",
      season: 2026,
      daysLeft: 10,
    });
    expect(alt.find((a) => a.crop === "winter_wheat")).toMatchObject({ status: "not-yet", season: 2027 });
    expect(alt.find((a) => a.crop === "corn")).toBeUndefined();
    expect(alt[0]!.status).toBe("open");
  });

  it("window not open yet", async () => {
    const { service } = build({});
    const s = await service.suggest(WS, F, 2026, "cotton", null, at("2026-03-01"));
    expect(s.sowing).toMatchObject({ status: "not-yet", opensInDays: 61, best: "2026-05-15" });
  });

  it("is honest when the region has no sowing calendar: no window, the user types the dates", async () => {
    const { service } = build({ regionId: "ua-steppe" });
    const s = await service.suggest(WS, F, 2026, "corn", null, at("2026-04-20"));
    expect(s.sowing).toMatchObject({ window: null, best: null, status: "unknown", source: null });
    expect(s.emergence).toBeNull();
    expect(s.tillage).toBeNull();
  });

  it("rejects a crop that is not in the library", async () => {
    const { service } = build({});
    await expect(service.suggest(WS, F, 2026, "banana", null)).rejects.toMatchObject({ status: 422 });
  });

  it("controller validates the query and the id", async () => {
    const suggest = vi.fn().mockResolvedValue({ ok: true });
    const c = new SeasonSuggestController({
      suggest,
      assertField: vi.fn().mockResolvedValue(undefined),
    } as never);
    const req = { workspaceId: WS } as never;
    expect(await c.suggest(F, 2026, { crop: "corn", sowing: "2026-04-20" }, req)).toEqual({ ok: true });
    expect(suggest).toHaveBeenCalledWith(WS, F, 2026, "corn", "2026-04-20");
    await expect(c.suggest(F, 2026, {}, req)).rejects.toBeInstanceOf(ProblemException);
    await expect(c.suggest("nope", 2026, { crop: "corn" }, req)).rejects.toBeInstanceOf(ProblemException);
    await expect(c.suggest(F, 1900, { crop: "corn" }, req)).rejects.toBeInstanceOf(ProblemException);
    await expect(c.suggest(F, 2026, { crop: "corn", sowing: "2026-13-45" }, req)).rejects.toBeInstanceOf(
      ProblemException,
    );
  });
});
