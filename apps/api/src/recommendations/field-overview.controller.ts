import { Controller, Get, Param, Req, UseGuards } from "@nestjs/common";
import { AuthGuard, Requires, UUID, WorkspaceGuard, type AuthedRequest } from "../auth/current-user.js";
import { ForecastService } from "../analysis/forecast.service.js";
import { localDate } from "../analysis/scheduler.js";
import { PrismaService } from "../db/prisma.service.js";
import { GeoService } from "../geo/geo.service.js";
import { ProblemException } from "../http/problem.js";
import { RecommendationsService } from "./recommendations.service.js";

function uuid(id: string): string {
  if (!UUID.test(id)) throw new ProblemException(404, "not-found");
  return id;
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
