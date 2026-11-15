import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { Inject, Injectable, Logger } from "@nestjs/common";
import { powerCell, type FieldGeometry } from "@terrasight/sources";
import type { ClimateShift } from "@terrasight/shared";
import { RateLimitService, type BucketSpec } from "../auth/rate-limit.js";
import { ClimateService } from "../climate/climate.service.js";
import { ENV, type Env } from "../config/config.js";
import { ProblemException } from "../http/problem.js";
import { RedisService } from "../redis/redis.service.js";
import { SourcesService } from "../sources/sources.service.js";

/** Per client IP: a burst of 12, then one request every 10 s (every request, cached or not). */
export const IP_BUCKET: BucketSpec = { capacity: 12, refillPerSec: 1 / 10 };
/** All visitors together: cold fetches (a POWER cell nobody opened today), 60 per hour. */
export const COLD_BUCKET: BucketSpec = { capacity: 60, refillPerSec: 60 / 3600 };
/** Hard cap on cold fetches per UTC day; afterwards only cells already cached answer. */
export const DAILY_COLD_CAP = 500;

export interface PublicOutline {
  id: string;
  name: string;
  place: string;
  areaHa: number;
  centroid: { lon: number; lat: number };
  /** Same-origin URL of the outline (GeoJSON Feature). */
  geojsonUrl: string;
}

const ID = /^[a-z0-9][a-z0-9-]{0,60}$/;
const utcDay = () => new Date().toISOString().slice(0, 10);

/** Area-weighted centroid of the largest polygon's outer ring (planar; fields are small). */
function centroidOf(geometry: { type: string; coordinates: unknown }): { lon: number; lat: number } {
  const polys = (geometry.type === "Polygon" ? [geometry.coordinates] : geometry.coordinates) as number[][][][];
  let best = { area: -1, lon: 0, lat: 0 };
  for (const poly of polys) {
    const ring = poly[0]!;
    let a = 0;
    let cx = 0;
    let cy = 0;
    for (let i = 0; i < ring.length - 1; i++) {
      const [x0, y0] = ring[i]!;
      const [x1, y1] = ring[i + 1]!;
      const f = x0! * y1! - x1! * y0!;
      a += f;
      cx += (x0! + x1!) * f;
      cy += (y0! + y1!) * f;
    }
    if (a === 0) continue;
    if (Math.abs(a) > best.area) best = { area: Math.abs(a), lon: cx / (3 * a), lat: cy / (3 * a) };
  }
  const r = (n: number) => Math.round(n * 1e5) / 1e5;
  return { lon: r(best.lon), lat: r(best.lat) };
}

type Loaded = PublicOutline & { feature: unknown };

/**
 * The public page (S-10.14): climate for any point and the list of ready outlines. No session, so no workspace
 * table is touched here and every call is limited per IP, per hour (cold fetches) and per day.
 */
@Injectable()
export class PublicService {
  private readonly log = new Logger(PublicService.name);
  private outlines: Loaded[] | undefined;
  private readonly inflight = new Map<string, Promise<ClimateShift>>();
  private memoryDay = { day: "", count: 0 };

  constructor(
    private readonly climate: ClimateService,
    private readonly sources: SourcesService,
    private readonly limits: RateLimitService,
    private readonly redis: RedisService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  get enabled(): boolean {
    return this.env.PUBLIC_EXPLORE !== "0";
  }

  /** Counts one cold fetch in today's tally (Redis when available, else this process) and says whether it was allowed. */
  private async takeDaily(): Promise<boolean> {
    const day = utcDay();
    if (this.redis.available && this.redis.client) {
      try {
        const key = `public:cold:${day}`;
        const n = await this.redis.client.incr(key);
        if (n === 1) await this.redis.client.expire(key, 2 * 86400);
        return n <= DAILY_COLD_CAP;
      } catch {
        // fall through to the local counter
      }
    }
    if (this.memoryDay.day !== day) this.memoryDay = { day, count: 0 };
    this.memoryDay.count++;
    return this.memoryDay.count <= DAILY_COLD_CAP;
  }

  async climateShift(ip: string, lon: number, lat: number): Promise<ClimateShift> {
    if (!(await this.limits.take(`public:ip:${ip}`, IP_BUCKET)))
      throw new ProblemException(429, "rate-limited", "Too many requests from this network. Try again in a minute.");
    const cell = powerCell(lon, lat);
    const cellId = `${cell.lon},${cell.lat}`;
    // Visitors asking for the same cell at the same moment share one fetch and one token.
    const running = this.inflight.get(cellId);
    if (running) return this.logged(cellId, "shared", await running);

    const adapter = this.sources.adapter("power");
    const geom: FieldGeometry = { polygons: [], centroid: { lon, lat }, bbox: [lon, lat, lon, lat], country: null };
    const warm = adapter ? !!(await this.sources.cached(this.sources.key(adapter, geom, utcDay()))) : false;
    if (!warm) {
      if (!(await this.takeDaily()))
        throw new ProblemException(
          429,
          "daily-cap",
          "The daily limit of new places has been reached. Places already opened today still work; try again tomorrow.",
        );
      if (!(await this.limits.take("public:cold", COLD_BUCKET)))
        throw new ProblemException(
          429,
          "rate-limited",
          "Too many new places are being opened right now. Try again in a minute.",
        );
    }
    const job = this.climate.forPoint(lon, lat);
    this.inflight.set(cellId, job);
    try {
      return this.logged(cellId, warm ? "warm" : "cold", await job);
    } finally {
      this.inflight.delete(cellId);
    }
  }

  /** Logs the grid cell and the outcome only; never the clicked coordinates or the IP. */
  private logged(cell: string, how: string, shift: ClimateShift): ClimateShift {
    this.log.log(`climate cell ${cell} ${how} ${shift.status}${shift.reason ? ` (${shift.reason})` : ""}`);
    return shift;
  }

  private load(): Loaded[] {
    if (this.outlines) return this.outlines;
    const dir = join(this.env.DATA_DIR, "public-outlines");
    const list: Loaded[] = [];
    let files: string[] = [];
    try {
      files = readdirSync(dir)
        .filter((f) => f.endsWith(".geojson"))
        .sort();
    } catch {
      this.log.warn("data/public-outlines missing: no ready outlines");
    }
    for (const f of files) {
      const id = f.replace(/\.geojson$/, "");
      if (!ID.test(id)) continue;
      try {
        const feature = JSON.parse(readFileSync(join(dir, f), "utf8")) as {
          properties: { name: string; county?: string; state?: string; area_ha: number };
          geometry: { type: string; coordinates: unknown };
        };
        const p = feature.properties;
        list.push({
          id,
          name: p.name,
          place: [p.county, p.state, "USA"].filter(Boolean).join(", "),
          areaHa: p.area_ha,
          centroid: centroidOf(feature.geometry),
          geojsonUrl: `/api/public/outlines/${id}`,
          // Only id, name and area travel with the geometry.
          feature: {
            type: "Feature",
            properties: { id, name: p.name, areaHa: p.area_ha },
            geometry: feature.geometry,
          },
        });
      } catch (e) {
        this.log.warn(`outline ${f}: ${(e as Error).message}`);
      }
    }
    this.outlines = list;
    return list;
  }

  listOutlines(): PublicOutline[] {
    return this.load().map(({ feature: _feature, ...o }) => o);
  }

  outline(id: string): unknown {
    const hit = ID.test(id) ? this.load().find((o) => o.id === id) : undefined;
    if (!hit) throw new ProblemException(404, "not-found");
    return hit.feature;
  }
}
