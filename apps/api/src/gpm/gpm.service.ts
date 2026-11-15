import { createHash } from "node:crypto";
import { Inject, Injectable, Logger } from "@nestjs/common";
import type { GpmCheck } from "@terrasight/shared";
import { fetchGpmSeries, gpmCell, type DailyWeather, type GpmSeries } from "@terrasight/sources";
import { ENV, type Env } from "../config/config.js";
import { PrismaService } from "../db/prisma.service.js";
import { computeGpmCheck, UNAVAILABLE } from "./gpm-check.js";

/** What the climate module registers as its optional hook (S-10.11). Never throws. */
export interface GpmCheckProvider {
  check(lat: number, lon: number, powerDaily: DailyWeather): Promise<GpmCheck>;
}
export const GPM_CHECK_PROVIDER = Symbol("GPM_CHECK_PROVIDER");

const PRODUCT_VERSION = "GPM_3IMERGM.07";
const FRESH_MS = 30 * 864e5;
/** A failed read is not retried for this long (a missing token authorisation would otherwise be hit on every request). */
const FAILURE_BACKOFF_MS = 60 * 60e3;
/** When nothing is cached the caller waits at most this long; the read continues in the background. */
const WAIT_MS = 3000;
/** The whole first read (about 300 requests, 3 in parallel). */
const READ_BUDGET_MS = 10 * 60e3;

@Injectable()
export class GpmService implements GpmCheckProvider {
  private readonly log = new Logger(GpmService.name);
  private readonly inFlight = new Map<string, Promise<GpmSeries | null>>();
  private readonly failedAt = new Map<string, number>();

  constructor(
    private readonly prisma: PrismaService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  async check(lat: number, lon: number, powerDaily: DailyWeather): Promise<GpmCheck> {
    try {
      const series = await this.series(lat, lon);
      if (!series) return { ...UNAVAILABLE };
      return computeGpmCheck(series, powerDaily, lat);
    } catch (e) {
      this.log.warn(`GPM check unavailable: ${(e as Error).message}`);
      return { ...UNAVAILABLE };
    }
  }

  private async series(lat: number, lon: number): Promise<GpmSeries | null> {
    if (!this.env.EARTHDATA_TOKEN) return null;
    const cell = gpmCell(lat, lon);
    const key = createHash("sha256").update(`gpm:${PRODUCT_VERSION}:${cell.lat},${cell.lon}`).digest("hex");
    const row = await this.prisma.system.sourceCache.findUnique({ where: { key } });
    if (row?.payload && row.expiresAt && row.expiresAt > new Date()) return row.payload as unknown as GpmSeries;
    const failed = this.failedAt.get(key);
    if (failed && Date.now() - failed < FAILURE_BACKOFF_MS) return null;
    let job = this.inFlight.get(key);
    if (!job) {
      job = this.read(key, lat, lon).finally(() => this.inFlight.delete(key));
      this.inFlight.set(key, job);
    }
    // Wait briefly (the read of a warm neighbour may finish in seconds); otherwise the caller moves on without it.
    return Promise.race([job, new Promise<null>((resolve) => setTimeout(() => resolve(null), WAIT_MS).unref())]);
  }

  private async read(key: string, lat: number, lon: number): Promise<GpmSeries | null> {
    try {
      const series = await fetchGpmSeries(lat, lon, this.env.EARTHDATA_TOKEN, {
        signal: AbortSignal.timeout(READ_BUDGET_MS),
        fetch,
      });
      const data = {
        source: "gpm",
        params: { product: series.product, cell: series.cell },
        payload: series as unknown as object,
        dataDate: series.lastDate ? new Date(`${series.lastDate}T00:00:00Z`) : null,
        origin: "live",
        fetchedAt: new Date(),
        expiresAt: new Date(Date.now() + FRESH_MS),
      };
      await this.prisma.system.sourceCache.upsert({
        where: { key },
        create: { key, ...data } as never,
        update: data as never,
      });
      return series;
    } catch (e) {
      this.failedAt.set(key, Date.now());
      this.log.warn(`GPM IMERG read failed: ${(e as Error).message}`);
      return null;
    }
  }
}
