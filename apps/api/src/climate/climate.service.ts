import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Inject, Injectable, Logger, Optional } from "@nestjs/common";
import {
  climateShift,
  dailyFromPower,
  DEFAULT_ALPHA,
  DEFAULT_BASELINE,
  DEFAULT_RECENT,
  hemisphereOf,
  MIN_TREND_YEARS,
  addDays,
  resolveFlowering,
  SEASONS,
  type CropFloweringTable,
  type DailySeries,
} from "@terrasight/climate";
import { loadCropFlowering } from "@terrasight/library";
import type { ClimateShift, GpmCheck } from "@terrasight/shared";
import type { DailyWeather, FieldGeometry } from "@terrasight/sources";
import { RateLimitService } from "../auth/rate-limit.js";
import { ENV, type Env } from "../config/config.js";
import { PrismaService } from "../db/prisma.service.js";
import { ProblemException } from "../http/problem.js";
import { GeoService } from "../geo/geo.service.js";
import { SeasonsService } from "../seasons/seasons.service.js";
import { SourcesService } from "../sources/sources.service.js";

const POWER_BUCKET = { capacity: 8, refillPerSec: 2 };
/** NASA POWER's native grid is about 55 km (0.5° latitude); neighbouring fields share the numbers. */
export const POWER_RESOLUTION_KM = 55;
const MEMO_MAX = 256;

/**
 * Optional second rainfall record (S-10.11: GPM IMERG). When a provider is registered under `GPM_CHECK_PROVIDER` the
 * service calls it after the POWER numbers are computed; a provider that throws or returns null leaves `gpm: null`.
 */
export interface GpmCheckProvider {
  check(input: {
    lon: number;
    lat: number;
    /** The POWER series the shift was computed from. */
    daily: DailySeries;
    hemisphere: "north" | "south";
    season: { from: string; to: string };
    /** Last day of the POWER series (ISO). */
    lastDate: string;
  }): Promise<GpmCheck | null>;
}
export const GPM_CHECK_PROVIDER = Symbol("GPM_CHECK_PROVIDER");

interface Crop {
  crop: string | null;
  /** Emergence date as MM-DD for the "days after emergence" rule. */
  emergenceMmdd: string | null;
}

const utcToday = (): string => new Date().toISOString().slice(0, 10);

/** Climate shift per field (reads the cached POWER series, never the field history) and per bare coordinate. */
@Injectable()
export class ClimateService {
  private readonly log = new Logger(ClimateService.name);
  private readonly memo = new Map<string, ClimateShift>();
  private table: CropFloweringTable | undefined;
  private phenology: Record<string, { typicalEmergenceDays?: number }> | undefined;
  private calendar: Record<string, { sowing?: Record<string, string> }> | undefined;

  constructor(
    private readonly prisma: PrismaService,
    private readonly sources: SourcesService,
    private readonly geo: GeoService,
    private readonly limits: RateLimitService,
    @Inject(ENV) private readonly env: Env,
    @Optional() @Inject(GPM_CHECK_PROVIDER) private readonly gpm?: GpmCheckProvider,
  ) {}

  private floweringTable(): CropFloweringTable {
    if (!this.table) {
      const file = loadCropFlowering(this.env.DATA_DIR);
      if (!file) this.log.warn("data/crop-flowering.json missing or invalid: the labelled fallback applies to every crop");
      this.table = file ?? {
        version: 0,
        fallback: { thresholdC: 35, north: { from: "06-01", to: "08-31" }, south: { from: "12-01", to: "02-28" } },
        crops: {},
      };
    }
    return this.table;
  }

  private readJson<T>(file: string, fallback: T): T {
    try {
      return JSON.parse(readFileSync(join(this.env.DATA_DIR, file), "utf8")) as T;
    } catch {
      return fallback;
    }
  }

