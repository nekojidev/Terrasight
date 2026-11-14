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
};

/** How long a cached response stays fresh (RFC §5.4: history is permanent, current-year data refreshes weekly). */
const FRESH_DAYS: Partial<Record<SourceId, number>> = {
  power: 1,
  modis: 7,
  sentinel2: 1,
  openet: 30,
  cdl: 30,
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

  /** Recorded real response for this exact request, if one exists (fixtures/<source>/<key>.json, S-09.02). */
  fixture<T>(adapter: SourceAdapter, key: string): SourceResult<T> | null {
    const path = join(this.env.FIXTURES_DIR, adapter.id, `${key}.json`);
    if (!existsSync(path)) return null;
    return JSON.parse(readFileSync(path, "utf8")) as SourceResult<T>;
  }
}
