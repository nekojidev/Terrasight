import { randomUUID } from "node:crypto";
import { Inject, Injectable, Logger } from "@nestjs/common";
import {
  bboxOf,
  buildZoneRaster,
  DEFAULT_PARAMS,
  encodePng,
  geometryHash,
  gridCorners,
  latestNdvi,
  makeFieldGrid,
  ndviImage,
  NDVI_STOPS,
  NotEnoughSeasons,
  S2_ATTRIBUTION,
  seasonPeak,
  zonePolygons,
  type FieldGrid,
  type FetchContext,
} from "@terrasight/sources";
import { ENV, type Env } from "../config/config.js";
import { PrismaService } from "../db/prisma.service.js";
import type { Prisma } from "../generated/prisma/client.js";
import { ProblemException } from "../http/problem.js";
import { BlobStore } from "../storage/blob-store.js";
import { jobRow } from "../messaging/outbox.js";
import { OutboxService } from "../messaging/outbox.service.js";
import { QUEUES } from "../messaging/topology.js";
import { geojsonFile } from "./export/geojson.js";
import { isoxmlZip, UnsupportedUnit } from "./export/isoxml.js";
import { shapefileZip } from "./export/shapefile.js";
import { slug, type ExportField, type ExportFile, type ExportZone, type RateInput, type ZoneName } from "./export/types.js";

/** First season of the history (PD FR-ZN-1: at least 5 seasons; 2019 is the first full Sentinel-2 L2A year everywhere we serve). */
export const FIRST_SEASON = 2019;
const STALE_RUN_MS = 20 * 60_000;
const NDVI_REFRESH_MS = 24 * 3600_000;

export interface BuildJob {
  fieldId: string;
  runId: string;
}

interface FieldRow {
  geojson: string;
  lon: number;
  lat: number;
  area_ha: number;
  name: string;
}

function f32ToBytes(a: Float32Array): Uint8Array<ArrayBuffer> {
  return new Uint8Array(a.buffer.slice(a.byteOffset, a.byteOffset + a.byteLength) as ArrayBuffer);
}
function bytesToF32(b: Uint8Array): Float32Array {
  return new Float32Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer);
}

/** Stable zones, latest NDVI and rate-map export (PD FR-ZN-1..3). Terrasight never suggests a rate. */
@Injectable()
export class ZonesService {
  private readonly log = new Logger(ZonesService.name);
  private readonly blobs: BlobStore;

  constructor(
    private readonly prisma: PrismaService,
    private readonly outbox: OutboxService,
    @Inject(ENV) private readonly env: Env,
  ) {
    this.blobs = new BlobStore(env);
  }

  private async assertField(workspaceId: string, fieldId: string): Promise<void> {
    const f = await this.prisma.db.field.findFirst({
      where: { id: fieldId, workspaceId, archivedAt: null },
      select: { id: true },
    });
    if (!f) throw new ProblemException(404, "not-found");
  }

  private async fieldRow(fieldId: string): Promise<FieldRow> {
    const rows = await this.prisma.system.$queryRaw<FieldRow[]>`
      SELECT ST_AsGeoJSON(geom, 7) AS geojson, ST_X(centroid) AS lon, ST_Y(centroid) AS lat, area_ha, name
      FROM fields WHERE id = ${fieldId}::uuid`;
    if (!rows[0]) throw new Error("field not found");
    return rows[0];
  }

  // ---------- API ----------

  /** Queues a build; an already queued or running build is returned as is. */
  async build(workspaceId: string, fieldId: string) {
    await this.assertField(workspaceId, fieldId);
    await this.prisma.system.$transaction(async (tx) => {
      const cur = await tx.fieldZoneBuild.findUnique({ where: { fieldId } });
      const active =
        cur &&
        (cur.status === "queued" || cur.status === "running") &&
        Date.now() - (cur.startedAt ?? cur.createdAt).getTime() < STALE_RUN_MS;
      if (active) return;
      const runId = randomUUID();
      const data = {
        runId,
        status: "queued",
        progress: { phase: "queued", done: 0, total: 0 } as Prisma.InputJsonValue,
        startedAt: new Date(),
        finishedAt: null,
        error: null,
      };
      await tx.fieldZoneBuild.upsert({ where: { fieldId }, create: { fieldId, ...data }, update: data });
      await this.outbox.add(tx, [jobRow(QUEUES.zonesBuild, workspaceId, { fieldId, runId } satisfies BuildJob)]);
    });
    return this.status(workspaceId, fieldId);
  }

