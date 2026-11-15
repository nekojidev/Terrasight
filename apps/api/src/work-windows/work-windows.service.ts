import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Inject, Injectable } from "@nestjs/common";
import {
  computeWorkWindows,
  localDay,
  unverifiedThresholds,
  type OperationWindows,
  type WorkWindowsConfig,
} from "@terrasight/evaluators";
import { forecastCell, localHour, type HourlyForecast } from "@terrasight/sources";
import type { Library } from "@terrasight/library";
import { ForecastService } from "../analysis/forecast.service.js";
import { ENV, type Env } from "../config/config.js";
import { PrismaService } from "../db/prisma.service.js";
import { LIBRARY } from "../library/library.module.js";
import { ProblemException } from "../http/problem.js";
import { SeasonsService } from "../seasons/seasons.service.js";

interface FieldRow {
  id: string;
  name: string;
  alias_no: number;
  lat: number;
  lon: number;
  country: string | null;
}

export interface FieldWorkWindows {
  fieldId: string;
  name: string;
  /** ISO country of the field: screens show units by it. */
  country: string | null;
  /** The crop the sowing windows are for (plan for the coming season, else the latest crop). */
  sowingCrop: string | null;
  /** false = no hourly forecast could be fetched or read from cache. */
  available: boolean;
  forecast: { origin: "live" | "cache" | "stale"; ageHours: number; attribution: string } | null;
  /** Local date and hour of the field's forecast cell the windows start from. */
  now: string | null;
  operations: OperationWindows[];
}

export interface WorkWindowsView {
  days: number;
  /** true while any threshold in data/work-windows.json has `verified: false`: the UI labels the windows. */
  thresholdsUnverified: boolean;
  thresholdsVersion: number;
  /** Names of the sowing crops in use, for labels. */
  cropNames: Record<string, { en: string; uk: string }>;
  fields: FieldWorkWindows[];
}

/** The harvest year a sowing decision belongs to: from September on, the next calendar year (spring crops). */
export function sowingSeason(today: string): number {
  const y = Number(today.slice(0, 4));
  return Number(today.slice(5, 7)) >= 9 ? y + 1 : y;
}

/** Work windows per field from the cached hourly forecast (RFC §13 cells shared by fields). */
@Injectable()
export class WorkWindowsService {
  private readonly cfg: WorkWindowsConfig;

  constructor(
    private readonly prisma: PrismaService,
    private readonly forecasts: ForecastService,
    private readonly seasons: SeasonsService,
    @Inject(ENV) env: Env,
    @Inject(LIBRARY) private readonly lib: Library,
  ) {
    this.cfg = JSON.parse(readFileSync(join(env.DATA_DIR, "work-windows.json"), "utf8")) as WorkWindowsConfig;
  }

  async forWorkspace(workspaceId: string, days: number, now = new Date()): Promise<WorkWindowsView> {
    const fields = await this.fieldRows(workspaceId);
    return this.build(workspaceId, fields, days, now);
  }

  async forField(workspaceId: string, fieldId: string, days: number, now = new Date()): Promise<WorkWindowsView> {
    const fields = (await this.fieldRows(workspaceId)).filter((f) => f.id === fieldId);
    if (!fields.length) throw new ProblemException(404, "not-found");
    return this.build(workspaceId, fields, days, now);
  }

  private fieldRows(workspaceId: string) {
    return this.prisma.system.$queryRaw<FieldRow[]>`
      SELECT id, name, alias_no, ST_Y(centroid) AS lat, ST_X(centroid) AS lon, country
      FROM fields WHERE workspace_id = ${workspaceId}::uuid AND archived_at IS NULL ORDER BY alias_no`;
  }

  private async build(workspaceId: string, fields: FieldRow[], days: number, now: Date): Promise<WorkWindowsView> {
    const ws = await this.prisma.system.workspace.findUnique({
      where: { id: workspaceId },
      select: { timeZone: true },
    });
    if (!ws) throw new ProblemException(404, "not-found");
    const today = localDay(now, ws.timeZone);
    const season = sowingSeason(today);

    // One request per forecast cell.
    const cells = new Map<string, { lat: number; lon: number }>();
    for (const f of fields) cells.set(forecastCell(f.lat, f.lon).key, { lat: f.lat, lon: f.lon });
    const hourly = new Map(
      await Promise.all(
        [...cells.entries()].map(async ([key, c]) => [key, await this.forecasts.getHourly(c.lat, c.lon, today)] as const),
      ),
    );

    const out: FieldWorkWindows[] = [];
    for (const f of fields) {
      const crop = await this.sowingCrop(f.id, season);
      const h = hourly.get(forecastCell(f.lat, f.lon).key) ?? null;
      out.push(this.field(f, crop, h, days, now));
    }
    const cropNames: WorkWindowsView["cropNames"] = {};
    for (const f of out) {
      const c = f.sowingCrop ? this.lib.rotations.crops[f.sowingCrop] : undefined;
      if (f.sowingCrop && c) cropNames[f.sowingCrop] = { en: c.en, uk: c.uk };
    }
    return {
      days,
      cropNames,
      thresholdsUnverified: unverifiedThresholds(this.cfg),
      thresholdsVersion: this.cfg.version,
      fields: out,
    };
  }

  private field(
    f: FieldRow,
    crop: string | null,
    h: { forecast: HourlyForecast; origin: "live" | "cache" | "stale"; ageHours: number } | null,
    days: number,
    now: Date,
  ): FieldWorkWindows {
    if (!h) {
      return {
        fieldId: f.id,
        name: f.name,
        country: f.country,
        sowingCrop: crop,
        available: false,
        forecast: null,
        now: null,
        operations: [],
      };
    }
    const local = localHour(now, h.forecast.utcOffsetSeconds);
    const result = computeWorkWindows(h.forecast.hours, this.cfg, local, { days, sowingCrop: crop });
    return {
      fieldId: f.id,
      name: f.name,
      country: f.country,
      sowingCrop: crop,
      available: true,
      forecast: { origin: h.origin, ageHours: h.ageHours, attribution: h.forecast.attribution },
      now: local,
      operations: result.operations,
    };
  }

  private async sowingCrop(fieldId: string, season: number): Promise<string | null> {
    const plan = await this.seasons.planFor(fieldId, season);
    if (plan?.crop) return plan.crop;
    const last = await this.prisma.system.cropSeason.findFirst({
      where: { fieldId },
      orderBy: { season: "desc" },
      select: { mainCrop: true },
    });
    return last?.mainCrop ?? null;
  }
}
