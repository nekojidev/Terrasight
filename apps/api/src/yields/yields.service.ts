import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { Inject, Injectable } from "@nestjs/common";
import {
  fetchCountyYields,
  NASS_ATTRIBUTION,
  NASS_CROPS,
  nassCacheKey,
  stripKey,
  type CountyYield,
  type NassResult,
  type Practice,
} from "@terrasight/sources";
import { ENV, type Env } from "../config/config.js";
import { PrismaService } from "../db/prisma.service.js";
import type { Prisma } from "../generated/prisma/client.js";
import { CircuitBreaker } from "../sources/circuit-breaker.js";

/** Past years do not change (S-10.07): a county + crop series stays fresh for 30 days. */
export const YIELDS_FRESH_DAYS = 30;
const TIMEOUT_MS = 30_000;

export interface CountyYieldPoint {
  year: number;
  tPerHa: number;
  practice: Practice;
}

type Origin = "cache" | "live" | "fixture" | "stale";

export type FieldCountyYields =
  | { connected: false; reason: string }
  /** Not a US county (the hindcast uses data/ua-yields.json for Ukraine). */
  | { connected: true; kind: "none" }
  | {
      connected: true;
      kind: "county";
      area: string;
      crops: Record<string, CountyYieldPoint[]>;
      /** Crops of the history for which Quick Stats has no county series or no published value. */
      missing: string[];
      /** Oldest fetch among the series. */
      fetchedAt: string;
      /** Where each series came from. */
      origin: Record<string, Origin>;
      /** Set when a live call failed and a recording or an older copy was used. */
      note?: string;
      attribution: string;
    };

type Ok = Extract<NassResult, { ok: true }>;

@Injectable()
export class CountyYieldsService {
  private readonly breaker = new CircuitBreaker({ threshold: 5, cooldownMs: 60_000 });

  constructor(
    private readonly prisma: PrismaService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  /** Cache key hash; contains no API key and no date. */
  cacheKey(q: { stateAlpha: string; countyFips: string; crop: string }): string {
    return createHash("sha256").update(nassCacheKey(q)).digest("hex");
  }

  async forField(fieldId: string): Promise<FieldCountyYields> {
    const rows = await this.prisma.system.$queryRaw<
      Array<{ country: string | null; geoid: string | null; name: string | null; state_code: string | null }>
    >`
      SELECT f.country, u.geoid, u.name, u.state_code
      FROM fields f
      LEFT JOIN LATERAL (SELECT geoid, name, state_code FROM us_counties WHERE ST_Contains(geom, ST_PointOnSurface(f.geom)) LIMIT 1) u ON true
      WHERE f.id = ${fieldId}::uuid`;
    const r = rows[0];
    if (!r || r.country !== "US" || !r.geoid || !r.state_code) return { connected: true, kind: "none" };

    const seasons = await this.prisma.system.cropSeason.findMany({
      where: { fieldId },
      select: { mainCrop: true, secondCrop: true },
    });
    const wanted = [...new Set(seasons.flatMap((s) => [s.mainCrop, s.secondCrop]).filter((c): c is string => !!c))]
      .filter((c) => NASS_CROPS[c])
      .sort();
    const key = this.env.NASS_API_KEY;
    const crops: Record<string, CountyYieldPoint[]> = {};
    const origin: Record<string, Origin> = {};
    const missing: string[] = [];
    const errors: string[] = [];
    const fetched: string[] = [];
    let area = `${r.name ?? r.geoid} County, ${r.state_code}`;
    for (const crop of wanted) {
      const got = await this.series(r.state_code, r.geoid, crop, key);
      if (got.error) errors.push(got.error);
      if (!got.result) {
        missing.push(crop);
        continue;
      }
      area = got.result.area.includes("County") ? got.result.area : area;
      origin[crop] = got.origin;
      fetched.push(got.result.fetchedAt);
      const points = got.result.rows.filter((x): x is CountyYield & { tPerHa: number } => x.tPerHa !== null);
      if (points.length === 0) missing.push(crop);
      else crops[crop] = points.map((x) => ({ year: x.year, tPerHa: x.tPerHa, practice: x.practice }));
    }
    if (!key && Object.keys(crops).length === 0) {
      return { connected: false, reason: "USDA NASS API key is not configured" };
    }
    return {
      connected: true,
      kind: "county",
      area,
      crops,
      missing,
      fetchedAt: fetched.sort()[0] ?? new Date().toISOString(),
      origin,
      ...(errors.length ? { note: [...new Set(errors)].join("; ") } : {}),
      attribution: NASS_ATTRIBUTION,
    };
  }

  /** Fresh cache, then live (breaker), then a recorded fixture, then any older cached copy. Never throws. */
  private async series(
    stateAlpha: string,
    countyFips: string,
    crop: string,
    apiKey: string | undefined,
  ): Promise<{ result: Ok | null; origin: Origin; error?: string }> {
    const key = this.cacheKey({ stateAlpha, countyFips, crop });
    const row = await this.prisma.system.sourceCache.findUnique({ where: { key } });
    const cached = row?.payload ? (row.payload as unknown as Ok) : null;
    if (cached && row?.expiresAt && row.expiresAt > new Date()) return { result: cached, origin: "cache" };

    let error: string | undefined;
    if (apiKey) {
      try {
        const res = await this.breaker.run(
          "nass",
          () =>
            fetchCountyYields(
              { stateAlpha, countyFips, crop },
              { apiKey, signal: AbortSignal.timeout(TIMEOUT_MS), fetch },
            ),
          (x) => x.connected && !x.ok,
        );
        if (res.connected && res.ok) {
          const data = {
            source: "nass",
            params: { stateAlpha, countyFips, crop } as Prisma.InputJsonValue,
            payload: res as unknown as Prisma.InputJsonValue,
            dataDate: null,
            origin: "live",
            fetchedAt: new Date(),
            expiresAt: new Date(Date.now() + YIELDS_FRESH_DAYS * 864e5),
          };
          await this.prisma.system.sourceCache.upsert({ where: { key }, create: { key, ...data }, update: data });
          return { result: res, origin: "live" };
        }
        if (res.connected && !res.ok) error = `NASS ${res.reason}`;
      } catch (e) {
        error = `NASS ${stripKey((e as Error).message, apiKey)}`;
      }
    }
    const fixture = this.fixture(stateAlpha, countyFips, crop);
    if (fixture) return { result: fixture, origin: "fixture", error };
    if (cached) return { result: cached, origin: "stale", error };
    return { result: null, origin: "live", error };
  }

  /** Recorded real response (fixtures/nass/<STATE>-<fips>-<crop>.json). */
  fixture(stateAlpha: string, countyFips: string, crop: string): Ok | null {
    const path = join(this.env.FIXTURES_DIR, "nass", `${stateAlpha}-${countyFips}-${crop}.json`);
    return existsSync(path) ? (JSON.parse(readFileSync(path, "utf8")) as Ok) : null;
  }
}