  async status(workspaceId: string, fieldId: string) {
    await this.assertField(workspaceId, fieldId);
    const b = await this.prisma.system.fieldZoneBuild.findUnique({ where: { fieldId } });
    const stuck =
      b && (b.status === "queued" || b.status === "running") && Date.now() - (b.startedAt ?? b.createdAt).getTime() > STALE_RUN_MS;
    return {
      status: !b || b.status === "idle" ? "none" : stuck ? "failed" : b.status,
      progress: b?.progress ?? {},
      error: stuck ? "The build did not finish. Run it again." : (b?.error ?? null),
      builtAt: b?.status === "done" ? b.finishedAt : null,
    };
  }

  /** Zones as GeoJSON with stats, the seasons used and the build status. */
  async get(workspaceId: string, fieldId: string) {
    const status = await this.status(workspaceId, fieldId);
    const b = await this.prisma.system.fieldZoneBuild.findUnique({ where: { fieldId } });
    const rows = await this.prisma.system.$queryRaw<
      Array<{ zone: ZoneName; geojson: string; area_ha: number; share: number; mean: number | null }>
    >`SELECT zone, ST_AsGeoJSON(geom, 7) AS geojson, area_ha, share, mean_percentile AS mean
      FROM field_zones WHERE field_id = ${fieldId}::uuid`;
    const order: ZoneName[] = ["strong", "variable", "weak"];
    rows.sort((a, c) => order.indexOf(a.zone) - order.indexOf(c.zone));
    const seasons = (b?.seasons ?? []) as Array<{ season: number; used: boolean }>;
    return {
      ...status,
      seasons,
      seasonsUsed: seasons.filter((s) => s.used).length,
      fieldAreaHa: rows.reduce((s, r) => s + r.area_ha, 0),
      stats: rows.map((r) => ({
        zone: r.zone,
        areaHa: r.area_ha,
        share: r.share,
        meanPercentile: r.mean,
      })),
      geojson: rows.length
        ? {
            type: "FeatureCollection" as const,
            features: rows.map((r) => ({
              type: "Feature" as const,
              properties: { zone: r.zone, areaHa: r.area_ha, share: r.share },
              geometry: JSON.parse(r.geojson) as unknown,
            })),
          }
        : null,
      method: b?.params ?? null,
      attribution: S2_ATTRIBUTION,
    };
  }

  /** The most recent cloud-free Sentinel-2 NDVI image of the field; refreshed when older than a day. */
  async ndviLatest(workspaceId: string, fieldId: string) {
    await this.assertField(workspaceId, fieldId);
    let b = await this.prisma.system.fieldZoneBuild.findUnique({ where: { fieldId } });
    const running = b && (b.status === "queued" || b.status === "running");
    if (!running && (!b?.ndviCheckedAt || Date.now() - b.ndviCheckedAt.getTime() > NDVI_REFRESH_MS)) {
      try {
        await this.refreshNdvi(fieldId);
      } catch (e) {
        this.log.warn(`latest NDVI for ${fieldId}: ${(e as Error).message}`);
      }
      b = await this.prisma.system.fieldZoneBuild.findUnique({ where: { fieldId } });
    }
    const png = b?.ndviPng ?? (b?.ndviPngKey ? await this.blobs.get(b.ndviPngKey) : null);
    if (!b || !png || !b.ndviDate)
      return { available: false as const, reason: b?.ndviCheckedAt ? "no-clear-image" : "unavailable" };
    return {
      available: true as const,
      date: b.ndviDate.toISOString().slice(0, 10),
      sceneId: b.ndviSceneId,
      corners: b.ndviCorners,
      image: `data:image/png;base64,${Buffer.from(png).toString("base64")}`,
      stats: b.ndviStats,
      stops: NDVI_STOPS,
      attribution: S2_ATTRIBUTION,
    };
  }