  /** Main crop and emergence date: this season's record, else the last crop of the history, else none. */
  private async mainCrop(fieldId: string, regionId: string | null): Promise<Crop> {
    this.phenology ??= this.readJson<{ crops?: Record<string, { typicalEmergenceDays?: number }> }>(
      "crop-phenology.json",
      {},
    ).crops ?? {};
    this.calendar ??= this.readJson<{ regions?: Record<string, { sowing?: Record<string, string> }> }>(
      "crop-calendar.json",
      {},
    ).regions ?? {};
    const season = SeasonsService.currentSeason();
    const record = await this.prisma.db.seasonRecord.findUnique({
      where: { fieldId_season: { fieldId, season } },
      select: { crop: true, sowingDate: true, emergenceDate: true },
    });
    let crop = record?.crop ?? null;
    let useRecord = !!crop;
    if (!crop) {
      const last = await this.prisma.db.cropSeason.findFirst({
        where: { fieldId },
        orderBy: { season: "desc" },
        select: { mainCrop: true },
      });
      crop = last?.mainCrop ?? null;
    }
    if (!crop) return { crop: null, emergenceMmdd: null };
    const lag = this.phenology[crop]?.typicalEmergenceDays;
    const mmdd = (d: Date) => d.toISOString().slice(5, 10);
    if (useRecord && record?.emergenceDate) return { crop, emergenceMmdd: mmdd(record.emergenceDate) };
    useRecord = useRecord && !!record?.sowingDate;
    const sowing = useRecord ? mmdd(record!.sowingDate!) : (regionId && this.calendar[regionId]?.sowing?.[crop]) || null;
    return { crop, emergenceMmdd: sowing && lag !== undefined ? addDays(sowing, lag) : null };
  }

  private empty(
    status: ClimateShift["status"],
    lat: number,
    crop: Crop,
    reason?: string,
  ): ClimateShift {
    const hemisphere = hemisphereOf(lat);
    return {
      status,
      ...(reason ? { reason } : {}),
      periods: { baseline: DEFAULT_BASELINE, recent: DEFAULT_RECENT },
      hemisphere,
      season: SEASONS[hemisphere],
      crop: crop.crop,
      flowering: resolveFlowering(this.floweringTable(), {
        crop: crop.crop,
        regionId: null,
        emergenceMmdd: crop.emergenceMmdd,
        hemisphere,
      }),
      metrics: [],
      alpha: DEFAULT_ALPHA,
      skippedYears: [],
      source: null,
      gpm: null,
    };
  }

  private async compute(
    weather: DailyWeather,
    lon: number,
    lat: number,
    crop: Crop,
    regionId: string | null,
    memoKey: string,
  ): Promise<ClimateShift> {
    const last = weather.dates[weather.dates.length - 1];
    if (!last || weather.dates.length < 365) return this.empty("unavailable", lat, crop, "weather-missing");
    const key = `${memoKey}:${last}:${crop.crop}:${crop.emergenceMmdd}:${regionId}`;
    const hit = this.memo.get(key);
    if (hit) return hit;
    const daily = dailyFromPower(weather);
    const hemisphere = hemisphereOf(lat);
    const flowering = resolveFlowering(this.floweringTable(), {
      crop: crop.crop,
      regionId,
      emergenceMmdd: crop.emergenceMmdd,
      hemisphere,
    });
    const shift = climateShift({ daily, lat, flowering });
    // Last day with data (POWER fills the newest days with fill values; the adapter trims them, this is a safeguard).
    let lastIdx = daily.dates.length - 1;
    while (lastIdx > 0 && daily.tmean[lastIdx] == null) lastIdx--;
    const lastDate = daily.dates[lastIdx]!;
    const base = this.empty("ready", lat, crop);
    let result: ClimateShift = {
      ...base,
      flowering,
      hemisphere: shift.hemisphere,
      season: shift.season,
      metrics: shift.metrics,
      skippedYears: shift.skippedYears,
      source: {
        dataset: "NASA POWER",
        from: daily.dates[0]!,
        lastDate,
        cell: { lat: weather.cell.lat, lon: weather.cell.lon },
        resolutionKm: POWER_RESOLUTION_KM,
      },
    };
    if ((shift.metrics[0]?.trend.years ?? 0) < MIN_TREND_YEARS) {
      result = { ...this.empty("unavailable", lat, crop, "too-few-years"), flowering, skippedYears: shift.skippedYears };
    } else if (this.gpm) {
      try {
        result.gpm = await this.gpm.check({ lon, lat, daily, hemisphere, season: shift.season, lastDate });
      } catch (e) {
        this.log.warn(`gpm check ${lon},${lat}: ${(e as Error).message}`);
      }
    }
    if (this.memo.size >= MEMO_MAX) this.memo.delete(this.memo.keys().next().value!);
    this.memo.set(key, result);
    return result;
  }

