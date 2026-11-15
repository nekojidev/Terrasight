import { Controller, Get, Inject, Param, Req, UseGuards } from "@nestjs/common";
import { AuthGuard, Requires, UUID, WorkspaceGuard, type AuthedRequest } from "../auth/current-user.js";
import type { Library } from "@terrasight/library";
import { cdlName } from "@terrasight/sources";
import { LIBRARY } from "../library/library.module.js";
import { ForecastService } from "../analysis/forecast.service.js";
import { localDate } from "../analysis/scheduler.js";
import { PrismaService } from "../db/prisma.service.js";
import { GeoService } from "../geo/geo.service.js";
import { thumbPath } from "../geo/thumb.js";
import { ProblemException } from "../http/problem.js";
import { BriefService } from "../brief/brief.service.js";
import { RecommendationsService } from "./recommendations.service.js";

function uuid(id: string): string {
  if (!UUID.test(id)) throw new ProblemException(404, "not-found");
  return id;
}

/** Fields page (design 07, S-04.08): counties with pins and weather, each field's next step, the states' outlines. */
@Controller("w/:ws/fields-overview")
@UseGuards(AuthGuard, WorkspaceGuard)
export class FieldsOverviewController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly brief: BriefService,
    @Inject(LIBRARY) private readonly lib: Library,
  ) {}

  /** Crop label: the library's name, the CDL class name for "other:N", else the id made readable. */
  private cropName(id: string | null): { en: string; uk: string } | null {
    if (!id) return null;
    const c = this.lib.rotations.crops[id];
    if (c) return { en: c.en, uk: c.uk };
    const m = /^other:(\d+)$/.exec(id);
    const n = m ? cdlName(Number(m[1])) : id.replace(/_/g, " ");
    return { en: n, uk: n };
  }

  @Get()
  @Requires("fields.read")
  async overview(@Req() req: AuthedRequest) {
    const ws = req.workspaceId!;
    const [b, fields] = await Promise.all([
      this.brief.get(ws),
      this.prisma.system.$queryRaw<
        Array<{
          id: string;
          name: string;
          area_ha: number;
          county_name: string | null;
          admin_code: string | null;
          irrigation: string;
          lon: number;
          lat: number;
          thumb_geojson: string | null;
        }>
      >`
        SELECT id, name, area_ha, county_name, admin_code, irrigation, ST_X(centroid) AS lon, ST_Y(centroid) AS lat,
          ST_AsGeoJSON(ST_SimplifyPreserveTopology(geom, GREATEST(ST_XMax(geom) - ST_XMin(geom), ST_YMax(geom) - ST_YMin(geom)) / 40), 6) AS thumb_geojson
        FROM fields WHERE workspace_id = ${ws}::uuid AND archived_at IS NULL ORDER BY alias_no`,
    ]);
    const codes = [...new Set(fields.map((r) => r.admin_code).filter((c): c is string => Boolean(c)))];
    const states = codes.length
      ? await this.prisma.system.$queryRaw<Array<{ code: string; name: string; geojson: string }>>`
          SELECT code, name, ST_AsGeoJSON(ST_SimplifyPreserveTopology(geom, 0.05), 3) AS geojson FROM admin_areas WHERE code = ANY(${codes})`
      : [];
    const areaName = new Map(states.map((x) => [x.code, x.name]));
    const crops = await this.prisma.system.cropSeason.findMany({
      where: { fieldId: { in: fields.map((f) => f.id) } },
      orderBy: { season: "desc" },
    });
    const items = [...(b.hero ? [b.hero] : []), ...b.urgent, ...b.thisWeek];
    const rank = { urgent: 0, this_week: 1, all_good: 2 } as const;
    const rows = fields.map((f) => {
      const item = items.find((i) => i.fieldId === f.id);
      const good = b.allGood.find((g) => g.fieldId === f.id);
      return {
        fieldId: f.id,
        name: f.name,
        areaHa: f.area_ha,
        irrigation: f.irrigation,
        lastCropId: crops.find((c) => c.fieldId === f.id)?.mainCrop ?? null,
        lastCrop: this.cropName(crops.find((c) => c.fieldId === f.id)?.mainCrop ?? null),
        urgency: (item?.urgency ?? "all_good") as keyof typeof rank,
        next: item
          ? { id: item.id, title: item.text.title, deadline: item.deadline, more: item.more }
          : good?.plan
            ? { id: good.plan.id, title: good.plan.title, deadline: good.plan.deadline, more: 0, plan: true }
            : null,
        // Weather is keyed by the raw county / code; the label falls back to the admin area (oblast) name where there are no counties (Ukraine).
        weatherKey: f.county_name ?? f.admin_code ?? "—",
        county: f.county_name ?? (f.admin_code ? areaName.get(f.admin_code) : null) ?? f.admin_code ?? "—",
        state: f.admin_code,
        lon: f.lon,
        lat: f.lat,
        thumb: thumbPath(f.thumb_geojson),
      };
    });
    const counties = new Map<string, typeof rows>();
    for (const r of rows)
      (
        counties.get(`${r.state}|${r.county}`) ??
        counties.set(`${r.state}|${r.county}`, []).get(`${r.state}|${r.county}`)!
      ).push(r);
    return {
      totalHa: rows.reduce((s, r) => s + r.areaHa, 0),
      counties: [...counties.values()].map((list) => {
        const w = b.rail.weather.find((x) => x.county === list[0]!.weatherKey && x.region === list[0]!.state);
        return {
          key: `${list[0]!.state}|${list[0]!.county}`,
          county: list[0]!.county,
          state: list[0]!.state,
          lon: list.reduce((s, r) => s + r.lon, 0) / list.length,
          lat: list.reduce((s, r) => s + r.lat, 0) / list.length,
          urgency: list.reduce<keyof typeof rank>(
            (u, r) => (rank[r.urgency] < rank[u] ? r.urgency : u),
            "all_good",
          ),
          areaHa: list.reduce((s, r) => s + r.areaHa, 0),
          weather: w?.today ?? null,
          fields: list.map(({ weatherKey: _w, ...r }) => r),
        };
      }),
      states: states.map((s) => ({ code: s.code, name: s.name, geometry: JSON.parse(s.geojson) as unknown })),
    };
  }
}