  async export(
    workspaceId: string,
    fieldId: string,
    format: "shapefile" | "geojson" | "isoxml",
    input: RateInput,
  ): Promise<ExportFile> {
    await this.assertField(workspaceId, fieldId);
    const rows = await this.prisma.system.$queryRaw<
      Array<{ zone: ZoneName; geojson: string; area_ha: number; share: number }>
    >`SELECT zone, ST_AsGeoJSON(geom, 8) AS geojson, area_ha, share FROM field_zones WHERE field_id = ${fieldId}::uuid`;
    if (!rows.length) throw new ProblemException(409, "no-zones", "Build the zones first");
    const zones: ExportZone[] = rows.map((r) => ({
      zone: r.zone,
      areaHa: r.area_ha,
      share: r.share,
      coordinates: (JSON.parse(r.geojson) as { coordinates: number[][][][] }).coordinates,
    }));
    const f = await this.fieldRow(fieldId);
    const field: ExportField = {
      name: f.name,
      coordinates: (JSON.parse(f.geojson) as { coordinates: number[][][][] }).coordinates,
      areaHa: f.area_ha,
    };
    const base = `${slug(f.name)}-rate-zones`;
    if (format === "geojson") return geojsonFile(zones, input, f.name, base);
    if (format === "shapefile") return shapefileZip(zones, input, base);
    try {
      return isoxmlZip(field, zones, input, base);
    } catch (e) {
      if (e instanceof UnsupportedUnit)
        throw new ProblemException(422, "isoxml-unit", "ISOXML supports kg/ha and l/ha; use Shapefile for seeds/ha");
      throw e;
    }
  }

  // ---------- job ----------

  private ctx(): FetchContext {
    return { signal: AbortSignal.timeout(15 * 60_000), fetch, today: new Date().toISOString().slice(0, 10) };
  }

  private async progress(fieldId: string, runId: string, p: Record<string, unknown>): Promise<void> {
    await this.prisma.system.fieldZoneBuild.updateMany({
      where: { fieldId, runId },
      data: { status: "running", progress: p as Prisma.InputJsonValue },
    });
  }

  private async storeNdvi(fieldId: string, fg: FieldGrid, bbox: [number, number, number, number], ctx: FetchContext) {
    const latest = await latestNdvi(fg, bbox, ctx);
    const checked = { ndviCheckedAt: new Date() };
    if (!latest) {
      await this.prisma.system.fieldZoneBuild.update({
        where: { fieldId },
        data: { ...checked, ndviPng: null, ndviPngKey: null, ndviDate: null, ndviSceneId: null, ndviCorners: undefined },
      });
      return;
    }
    const { width, height } = fg.grid;
    const png = encodePng(width, height, ndviImage(latest.ndvi, fg.inside, width, height));
    let sum = 0;
    let n = 0;
    for (let i = 0; i < latest.ndvi.length; i++)
      if (fg.inside[i] && Number.isFinite(latest.ndvi[i]!)) {
        sum += latest.ndvi[i]!;
        n += 1;
      }
    // Object storage (or local disk) holds the image; the row keeps its key.
    const pngKey = `zones/ndvi/${fieldId}.png`;
    await this.blobs.put(pngKey, png, "image/png");
    await this.prisma.system.fieldZoneBuild.update({
      where: { fieldId },
      data: {
        ...checked,
        ndviPng: null,
        ndviPngKey: pngKey,
        ndviDate: new Date(`${latest.date}T00:00:00Z`),
        ndviSceneId: latest.sceneId,
        ndviCorners: gridCorners(fg.grid) as Prisma.InputJsonValue,
        ndviStats: { mean: n ? Math.round((sum / n) * 1000) / 1000 : null, clear: Math.round(latest.clear * 100) / 100 },
      },
    });
  }