  /**
   * The cached POWER series of a field. Order: today's cache entry → the series the field's own gather task stored
   * (any age) → pending while that task still runs → live (rate-limited) / fixture / last cached days → null.
   */
  private async fieldWeather(
    fieldId: string,
    geom: FieldGeometry,
  ): Promise<{ weather: DailyWeather | null; pending: boolean }> {
    const today = utcToday();
    const adapter = this.sources.adapter("power");
    if (!adapter) return { weather: null, pending: false };
    const hit = await this.sources.cached<DailyWeather>(this.sources.key(adapter, geom, today));
    if (hit?.result.payload) return { weather: hit.result.payload, pending: false };
    const task = await this.prisma.system.gatherTask.findFirst({
      where: { source: "power", job: { fieldId } },
      orderBy: { job: { startedAt: "desc" } },
      select: { status: true, cacheKey: true },
    });
    if (task?.cacheKey) {
      const stored = await this.sources.cached<DailyWeather>(task.cacheKey, true);
      if (stored?.result.payload) return { weather: stored.result.payload, pending: false };
    }
    if (task && (task.status === "queued" || task.status === "running")) return { weather: null, pending: true };
    return { weather: await this.live(geom, today), pending: false };
  }

  private async live(geom: FieldGeometry, today: string): Promise<DailyWeather | null> {
    const got = await this.sources.fresh<DailyWeather>("power", geom, today, () =>
      this.limits.takeWithin("source:power", POWER_BUCKET, 250),
    );
    return got?.result.payload ?? null;
  }

  async forField(workspaceId: string, fieldId: string): Promise<ClimateShift> {
    const field = await this.prisma.db.field.findFirst({
      where: { id: fieldId, workspaceId, archivedAt: null },
      select: { id: true, regionId: true },
    });
    if (!field) throw new ProblemException(404, "not-found");
    const geom = await this.geo.fieldGeometry(fieldId);
    const { lon, lat } = geom.centroid;
    const crop = await this.mainCrop(fieldId, field.regionId);
    try {
      const { weather, pending } = await this.fieldWeather(fieldId, geom);
      if (pending) return this.empty("pending", lat, crop);
      if (!weather) return this.empty("unavailable", lat, crop, "weather-missing");
      return await this.compute(weather, lon, lat, crop, field.regionId, fieldId);
    } catch (e) {
      this.log.warn(`climate shift ${fieldId}: ${(e as Error).message}`);
      return this.empty("unavailable", lat, crop, "weather-missing");
    }
  }

  /** The same numbers for a bare coordinate (no account; crop null, so the fallback flowering window applies). */
  async forPoint(lon: number, lat: number): Promise<ClimateShift> {
    if (!(lon >= -180 && lon <= 180 && lat >= -90 && lat <= 90))
      throw new ProblemException(422, "invalid-input", "Coordinates out of range");
    const none: Crop = { crop: null, emergenceMmdd: null };
    const geom: FieldGeometry = {
      polygons: [],
      centroid: { lon, lat },
      bbox: [lon, lat, lon, lat],
      country: null,
    };
    try {
      const weather = await this.live(geom, utcToday());
      if (!weather) return this.empty("unavailable", lat, none, "weather-missing");
      return await this.compute(weather, lon, lat, none, null, `point:${weather.cell.lon},${weather.cell.lat}`);
    } catch (e) {
      this.log.warn(`climate shift point ${lon},${lat}: ${(e as Error).message}`);
      return this.empty("unavailable", lat, none, "weather-missing");
    }
  }
}
