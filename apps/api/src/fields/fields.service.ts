import { Inject, Injectable } from "@nestjs/common";
import { ENV, type Env } from "../config/config.js";
import { EventKeys } from "@terrasight/shared";
import { PrismaService } from "../db/prisma.service.js";
import type { Irrigation } from "../generated/prisma/enums.js";
import { GeoService, type GeoJsonPolygonal } from "../geo/geo.service.js";
import { thumbPath } from "../geo/thumb.js";
import { ProblemException } from "../http/problem.js";
import { OutboxService } from "../messaging/outbox.service.js";
import { eventRow, jobRow } from "../messaging/outbox.js";
import { QUEUES } from "../messaging/topology.js";
import { SourcesService } from "../sources/sources.service.js";

export interface CreateFieldInput {
  name: string;
  geometry: GeoJsonPolygonal;
  irrigated: "yes" | "no" | "unknown";
}

const IRRIGATION: Record<CreateFieldInput["irrigated"], Irrigation> = {
  yes: "irrigated",
  no: "dryland",
  unknown: "unknown",
};

@Injectable()
export class FieldsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly geo: GeoService,
    private readonly sources: SourcesService,
    private readonly outbox: OutboxService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  /** Design 13 "what we'll find": area, county, region and tier before saving (S-02.01). */
  async preview(geometry: GeoJsonPolygonal) {
    const p = await this.geo.place(geometry);
    const field = { polygons: p.multipolygon, centroid: p.centroid, bbox: p.bbox, country: p.country };
    return {
      areaHa: p.areaHa,
      centroid: p.centroid,
      placeLabel: p.placeLabel,
      adminCode: p.adminCode,
      country: p.country,
      regionId: p.regionId,
      hasRotationLibrary: p.regionId !== null,
      tier: p.tier,
      sources: this.sources.applicable(field).map((a) => a.id),
    };
  }

  /** Field + gather job + one task per applicable source + their jobs, in one transaction (RFC §3, Tech Design §7). */
  async create(workspaceId: string, userId: string, input: CreateFieldInput) {
    const active = await this.prisma.db.field.count({ where: { workspaceId, archivedAt: null } });
    if (active >= this.env.MAX_FIELDS_PER_WORKSPACE)
      throw new ProblemException(
        409,
        "field-limit",
        `A company can have up to ${this.env.MAX_FIELDS_PER_WORKSPACE} active fields`,
      );
    const p = await this.geo.place(input.geometry);
    const fieldGeometry = {
      polygons: p.multipolygon,
      centroid: p.centroid,
      bbox: p.bbox,
      country: p.country,
    };
    const adapters = this.sources.applicable(fieldGeometry);
    const mp = JSON.stringify({ type: "MultiPolygon", coordinates: p.multipolygon });

    return this.prisma.system.$transaction(async (tx) => {
      const nextRows = await tx.$queryRaw<Array<{ next: number }>>`
        SELECT COALESCE(MAX(alias_no), 0) + 1 AS next FROM fields WHERE workspace_id = ${workspaceId}::uuid`;
      const next = Number(nextRows[0]!.next);
      const inserted = await tx.$queryRaw<Array<{ id: string }>>`
        INSERT INTO fields (id, workspace_id, name, alias_no, geom, centroid, area_ha, admin_code, country, county_name,
                            region_id, tier, irrigation, irrigation_source, created_by)
        VALUES (gen_random_uuid(), ${workspaceId}::uuid, ${input.name.trim()}, ${next},
                ST_SetSRID(ST_GeomFromGeoJSON(${mp}), 4326), ST_SetSRID(ST_MakePoint(${p.centroid.lon}, ${p.centroid.lat}), 4326),
                ${p.areaHa}, ${p.adminCode}, ${p.country}, ${p.countyName}, ${p.regionId}, ${p.tier}::"Tier",
                ${IRRIGATION[input.irrigated]}::"Irrigation",
                ${input.irrigated === "unknown" ? "unknown" : "confirmed"}::"ValueSource", ${userId}::uuid)
        RETURNING id`;
      const id = inserted[0]!.id;
      const job = await tx.gatherJob.create({
        data: { fieldId: id, status: "running", tasks: { create: adapters.map((a) => ({ source: a.id })) } },
      });
      await this.outbox.add(tx, [
        ...adapters.map((a) =>
          jobRow(QUEUES.gatherSource, workspaceId, { jobId: job.id, fieldId: id, source: a.id }),
        ),
        eventRow(EventKeys.brief(workspaceId), "field.created", workspaceId, { fieldId: id }),
      ]);
      await tx.auditLog.create({ data: { workspaceId, userId, action: "field.create", target: id } });
      return {
        id,
        aliasNo: next,
        gatherJobId: job.id,
        ...(await this.previewOf(
          p,
          adapters.map((a) => a.id),
        )),
      };
    });
  }

  private async previewOf(p: Awaited<ReturnType<GeoService["place"]>>, sources: string[]) {
    return { areaHa: p.areaHa, placeLabel: p.placeLabel, regionId: p.regionId, tier: p.tier, sources };
  }

  async list(workspaceId: string) {
    const rows = await this.prisma.system.$queryRaw<
      Array<{
        id: string;
        name: string;
        alias_no: number;
        area_ha: number;
        county_name: string | null;
        country: string | null;
        admin_code: string | null;
        region_id: string | null;
        tier: string;
        irrigation: string;
        lon: number;
        lat: number;
        gather_status: string | null;
      }>
    >`
      SELECT f.id, f.name, f.alias_no, f.area_ha, f.county_name, f.country, f.admin_code, f.region_id, f.tier, f.irrigation,
             ST_X(f.centroid) AS lon, ST_Y(f.centroid) AS lat,
             (SELECT status FROM gather_jobs g WHERE g.field_id = f.id ORDER BY started_at DESC LIMIT 1) AS gather_status
      FROM fields f WHERE f.workspace_id = ${workspaceId}::uuid AND f.archived_at IS NULL ORDER BY f.alias_no`;
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      aliasNo: r.alias_no,
      areaHa: r.area_ha,
      countyName: r.county_name,
      country: r.country,
      adminCode: r.admin_code,
      regionId: r.region_id,
      tier: r.tier,
      irrigation: r.irrigation,
      centroid: { lon: r.lon, lat: r.lat },
      gatherStatus: r.gather_status,
    }));
  }

  async get(workspaceId: string, fieldId: string) {
    const rows = await this.prisma.system.$queryRaw<
      Array<{
        id: string;
        name: string;
        alias_no: number;
        area_ha: number;
        county_name: string | null;
        country: string | null;
        admin_code: string | null;
        region_id: string | null;
        tier: string;
        irrigation: string;
        irrigation_source: string;
        slope_pct: number | null;
        geojson: string;
        thumb_geojson: string | null;
        lon: number;
        lat: number;
        created_at: Date;
      }>
    >`
      SELECT id, name, alias_no, area_ha, county_name, country, admin_code, region_id, tier, irrigation, irrigation_source, slope_pct,
             ST_AsGeoJSON(geom, 7) AS geojson,
             ST_AsGeoJSON(ST_SimplifyPreserveTopology(geom, GREATEST(ST_XMax(geom) - ST_XMin(geom), ST_YMax(geom) - ST_YMin(geom)) / 40), 6) AS thumb_geojson,
             ST_X(centroid) AS lon, ST_Y(centroid) AS lat, created_at
      FROM fields WHERE id = ${fieldId}::uuid AND workspace_id = ${workspaceId}::uuid AND archived_at IS NULL`;
    const r = rows[0];
    if (!r) throw new ProblemException(404, "not-found");
    return {
      id: r.id,
      name: r.name,
      aliasNo: r.alias_no,
      areaHa: r.area_ha,
      countyName: r.county_name,
      country: r.country,
      adminCode: r.admin_code,
      regionId: r.region_id,
      tier: r.tier,
      irrigation: r.irrigation,
      irrigationSource: r.irrigation_source,
      slopePct: r.slope_pct,
      geometry: JSON.parse(r.geojson) as unknown,
      thumb: thumbPath(r.thumb_geojson),
      centroid: { lon: r.lon, lat: r.lat },
      createdAt: r.created_at,
    };
  }

  async update(
    workspaceId: string,
    userId: string,
    fieldId: string,
    input: { name?: string; irrigation?: "irrigated" | "dryland" },
  ) {
    await this.assertField(workspaceId, fieldId);
    await this.prisma.db.field.updateMany({
      where: { id: fieldId, workspaceId },
      data: {
        ...(input.name ? { name: input.name.trim() } : {}),
        // An agronomist's answer always wins over detection (RFC §6.2).
        ...(input.irrigation ? { irrigation: input.irrigation, irrigationSource: "confirmed" } : {}),
      },
    });
    await this.prisma.db.auditLog.create({
      data: { workspaceId, userId, action: "field.update", target: fieldId },
    });
    return this.get(workspaceId, fieldId);
  }

  async archive(workspaceId: string, userId: string, fieldId: string): Promise<void> {
    await this.assertField(workspaceId, fieldId);
    await this.prisma.db.field.updateMany({
      where: { id: fieldId, workspaceId },
      data: { archivedAt: new Date() },
    });
    await this.prisma.db.auditLog.create({
      data: { workspaceId, userId, action: "field.archive", target: fieldId },
    });
  }

  async assertField(workspaceId: string, fieldId: string): Promise<void> {
    const f = await this.prisma.db.field.findFirst({
      where: { id: fieldId, workspaceId, archivedAt: null },
      select: { id: true },
    });
    if (!f) throw new ProblemException(404, "not-found");
  }
}