  /** Latest NDVI only (cheap); creates the build row as `idle` when the field has none. */
  async refreshNdvi(fieldId: string): Promise<void> {
    const f = await this.fieldRow(fieldId);
    const polygons = (JSON.parse(f.geojson) as { coordinates: number[][][][] }).coordinates;
    const fg = makeFieldGrid(polygons, { lon: f.lon, lat: f.lat });
    await this.prisma.system.fieldZoneBuild.upsert({
      where: { fieldId },
      create: { fieldId, status: "idle" },
      update: {},
    });
    await this.storeNdvi(fieldId, fg, bboxOf(polygons), this.ctx());
  }

  /**
   * Replaces the field's zones: each polygon set is clipped to the field outline in PostGIS, so the zone areas add up
   * to the field area, and shares are computed from the clipped areas.
   */
  async saveZones(
    fieldId: string,
    polys: Partial<Record<ZoneName, number[][][][]>>,
    means: Record<ZoneName, number | null>,
  ): Promise<{ zones_ha: number | null; field_ha: number }> {
    return this.prisma.system.$transaction(async (tx) => {
      await tx.$executeRaw`DELETE FROM field_zones WHERE field_id = ${fieldId}::uuid`;
      for (const [zone, mp] of Object.entries(polys)) {
        const json = JSON.stringify({ type: "MultiPolygon", coordinates: mp });
        const mean = means[zone as ZoneName];
        await tx.$executeRaw`
          INSERT INTO field_zones (field_id, zone, geom, area_ha, share, mean_percentile)
          SELECT f.id, ${zone}, g.geom, ST_Area(g.geom::geography) / 10000, 0, ${mean}
          FROM fields f
          CROSS JOIN LATERAL (
            SELECT ST_Multi(ST_CollectionExtract(
              ST_MakeValid(ST_Intersection(f.geom, ST_MakeValid(ST_SetSRID(ST_GeomFromGeoJSON(${json}), 4326)))), 3)) AS geom
          ) g
          WHERE f.id = ${fieldId}::uuid AND NOT ST_IsEmpty(g.geom)`;
      }
      await tx.$executeRaw`
        UPDATE field_zones z SET share = z.area_ha / t.total
        FROM (SELECT SUM(area_ha) AS total FROM field_zones WHERE field_id = ${fieldId}::uuid) t
        WHERE z.field_id = ${fieldId}::uuid`;
      const sums = await tx.$queryRaw<Array<{ zones_ha: number | null; field_ha: number }>>`
        SELECT (SELECT SUM(area_ha) FROM field_zones WHERE field_id = ${fieldId}::uuid) AS zones_ha, area_ha AS field_ha
        FROM fields WHERE id = ${fieldId}::uuid`;
      return sums[0]!;
    });
  }

