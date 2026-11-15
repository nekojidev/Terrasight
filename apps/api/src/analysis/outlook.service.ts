import { Inject, Injectable, Logger } from "@nestjs/common";
import {
  forecastCell,
  mapLimit,
  openMeteoSeasonal,
  type DailyWeather,
  type SeasonalEnsemble,
} from "@terrasight/sources";
import { RateLimitService } from "../auth/rate-limit.js";
import { ENV, type Env } from "../config/config.js";
import { PrismaService } from "../db/prisma.service.js";
import { GeoService } from "../geo/geo.service.js";
import { ProblemException } from "../http/problem.js";
import { SourcesService } from "../sources/sources.service.js";
import type { Prisma } from "../generated/prisma/client.js";
import {
  computeOutlook,
  daysThrough,
  outlookMonths,
  summarise,
  type FieldOutlook,
  type OutlookSummary,
} from "./outlook.js";
import { localDate } from "./scheduler.js";

/** Seasonal ensembles refresh weekly (SEAS5 is issued monthly; Open-Meteo updates it as new runs arrive). */
const FRESH_MS = 7 * 86_400_000;
/** Per-field results are memoised briefly so the Home rail does not recompute every field on each load. */
const MEMO_MS = 3 * 3600_000;
const TIMEOUT_MS = 60_000;
const BUCKET = { capacity: 4, refillPerSec: 1 };
const POWER_BUCKET = { capacity: 8, refillPerSec: 2 };

export interface OutlookView {
  fieldId: string;
  name: string;
  /** null when the ensemble or the climatology is unavailable. */
  outlook: FieldOutlook | null;
  origin: "live" | "cache" | "stale" | null;
  /** Plain reason when `outlook` is null. */
  problem: string | null;
}

export interface OutlookCompany {
  summary: OutlookSummary;
  fields: Array<Pick<OutlookView, "fieldId" | "name" | "origin"> & { outlook: FieldOutlook | null }>;
  issuedAt: string | null;
  attribution: string | null;
}

/** Seasonal outlook per field: Open-Meteo/ECMWF ensemble against the field's NASA POWER 1991–2020 climatology. */
@Injectable()
export class OutlookService {
  private readonly log = new Logger(OutlookService.name);
  private readonly memo = new Map<string, { at: number; today: string; view: OutlookView }>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly limits: RateLimitService,
    @Inject(ENV) private readonly env: Env,
    private readonly sources: SourcesService,
    private readonly geo: GeoService,
  ) {}

  /** Ensemble for a 0.1° cell: fresh cache → live → last cached (stale) → null. */
  async ensemble(
    lat: number,
    lon: number,
    today: string,
    lastMonth: string,
  ): Promise<{ ensemble: SeasonalEnsemble; origin: "live" | "cache" | "stale" } | null> {
    const cell = forecastCell(lat, lon);
    const key = `seasonal:${cell.key}`;
    const row = await this.prisma.system.sourceCache.findUnique({ where: { key } });
    const cached = row?.payload as unknown as SeasonalEnsemble | undefined;
    const lastDay = `${lastMonth}-${String(new Date(Date.UTC(+lastMonth.slice(0, 4), +lastMonth.slice(5), 0)).getUTCDate()).padStart(2, "0")}`;
    const covers = (e?: SeasonalEnsemble) => !!e && e.dates[e.dates.length - 1]! >= lastDay;
    const age = row ? Date.now() - row.fetchedAt.getTime() : Infinity;
    if (cached && age < FRESH_MS && covers(cached)) return { ensemble: cached, origin: "cache" };
    try {
      while (!(await this.limits.take("source:seasonal", BUCKET))) await new Promise((r) => setTimeout(r, 300));
      const ensemble = await openMeteoSeasonal(
        cell,
        daysThrough(today, lastMonth),
        { signal: AbortSignal.timeout(TIMEOUT_MS), fetch, today },
        this.env.OPEN_METEO_API_KEY,
      );
      const data = {
        source: "seasonal",
        params: { cell: cell.key, provider: ensemble.provider } as Prisma.InputJsonValue,
        payload: ensemble as unknown as Prisma.InputJsonValue,
        dataDate: new Date(`${today}T00:00:00Z`),
        origin: "live",
        fetchedAt: new Date(),
        expiresAt: new Date(Date.now() + FRESH_MS),
      };
      await this.prisma.system.sourceCache.upsert({ where: { key }, create: { key, ...data }, update: data });
      return { ensemble, origin: "live" };
    } catch (e) {
      this.log.warn(`seasonal ${cell.key}: ${(e as Error).message}`);
    }
    return cached && covers(cached) ? { ensemble: cached, origin: "stale" } : null;
  }

  async forField(workspaceId: string, fieldId: string): Promise<OutlookView> {
    const field = await this.prisma.db.field.findFirst({
      where: { id: fieldId, workspaceId, archivedAt: null },
      select: { id: true, name: true, workspace: { select: { timeZone: true } } },
    });
    if (!field) throw new ProblemException(404, "not-found");
    return this.build(field.id, field.name, localDate(field.workspace.timeZone));
  }

  async forCompany(workspaceId: string): Promise<OutlookCompany> {
    const ws = await this.prisma.system.workspace.findUniqueOrThrow({
      where: { id: workspaceId },
      select: { timeZone: true },
    });
    const today = localDate(ws.timeZone);
    const fields = await this.prisma.db.field.findMany({
      where: { workspaceId, archivedAt: null },
      select: { id: true, name: true },
      orderBy: { aliasNo: "asc" },
    });
    const views = await mapLimit(fields, 3, (f) => this.build(f.id, f.name, today));
    const first = views.find((v) => v.outlook);
    return {
      summary: summarise(views.map((v) => v.outlook)),
      fields: views.map((v) => ({ fieldId: v.fieldId, name: v.name, origin: v.origin, outlook: v.outlook })),
      issuedAt: first?.outlook?.issuedAt ?? null,
      attribution: first?.outlook?.attribution ?? null,
    };
  }

  private async build(fieldId: string, name: string, today: string): Promise<OutlookView> {
    const hit = this.memo.get(fieldId);
    if (hit && hit.today === today && Date.now() - hit.at < MEMO_MS) return hit.view;
    const view = await this.compute(fieldId, name, today);
    if (view.outlook) this.memo.set(fieldId, { at: Date.now(), today, view });
    return view;
  }

  private async compute(fieldId: string, name: string, today: string): Promise<OutlookView> {
    const fail = (problem: string): OutlookView => ({ fieldId, name, outlook: null, origin: null, problem });
    try {
      const geom = await this.geo.fieldGeometry(fieldId);
      const months = outlookMonths(today, 3);
      const [power, ens] = await Promise.all([
        this.sources.fresh<DailyWeather>("power", geom, today, async () => {
          while (!(await this.limits.take("source:power", POWER_BUCKET)))
            await new Promise((r) => setTimeout(r, 250));
        }),
        this.ensemble(geom.centroid.lat, geom.centroid.lon, today, months[months.length - 1]!),
      ]);
      if (!ens) return fail("Seasonal forecast unavailable");
      const weather = power?.result.payload;
      if (!weather) return fail("NASA POWER climatology unavailable");
      const outlook = computeOutlook(ens.ensemble, weather, months);
      if (!outlook) return fail("Not enough climatology to compare");
      return { fieldId, name, outlook, origin: ens.origin, problem: null };
    } catch (e) {
      this.log.warn(`outlook ${fieldId}: ${(e as Error).message}`);
      return fail("Outlook unavailable");
    }
  }
}
