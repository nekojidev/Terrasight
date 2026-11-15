import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { Inject, Injectable } from "@nestjs/common";
import {
  createAdapters,
  type FieldGeometry,
  type SourceAdapter,
  type SourceId,
  type SourceResult,
} from "@terrasight/sources";
import { ENV, type Env } from "../config/config.js";
import { PrismaService } from "../db/prisma.service.js";
import type { Prisma } from "../generated/prisma/client.js";

/** Plain-language names used in reasons and the progress list (design 13). */
export const SOURCE_LABELS: Record<SourceId, string> = {
  power: "NASA POWER",
  cdl: "USDA CDL",
  ssurgo: "SSURGO",
  soilgrids: "SoilGrids",
  modis: "MODIS NDVI",
  dem: "Copernicus DEM",
  sentinel2: "Sentinel-2",
  openet: "OpenET",
  cropland: "Land cover",
  wapor: "FAO WaPOR",
};

/** What is missing when a source fails ("SSURGO did not respond, soil data missing", RFC §4). */
export const SOURCE_PROVIDES: Record<SourceId, string> = {
  power: "weather history missing",
  cdl: "crop history missing",
  ssurgo: "soil data missing",
  soilgrids: "soil data missing",
  modis: "vegetation history missing",
  dem: "slope missing",
  sentinel2: "recent satellite images missing",
  openet: "water-use data missing",
  cropland: "cropland check missing",
  wapor: "water-use data missing",
};

/** Per-task time budget. MODIS reads hundreds of composites on first fetch; the cache makes later runs instant. */
export const SOURCE_TIMEOUT_MS: Record<SourceId, number> = {
  power: 90_000,
  cdl: 180_000,
  ssurgo: 60_000,
  soilgrids: 60_000,
  modis: 300_000,
  dem: 60_000,
  sentinel2: 120_000,
  openet: 120_000,
  cropland: 120_000,
  wapor: 300_000,
};

/** How long a cached response stays fresh (RFC §5.4: history is permanent, current-year data refreshes weekly). */
const FRESH_DAYS: Partial<Record<SourceId, number>> = {
  power: 1,
  modis: 7,
  sentinel2: 1,
  openet: 30,
  cdl: 30,
  cropland: 30,
  wapor: 30,
};

export interface CachedSource<T = unknown> {
  result: SourceResult<T>;
  origin: "live" | "fixture";
  fetchedAt: Date;
}

@Injectable()
export class SourcesService {
  readonly adapters: SourceAdapter[];

  constructor(
    private readonly prisma: PrismaService,
    @Inject(ENV) private readonly env: Env,
  ) {
    this.adapters = createAdapters({
      cdseClientId: env.CDSE_CLIENT_ID,
      cdseClientSecret: env.CDSE_CLIENT_SECRET,
      openetApiKey: env.OPENET_API_KEY,
    });
  }

  adapter(id: string): SourceAdapter | undefined {
    return this.adapters.find((a) => a.id === id);
  }

  applicable(field: FieldGeometry): SourceAdapter[] {
    return this.adapters.filter((a) => a.appliesTo(field));
  }

  key(adapter: SourceAdapter, field: FieldGeometry, today: string): string {
    return createHash("sha256")
      .update(`${adapter.id}:${adapter.cacheKey(field, { today })}`)
      .digest("hex");
  }

  async cached<T>(key: string, allowStale = false): Promise<CachedSource<T> | null> {
    const row = await this.prisma.system.sourceCache.findUnique({ where: { key } });
    if (!row || row.payload === null) return null;
    if (!allowStale && row.expiresAt && row.expiresAt < new Date()) return null;
    return {
      result: row.payload as unknown as SourceResult<T>,
      origin: row.origin === "fixture" ? "fixture" : "live",
      fetchedAt: row.fetchedAt,
    };
  }

  async store(
    adapter: SourceAdapter,
    key: string,
    params: Record<string, unknown>,
    result: SourceResult,
    origin: "live" | "fixture",
  ): Promise<void> {
    const days = result.status === "done" ? FRESH_DAYS[adapter.id as SourceId] : 1; // partial results retry next day
    const data = {
      source: adapter.id,
      params: params as Prisma.InputJsonValue,
      payload: result as unknown as Prisma.InputJsonValue,
      dataDate: result.dataDate ? new Date(`${result.dataDate}T00:00:00Z`) : null,
      origin,
      fetchedAt: new Date(),
      expiresAt: days === undefined ? null : new Date(Date.now() + days * 864e5),
    };
    await this.prisma.system.sourceCache.upsert({ where: { key }, create: { key, ...data }, update: data });
  }

  /**
   * For field checks (S-03.03): fresh cache → live (rate-limited) → fixture → the last good result of the past
   * 7 days (`stale`, with its date) → null. Never throws.
   */
  async fresh<T>(
    source: SourceId,
    field: FieldGeometry,
    today: string,
    take: () => Promise<void>,
  ): Promise<{
    result: SourceResult<T>;
    origin: "cache" | "live" | "fixture" | "stale";
    error?: string;
  } | null> {
    const adapter = this.adapter(source);
    if (!adapter || !adapter.appliesTo(field)) return null;
    const key = this.key(adapter, field, today);
    const hit = await this.cached<T>(key);
    if (hit) return { result: hit.result, origin: "cache" };
    let error = "did not respond";
    try {
      await take();
      const result = (await adapter.fetch(field, {
        signal: AbortSignal.timeout(SOURCE_TIMEOUT_MS[source]),
        fetch,
        today,
      })) as SourceResult<T>;
      if (result.status !== "failed") {
        await this.store(adapter, key, { source, today }, result, "live");
        return { result, origin: "live" };
      }
      error = result.reason ?? error;
    } catch (e) {
      error = (e as Error).message;
    }
    const fixture = this.fixture<T>(adapter, field);
    if (fixture) return { result: fixture, origin: "fixture", error };
    for (let back = 1; back <= 7; back++) {
      const day = new Date(Date.parse(`${today}T00:00:00Z`) - back * 864e5).toISOString().slice(0, 10);
      const old = await this.cached<T>(this.key(adapter, field, day), true);
      if (old) return { result: old.result, origin: "stale", error };
    }
    return null;
  }

  /**
   * Stable key for a recorded response (S-09.02): the adapter's cache key with "fixture" in place of today's date, so
   * a recording made today is still found later. Shared with tools/record-fixtures.
   */
  fixtureKey(adapter: SourceAdapter, field: FieldGeometry): string {
    return createHash("sha256")
      .update(`${adapter.id}:${adapter.cacheKey(field, { today: "fixture" })}`)
      .digest("hex");
  }

  /** Recorded real response for this field, if one exists (fixtures/<source>/<fixtureKey>.json, S-09.02). */
  fixture<T>(adapter: SourceAdapter, field: FieldGeometry): SourceResult<T> | null {
    const path = join(this.env.FIXTURES_DIR, adapter.id, `${this.fixtureKey(adapter, field)}.json`);
    if (!existsSync(path)) return null;
    return JSON.parse(readFileSync(path, "utf8")) as SourceResult<T>;
  }

  /** Recorded forecast for a 0.1° cell (fixtures/forecast/<cell>.json), the last step before "no forecast". */
  forecastFixture<T>(cellKey: string): T | null {
    const path = join(this.env.FIXTURES_DIR, "forecast", `${cellKey}.json`);
    return existsSync(path) ? (JSON.parse(readFileSync(path, "utf8")) as T) : null;
  }
}