  /** The build job: season peaks (cached), classification, polygons clipped to the field, latest NDVI. */
  async run(job: BuildJob, attempt: number, retries: number): Promise<void> {
    const { fieldId, runId } = job;
    const b = await this.prisma.system.fieldZoneBuild.findUnique({ where: { fieldId } });
    if (!b || b.runId !== runId || b.status === "done") return; // superseded or already finished
    const fail = (error: string) =>
      this.prisma.system.fieldZoneBuild.updateMany({
        where: { fieldId, runId },
        data: { status: "failed", error, finishedAt: new Date() },
      });
    try {
      const f = await this.fieldRow(fieldId);
      const polygons = (JSON.parse(f.geojson) as { coordinates: number[][][][] }).coordinates;
      const bbox = bboxOf(polygons);
      const fg = makeFieldGrid(polygons, { lon: f.lon, lat: f.lat });
      const { grid } = fg;
      const hash = geometryHash(polygons);
      const ctx = this.ctx();
      const last = new Date().getUTCFullYear() - 1;
      const years = Array.from({ length: last - FIRST_SEASON + 1 }, (_, i) => FIRST_SEASON + i);
      const total = years.length + 2;
      const peaks: Array<{ season: number; values: Float32Array; scenes: number; listed: number }> = [];

      await this.progress(fieldId, runId, { phase: "ndvi", done: 0, total });
      await this.storeNdvi(fieldId, fg, bbox, ctx).catch((e: Error) => this.log.warn(`NDVI layer: ${e.message}`));

      for (const [i, season] of years.entries()) {
        await this.progress(fieldId, runId, { phase: "seasons", done: i + 1, total, season });
        const key = { geomHash_season_res: { geomHash: hash, season, res: grid.res } };
        const hit = await this.prisma.system.fieldZoneCache.findUnique({ where: key });
        const hitBytes = hit ? (hit.data ?? (hit.dataKey ? await this.blobs.get(hit.dataKey) : null)) : null;
        if (hit && hitBytes && hit.width === grid.width && hit.height === grid.height) {
          peaks.push({ season, values: bytesToF32(hitBytes), scenes: hit.scenes, listed: hit.listed });
          continue;
        }
        const p = await seasonPeak(fg, bbox, f.lat, season, ctx);
        const data = {
          epsg: grid.epsg,
          x0: grid.x0,
          y0: grid.y0,
          width: grid.width,
          height: grid.height,
          scenes: p.scenes,
          listed: p.listed,
          data: null,
          dataKey: `zones/cache/${hash}/${season}-${grid.res}.f32`,
        };
        await this.blobs.put(data.dataKey, f32ToBytes(p.peak));
        await this.prisma.system.fieldZoneCache.upsert({
          where: key,
          create: { geomHash: hash, season, res: grid.res, ...data },
          update: data,
        });
        peaks.push({ season, values: p.peak, scenes: p.scenes, listed: p.listed });
      }

      await this.progress(fieldId, runId, { phase: "classify", done: years.length + 1, total });
      const raster = buildZoneRaster({
        seasons: peaks.map((p) => ({ season: p.season, values: p.values })),
        inside: fg.inside,
        width: grid.width,
        height: grid.height,
      });
      const polys = zonePolygons(raster.cls, grid);

      const means = {
        strong: raster.stats.strong.meanPercentile,
        variable: raster.stats.variable.meanPercentile,
        weak: raster.stats.weak.meanPercentile,
      };
      const stats = await this.saveZones(fieldId, polys, means);

      await this.prisma.system.fieldZoneBuild.updateMany({
        where: { fieldId, runId },
        data: {
          status: "done",
          error: null,
          finishedAt: new Date(),
          progress: { phase: "done", done: total, total },
          seasons: raster.seasons.map((s) => {
            const p = peaks.find((x) => x.season === s.season)!;
            return {
              season: s.season,
              used: s.used,
              coverage: Math.round(s.coverage * 100) / 100,
              scenes: p.scenes,
              listed: p.listed,
            };
          }) as Prisma.InputJsonValue,
          stats: {
            resolutionM: grid.res,
            cells: fg.insideCount,
            zonesHa: stats.zones_ha,
            fieldHa: stats.field_ha,
          } as Prisma.InputJsonValue,
          params: { ...DEFAULT_PARAMS, source: "Sentinel-2 L2A (SCL mask), peak = 90th percentile of clear observations" } as unknown as Prisma.InputJsonValue,
        },
      });
      this.log.log(`zones for ${fieldId}: ${years.length} seasons, ${fg.insideCount} cells at ${grid.res} m`);
    } catch (e) {
      if (e instanceof NotEnoughSeasons) {
        await fail(`Not enough seasons with clear satellite images (${e.usable} of ${e.required} needed).`);
        return; // retrying would not help
      }
      if (attempt >= retries) await fail("Satellite images could not be read. Try again later.");
      throw e;
    }
  }
}
