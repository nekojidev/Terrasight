import { Controller, Get, Module, Req, Res, UseGuards, Injectable } from "@nestjs/common";
import type { Response } from "express";
import { AuthGuard, Requires, WorkspaceGuard, type AuthedRequest } from "../auth/current-user.js";
import { PrismaService } from "../db/prisma.service.js";

/** Owner's data export (JSON): fields as GeoJSON, season records, plans, recommendations, decisions. */
@Injectable()
export class ExportService {
  constructor(private readonly prisma: PrismaService) {}

  async build(workspaceId: string, userId: string) {
    const db = this.prisma.system;
    const workspace = await db.workspace.findUnique({
      where: { id: workspaceId },
      select: { id: true, name: true, timeZone: true, units: true, reportLanguage: true, createdAt: true },
    });
    const rows = await db.$queryRaw<
      Array<{
        id: string;
        name: string;
        alias_no: number;
        area_ha: number;
        country: string | null;
        county_name: string | null;
        tier: string;
        irrigation: string;
        created_at: Date;
        archived_at: Date | null;
        geojson: string;
      }>
    >`SELECT id, name, alias_no, area_ha, country, county_name, tier, irrigation, created_at, archived_at,
             ST_AsGeoJSON(geom, 7) AS geojson
      FROM fields WHERE workspace_id = ${workspaceId}::uuid ORDER BY alias_no`;
    const fieldIds = rows.map((r) => r.id);
    const [seasonRecords, plans, recommendations, decisions] = await Promise.all([
      db.seasonRecord.findMany({ where: { fieldId: { in: fieldIds } }, orderBy: [{ fieldId: "asc" }, { season: "asc" }] }),
      db.plan.findMany({ where: { fieldId: { in: fieldIds } }, orderBy: [{ fieldId: "asc" }, { season: "asc" }] }),
      db.recommendation.findMany({
        where: { workspaceId },
        orderBy: { createdAt: "asc" },
        include: { outcomes: true },
        omit: { inputSnapshotId: true },
      }),
      db.reportItem.findMany({
        where: { workspaceId },
        orderBy: { committedAt: "asc" },
        include: { answers: true, replies: true },
      }),
    ]);
    await this.prisma.db.auditLog.create({ data: { workspaceId, userId, action: "workspace.export" } });
    return {
      exportedAt: new Date().toISOString(),
      workspace,
      fields: {
        type: "FeatureCollection",
        features: rows.map((r) => ({
          type: "Feature",
          id: r.id,
          geometry: JSON.parse(r.geojson) as unknown,
          properties: {
            name: r.name,
            aliasNo: r.alias_no,
            areaHa: r.area_ha,
            country: r.country,
            county: r.county_name,
            tier: r.tier,
            irrigation: r.irrigation,
            createdAt: r.created_at,
            archivedAt: r.archived_at,
          },
        })),
      },
      seasonRecords,
      plans,
      recommendations,
      decisions,
    };
  }
}

@Controller("w/:ws/export")
@UseGuards(AuthGuard, WorkspaceGuard)
export class ExportController {
  constructor(private readonly exporter: ExportService) {}

  @Get()
  @Requires("workspace.settings")
  async export(@Req() req: AuthedRequest, @Res({ passthrough: true }) res: Response) {
    const data = await this.exporter.build(req.workspaceId!, req.user!.id);
    const day = new Date().toISOString().slice(0, 10);
    res.setHeader("Content-Disposition", `attachment; filename="terrasight-export-${day}.json"`);
    return data;
  }
}

@Module({ controllers: [ExportController], providers: [ExportService] })
export class ExportModule {}
