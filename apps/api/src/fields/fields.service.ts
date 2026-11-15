import { Inject, Injectable, Logger, Optional } from "@nestjs/common";
import { ModuleRef } from "@nestjs/core";
import { fetchLatestLandCover, type SoilSummary } from "@terrasight/sources";
import { ENV, type Env } from "../config/config.js";
import { EventKeys } from "@terrasight/shared";
import { PrismaService } from "../db/prisma.service.js";
import { Prisma } from "../generated/prisma/client.js";
import type { Irrigation } from "../generated/prisma/enums.js";
import { GeoService, type GeoJsonPolygonal } from "../geo/geo.service.js";
import { thumbPath } from "../geo/thumb.js";
import { ProblemException } from "../http/problem.js";
import { OutboxService } from "../messaging/outbox.service.js";
import { eventRow, jobRow } from "../messaging/outbox.js";
import { QUEUES } from "../messaging/topology.js";
import { SourcesService } from "../sources/sources.service.js";
import { loadSuitabilityConfig, previewSuitability, suitabilityView } from "../suitability/suitability.js";

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

/** Time budget of the preview's quick land check. */
const PREVIEW_CHECK_MS = 12_000;

@Injectable()
export class FieldsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly geo: GeoService,
    private readonly sources: SourcesService,
    private readonly outbox: OutboxService,
    @Inject(ENV) private readonly env: Env,
    @Optional() private readonly moduleRef?: ModuleRef,
  ) {}

  /**
   * The add-field preview's quick land check (land suitability): US = the SSURGO land capability class, elsewhere the
   * latest season of the 10 m land cover. A few seconds at most; any failure just means "unknown", never an error.
   */
  private async quickSuitability(field: {
    polygons: number[][][][];
    centroid: { lon: number; lat: number };
    bbox: [number, number, number, number];
    country: string | null;
  }) {
    try {
      const ctx = () => ({
        signal: AbortSignal.timeout(PREVIEW_CHECK_MS),
        fetch,
        today: new Date().toISOString().slice(0, 10),
      });
      const cfg = loadSuitabilityConfig(this.env.DATA_DIR);
      if (field.country === "US") {
        const ssurgo = this.sources.adapter("ssurgo");
        const r = ssurgo ? await ssurgo.fetch(field, ctx()) : null;
        return previewSuitability({ ssurgo: (r?.payload as SoilSummary | null) ?? null }, cfg);
      }
      if (field.country === null) return previewSuitability({}, cfg);
      return previewSuitability({ landCover: await fetchLatestLandCover(field, ctx()) }, cfg);
    } catch (e) {
      new Logger(FieldsService.name).warn(`preview land check skipped: ${(e as Error).message}`);
      return null;
    }
  }

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
      /** Quick land suitability (null = could not be checked): the user is warned before saving. */
      suitability: await this.quickSuitability(field),
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

  /**
   * Active fields by alias number. Without `limit` the whole list is returned as an array (unchanged shape); with
   * `limit` (and optional `cursor` = last aliasNo) one page comes back as `{ items, nextCursor }`.
   */
  async list(workspaceId: string, page?: { limit?: number; cursor?: string | null }) {
    const paged = page?.limit !== undefined;
    const limit = paged ? Math.min(Math.max(Math.trunc(page!.limit!), 1), 500) : null;
    const after = page?.cursor ? Number(page.cursor) : null;
    if (after !== null && !Number.isInteger(after)) throw new ProblemException(422, "invalid-input", "Bad cursor");
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
        suitability_status: string | null;
        suitability_overridden: boolean;
      }>
    >`
      SELECT f.id, f.name, f.alias_no, f.area_ha, f.county_name, f.country, f.admin_code, f.region_id, f.tier, f.irrigation,
             ST_X(f.centroid) AS lon, ST_Y(f.centroid) AS lat,
             (SELECT status FROM gather_jobs g WHERE g.field_id = f.id ORDER BY started_at DESC LIMIT 1) AS gather_status,
             f.suitability->>'status' AS suitability_status, (f.suitability_override IS NOT NULL) AS suitability_overridden
      FROM fields f WHERE f.workspace_id = ${workspaceId}::uuid AND f.archived_at IS NULL
        AND (${after}::int IS NULL OR f.alias_no > ${after}::int)
      ORDER BY f.alias_no LIMIT ${limit === null ? null : limit + 1}::int`;
    const hasMore = limit !== null && rows.length > limit;
    const items = (limit === null ? rows : rows.slice(0, limit)).map((r) => ({
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
      suitabilityStatus: r.suitability_status,
      suitabilityOverridden: r.suitability_overridden,
    }));
    if (!paged) return items;
    return { items, nextCursor: hasMore ? String(items.at(-1)!.aliasNo) : null };
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
        suitability: unknown;
        suitability_override: unknown;
        lon: number;
        lat: number;
        created_at: Date;
      }>
    >`
      SELECT id, name, alias_no, area_ha, county_name, country, admin_code, region_id, tier, irrigation, irrigation_source, slope_pct,
             ST_AsGeoJSON(geom, 7) AS geojson,
             thumb_geojson, suitability, suitability_override,
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
      suitability: suitabilityView(r.suitability, r.suitability_override),
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

  /**
   * "This is still cropland": an agronomist overrides an unsuitable verdict (stored with who and when). Everything
   * then works as on any other field; a field check starts so the first recommendations do not wait for 06:00.
   */
  async overrideSuitability(workspaceId: string, userId: string, fieldId: string) {
    await this.assertField(workspaceId, fieldId);
    const user = await this.prisma.system.user.findUnique({
      where: { id: userId },
      select: { name: true, email: true },
    });
    const override = { userId, userName: user?.name ?? user?.email ?? null, at: new Date().toISOString() };
    await this.prisma.db.field.updateMany({
      where: { id: fieldId, workspaceId },
      data: { suitabilityOverride: override },
    });
    await this.prisma.db.auditLog.create({
      data: { workspaceId, userId, action: "field.suitability_override", target: fieldId },
    });
    await this.recheck(workspaceId, fieldId);
    return this.get(workspaceId, fieldId);
  }

  async clearSuitabilityOverride(workspaceId: string, userId: string, fieldId: string) {
    await this.assertField(workspaceId, fieldId);
    await this.prisma.db.field.updateMany({
      where: { id: fieldId, workspaceId },
      data: { suitabilityOverride: Prisma.DbNull },
    });
    await this.prisma.db.auditLog.create({
      data: { workspaceId, userId, action: "field.suitability_override_clear", target: fieldId },
    });
    await this.recheck(workspaceId, fieldId);
    return this.get(workspaceId, fieldId);
  }

  private async recheck(workspaceId: string, fieldId: string): Promise<void> {
    try {
      const { AnalysisService } = await import("../analysis/analysis.service.js");
      const { localDate } = await import("../analysis/scheduler.js");
      const analysis = this.moduleRef?.get(AnalysisService, { strict: false });
      if (!analysis) return;
      const ws = await this.prisma.system.workspace.findUniqueOrThrow({
        where: { id: workspaceId },
        select: { timeZone: true },
      });
      await analysis.start(workspaceId, "manual", null, localDate(ws.timeZone), [fieldId]);
    } catch (e) {
      new Logger(FieldsService.name).warn(
        `check after suitability change for ${fieldId} skipped: ${(e as Error).message}`,
      );
    }
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

  /** Archived fields of the company, for the Owner's "Restore" list in settings. */
  async listArchived(workspaceId: string) {
    const rows = await this.prisma.db.field.findMany({
      where: { workspaceId, archivedAt: { not: null } },
      select: { id: true, name: true, aliasNo: true, areaHa: true, countyName: true, archivedAt: true },
      orderBy: { archivedAt: "desc" },
    });
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      aliasNo: r.aliasNo,
      areaHa: r.areaHa,
      countyName: r.countyName,
      archivedAt: r.archivedAt,
    }));
  }

  async restore(workspaceId: string, userId: string, fieldId: string): Promise<void> {
    const r = await this.prisma.db.field.updateMany({
      where: { id: fieldId, workspaceId, archivedAt: { not: null } },
      data: { archivedAt: null },
    });
    if (r.count !== 1) throw new ProblemException(404, "not-found");
    await this.prisma.db.auditLog.create({
      data: { workspaceId, userId, action: "field.restore", target: fieldId },
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