/** Field page, Overview tab (S-04.07): the field's live risks and its 7-day weather. */
@Controller("w/:ws/fields/:id")
@UseGuards(AuthGuard, WorkspaceGuard)
export class FieldOverviewController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly recs: RecommendationsService,
    private readonly forecasts: ForecastService,
    private readonly geo: GeoService,
  ) {}

  @Get("recommendations")
  @Requires("brief.read")
  async risks(@Param("id") id: string, @Req() req: AuthedRequest) {
    const rows = await this.prisma.db.recommendation.findMany({
      where: {
        workspaceId: req.workspaceId!,
        fieldId: uuid(id),
        status: { in: ["open", "accepted", "snoozed", "in_report"] },
      },
      include: { field: { select: { name: true, aliasNo: true } } },
      orderBy: [{ deadline: "asc" }],
    });
    const rank = { high: 0, moderate: 1, unknown: 2, low: 3, none: 4 } as const;
    return rows.map((r) => this.recs.view(r)).sort((a, b) => rank[a.level] - rank[b.level]);
  }

  /** Work log (design 11): the field's real events, newest first — checks, scouting, report, owner answers, plans. */
  @Get("log")
  @Requires("brief.read")
  async log(@Param("id") id: string, @Req() req: AuthedRequest) {
    const fieldId = uuid(id);
    const field = await this.prisma.db.field.findFirst({
      where: { id: fieldId, workspaceId: req.workspaceId!, archivedAt: null },
      select: { id: true },
    });
    if (!field) throw new ProblemException(404, "not-found");
    const [checks, scouting, items, plans] = await Promise.all([
      this.prisma.system.analysisRunField.findMany({
        where: { fieldId, status: { in: ["ok", "stale", "failed"] } },
        orderBy: { updatedAt: "desc" },
        take: 10,
        include: { run: { select: { trigger: true, requestedBy: true } } },
      }),
      this.prisma.system.scoutingTask.findMany({
        where: { fieldId, status: "sent" },
        orderBy: { sentAt: "desc" },
        take: 10,
        include: { recommendation: { select: { subject: true } } },
      }),
      this.prisma.system.reportItem.findMany({
        where: { recommendation: { fieldId } },
        orderBy: { committedAt: "desc" },
        take: 10,
        include: { answers: { orderBy: { createdAt: "desc" } } },
      }),
      this.prisma.system.plan.findMany({ where: { fieldId }, orderBy: { savedAt: "desc" }, take: 5 }),
    ]);
    const entries: Array<{ kind: string; at: Date; source: string; data: Record<string, unknown> }> = [
      // Routine checks with nothing new are noise: keep the latest one and those that found or failed something.
      ...checks
        .filter((c, i) => i === 0 || c.newRecommendations > 0 || c.status !== "ok")
        .map((c) => ({
          kind: "check",
          at: c.updatedAt,
          source: c.run.requestedBy ? "you" : "assistant",
          data: { status: c.status, newRecommendations: c.newRecommendations, error: c.error },
        })),
      ...scouting.map((t) => ({
        kind: "scouting",
        at: t.sentAt!,
        source: "you",
        data: { pest: t.recommendation.subject, pct: t.resultPct },
      })),
      ...items.map((i) => ({
        kind: "report",
        at: i.committedAt,
        source: "you",
        data: { title: (i.text as { title?: unknown }).title ?? null },
      })),
      ...items.flatMap((i) =>
        i.answers.map((a) => ({
          kind: "answer",
          at: a.createdAt,
          source: "owner",
          data: { answer: a.answer, text: a.text },
        })),
      ),
      ...plans.map((p) => ({
        kind: "plan",
        at: p.savedAt,
        source: "you",
        data: { season: p.season, crop: p.crop },
      })),
    ];
    return entries.sort((a, b) => b.at.getTime() - a.at.getTime()).slice(0, 12);
  }

  /** 7-day forecast for the field's cell (days 8–10 marked uncertain, RFC §13), through the forecast chain. */
  @Get("weather")
  @Requires("brief.read")
  async weather(@Param("id") id: string, @Req() req: AuthedRequest) {
    const field = await this.prisma.db.field.findFirst({
      where: { id: uuid(id), workspaceId: req.workspaceId!, archivedAt: null },
      select: { country: true, workspace: { select: { timeZone: true } } },
    });
    if (!field) throw new ProblemException(404, "not-found");
    const geom = await this.geo.fieldGeometry(id);
    const today = localDate(field.workspace.timeZone);
    const f = await this.forecasts.get(geom.centroid.lat, geom.centroid.lon, field.country, today);
    if (!f) return { days: [], origin: null, attribution: null, ageHours: null };
    return {
      days: f.forecast.days
        .filter((d) => d.origin === "forecast")
        .slice(0, 10)
        .map((d) => ({ ...d, uncertain: (d.forecastDay ?? 0) > 7 })),
      origin: f.origin,
      provider: f.forecast.provider,
      attribution: f.forecast.attribution,
      ageHours: f.ageHours,
    };
  }
}
