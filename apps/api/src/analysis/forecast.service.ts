import { Inject, Injectable, Logger } from "@nestjs/common";
import {
  forecastCell,
  nwsForecast,
  openMeteoForecast,
  openMeteoHourly,
  type Forecast,
  type HourlyForecast,
} from "@terrasight/sources";
import { RateLimitService } from "../auth/rate-limit.js";
import { ENV, type Env } from "../config/config.js";
import { PrismaService } from "../db/prisma.service.js";
import { SourcesService } from "../sources/sources.service.js";
import type { Prisma } from "../generated/prisma/client.js";

/** Forecasts are shared per 0.1° cell and refreshed after 6 h (RFC §13). */
const FRESH_MS = 6 * 3600_000;
const TIMEOUT_MS = 20_000;
const BUCKET = { capacity: 10, refillPerSec: 5 };

export interface ForecastView {
  forecast: Forecast;
  /** `live` = fetched now, `cache` = still fresh, `stale` = last cached forecast after providers failed. */
  origin: "live" | "cache" | "stale";
  /** Hours since the forecast was fetched (shown as "Forecast from … ago" when stale). */
  ageHours: number;
  /** Provider failures on the way down the chain. */
  failures: string[];
}

/** Forecast chain (RFC §13): Open-Meteo → NWS (US only) → last cached forecast with its age → none. */
@Injectable()
export class ForecastService {
  private readonly log = new Logger(ForecastService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly limits: RateLimitService,
    @Inject(ENV) private readonly env: Env,
    private readonly sources: SourcesService,
  ) {}

  async get(lat: number, lon: number, country: string | null, today: string): Promise<ForecastView | null> {
    const cell = forecastCell(lat, lon);
    const key = `forecast:${cell.key}`;
    const row = await this.prisma.system.sourceCache.findUnique({ where: { key } });
    const age = row ? Date.now() - row.fetchedAt.getTime() : Infinity;
    const cached = row?.payload as unknown as Forecast | undefined;
    if (cached && age < FRESH_MS && cached.days.some((d) => d.date >= today)) {
      return { forecast: cached, origin: "cache", ageHours: Math.round(age / 3600_000), failures: [] };
    }

    const failures: string[] = [];
    const providers: Array<[string, () => Promise<Forecast>]> = [
      ["Open-Meteo", () => openMeteoForecast(cell, this.ctx(today), this.env.OPEN_METEO_API_KEY)],
      ...(country === "US"
        ? ([["NOAA NWS", () => nwsForecast(cell, this.ctx(today))]] as Array<
            [string, () => Promise<Forecast>]
          >)
        : []),
    ];
    for (const [name, call] of providers) {
      try {
        await this.limits.takeWithin(`source:forecast:${name}`, BUCKET, 200);
        const forecast = await call();
        const data = {
          source: "forecast",
          params: { cell: cell.key, provider: forecast.provider } as Prisma.InputJsonValue,
          payload: forecast as unknown as Prisma.InputJsonValue,
          dataDate: new Date(`${today}T00:00:00Z`),
          origin: "live",
          fetchedAt: new Date(),
          expiresAt: new Date(Date.now() + FRESH_MS),
        };
        await this.prisma.system.sourceCache.upsert({
          where: { key },
          create: { key, ...data },
          update: data,
        });
        return { forecast, origin: "live", ageHours: 0, failures };
      } catch (e) {
        failures.push(`${name} ${(e as Error).message}`);
        this.log.warn(`forecast ${cell.key}: ${name} failed: ${(e as Error).message}`);
      }
    }
    if (cached) return { forecast: cached, origin: "stale", ageHours: Math.round(age / 3600_000), failures };
    // Recorded forecast (fixtures, S-09.02): labelled stale with its age.
    const recorded = this.sources.forecastFixture<Forecast>(cell.key);
    if (recorded)
      return {
        forecast: recorded,
        origin: "stale",
        ageHours: Math.round((Date.now() - Date.parse(recorded.issuedAt)) / 3600_000),
        failures,
      };
    return null;
  }

  /**
   * Hourly forecast for work windows, cached per 0.1° cell like the daily one (6 h). Open-Meteo only (NWS has no
   * hourly set we use); on failure the last cached hours are returned as `stale`, else null.
   */
  async getHourly(
    lat: number,
    lon: number,
    today: string,
  ): Promise<{ forecast: HourlyForecast; origin: "live" | "cache" | "stale"; ageHours: number } | null> {
    const cell = forecastCell(lat, lon);
    const key = `forecast-hourly:${cell.key}`;
    const row = await this.prisma.system.sourceCache.findUnique({ where: { key } });
    const age = row ? Date.now() - row.fetchedAt.getTime() : Infinity;
    const cached = row?.payload as unknown as HourlyForecast | undefined;
    if (cached && age < FRESH_MS) return { forecast: cached, origin: "cache", ageHours: Math.round(age / 3600_000) };
    try {
      await this.limits.takeWithin("source:forecast:Open-Meteo", BUCKET, 200);
      const forecast = await openMeteoHourly(cell, this.ctx(today), this.env.OPEN_METEO_API_KEY);
      const data = {
        source: "forecast",
        params: { cell: cell.key, provider: forecast.provider, hourly: true } as Prisma.InputJsonValue,
        payload: forecast as unknown as Prisma.InputJsonValue,
        dataDate: new Date(`${today}T00:00:00Z`),
        origin: "live",
        fetchedAt: new Date(),
        expiresAt: new Date(Date.now() + FRESH_MS),
      };
      await this.prisma.system.sourceCache.upsert({ where: { key }, create: { key, ...data }, update: data });
      return { forecast, origin: "live", ageHours: 0 };
    } catch (e) {
      this.log.warn(`hourly forecast ${cell.key} failed: ${(e as Error).message}`);
      return cached ? { forecast: cached, origin: "stale", ageHours: Math.round(age / 3600_000) } : null;
    }
  }

  private ctx(today: string) {
    return { signal: AbortSignal.timeout(TIMEOUT_MS), fetch, today };
  }
}
