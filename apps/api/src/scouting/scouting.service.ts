import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { createReadStream, createWriteStream, mkdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { pipeline } from "node:stream/promises";
import type { Readable } from "node:stream";
import { GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { Inject, Injectable, Logger } from "@nestjs/common";
import type { Library } from "@terrasight/library";
import { EventKeys } from "@terrasight/shared";
import { AnalysisService } from "../analysis/analysis.service.js";
import { localDate } from "../analysis/scheduler.js";
import { ENV, type Env } from "../config/config.js";
import { PrismaService } from "../db/prisma.service.js";
import type { Prisma } from "../generated/prisma/client.js";
import { ProblemException } from "../http/problem.js";
import { LIBRARY } from "../library/library.module.js";
import { eventRow } from "../messaging/outbox.js";
import { OutboxService } from "../messaging/outbox.service.js";

/** W-route fractions on the inset polygon's oriented bounding rectangle (Tech Design §11). */
export const W_POINTS: Array<[number, number]> = [
  [0.1, 0.9],
  [0.3, 0.1],
  [0.5, 0.9],
  [0.7, 0.1],
  [0.9, 0.9],
];
export const PLANTS_PER_POINT = 20;
const PHOTO_TYPES = new Set(["image/jpeg", "image/png", "image/heic"]);
const PHOTO_MAX_BYTES = 10 * 1024 * 1024;
const URL_TTL_S = 600;

/** Scouting tasks (RFC §10.7, Tech Design §11): W-route, photos, send, result as evidence. */
@Injectable()
export class ScoutingService {
  private readonly log = new Logger(ScoutingService.name);
  private readonly s3: S3Client | null;

  constructor(
    @Inject(ENV) private readonly env: Env,
    @Inject(LIBRARY) private readonly lib: Library,
    private readonly prisma: PrismaService,
    private readonly outbox: OutboxService,
    private readonly analysis: AnalysisService,
  ) {
    this.s3 = env.S3_BUCKET ? new S3Client({ region: env.AWS_REGION }) : null;
  }

  /**
   * Five points on a W inside the field, avoiding the edge: inset = min(30 m, 10 % of the oriented bounding
   * rectangle's shorter side); points outside the inset polygon move to its closest point. Deterministic.
   */
  async route(fieldId: string, maxInsetM = 30): Promise<Array<{ lon: number; lat: number }>> {
    const rows = await this.prisma.system.$queryRaw<Array<{ idx: number; lon: number; lat: number }>>`
      WITH f AS (SELECT geom FROM fields WHERE id = ${fieldId}::uuid),
      r AS (SELECT ST_OrientedEnvelope(geom) AS env FROM f),
      sides AS (
        SELECT ST_Distance(ST_PointN(ST_ExteriorRing(env), 1)::geography, ST_PointN(ST_ExteriorRing(env), 2)::geography) AS a,
               ST_Distance(ST_PointN(ST_ExteriorRing(env), 2)::geography, ST_PointN(ST_ExteriorRing(env), 3)::geography) AS b
        FROM r),
      inset AS (
        SELECT COALESCE(NULLIF(ST_Buffer(f.geom::geography, -LEAST(${maxInsetM}::float8, 0.1 * LEAST(sides.a, sides.b)))::geometry, 'POLYGON EMPTY'::geometry), f.geom) AS g
        FROM f, sides),
      ienv AS (SELECT g, ST_ExteriorRing(ST_OrientedEnvelope(g)) AS ring FROM inset),
      corners AS (SELECT g, ST_PointN(ring, 1) AS p0, ST_PointN(ring, 2) AS p1, ST_PointN(ring, 4) AS p3 FROM ienv),
      w(idx, u, v) AS (VALUES (1, ${W_POINTS[0]![0]}::float8, ${W_POINTS[0]![1]}::float8), (2, ${W_POINTS[1]![0]}::float8, ${W_POINTS[1]![1]}::float8),
                              (3, ${W_POINTS[2]![0]}::float8, ${W_POINTS[2]![1]}::float8), (4, ${W_POINTS[3]![0]}::float8, ${W_POINTS[3]![1]}::float8),
                              (5, ${W_POINTS[4]![0]}::float8, ${W_POINTS[4]![1]}::float8)),
      raw AS (
        SELECT w.idx, c.g,
               ST_SetSRID(ST_MakePoint(ST_X(c.p0) + w.u * (ST_X(c.p1) - ST_X(c.p0)) + w.v * (ST_X(c.p3) - ST_X(c.p0)),
                                       ST_Y(c.p0) + w.u * (ST_Y(c.p1) - ST_Y(c.p0)) + w.v * (ST_Y(c.p3) - ST_Y(c.p0))), 4326) AS p
        FROM w, corners c),
      placed AS (SELECT idx, CASE WHEN ST_Intersects(g, p) THEN p ELSE ST_ClosestPoint(g, p) END AS p FROM raw)
      SELECT idx, ST_X(p) AS lon, ST_Y(p) AS lat FROM placed ORDER BY idx`;
    return rows.map((r) => ({ lon: r.lon, lat: r.lat }));
  }

  /** "Start a check" on a pest or disease item; reuses the agronomist's open task for it. */
  async create(workspaceId: string, userId: string, recommendationId: string) {
    const rec = await this.prisma.db.recommendation.findFirst({
      where: { id: recommendationId, workspaceId },
      select: { id: true, fieldId: true, type: true, status: true },
    });
    if (!rec) throw new ProblemException(404, "not-found");
    if (rec.type !== "pest" && rec.type !== "disease")
      throw new ProblemException(422, "not-scoutable", "Only pest and disease items can be scouted");
    const open = await this.prisma.db.scoutingTask.findFirst({
      where: { recommendationId, createdBy: userId, status: "open" },
      select: { id: true },
    });
    if (open) return this.get(workspaceId, open.id);
    const points = await this.route(rec.fieldId);
    const id = randomUUID();
    await this.prisma.system.$transaction(async (tx) => {
      const mp = `MULTIPOINT(${points.map((p) => `${p.lon} ${p.lat}`).join(",")})`;
      await tx.$executeRaw`INSERT INTO scouting_tasks (id, recommendation_id, field_id, created_by, route, status) VALUES (${id}::uuid, ${recommendationId}::uuid, ${rec.fieldId}::uuid, ${userId}::uuid, ST_GeomFromText(${mp}, 4326), 'open')`;
      for (const [i, p] of points.entries()) {
        await tx.$executeRaw`INSERT INTO scouting_points (task_id, idx, geom, plants) VALUES (${id}::uuid, ${i + 1}, ST_SetSRID(ST_MakePoint(${p.lon}, ${p.lat}), 4326), ${PLANTS_PER_POINT})`;
      }
      await tx.auditLog.create({ data: { workspaceId, userId, action: "scouting.create", target: id } });
      await this.outbox.add(tx, [
        eventRow(EventKeys.brief(workspaceId), "scouting.created", workspaceId, { id, recommendationId }),
      ]);
    });
    return this.get(workspaceId, id);
  }

  async get(workspaceId: string, id: string) {
    const task = await this.prisma.db.scoutingTask.findFirst({
      where: { id, recommendation: { workspaceId } },
      include: {
        recommendation: {
          select: { id: true, subject: true, type: true, field: { select: { name: true } } },
        },
        photos: true,
      },
    });
    if (!task) throw new ProblemException(404, "not-found");
    const points = await this.prisma.system.$queryRaw<
      Array<{ idx: number; lon: number; lat: number; affected: number | null; plants: number }>
    >`
      SELECT idx, ST_X(geom) AS lon, ST_Y(geom) AS lat, affected, plants FROM scouting_points WHERE task_id = ${id}::uuid ORDER BY idx`;
    const [outline] = await this.prisma.system.$queryRaw<
      Array<{ geojson: string }>
    >`SELECT ST_AsGeoJSON(geom, 6) AS geojson FROM fields WHERE id = ${task.fieldId}::uuid`;
    const pest = this.lib.pests.pests.find((p) => p.id === task.recommendation.subject);
    return {
      id: task.id,
      status: task.status,
      recommendationId: task.recommendation.id,
      fieldId: task.fieldId,
      fieldName: task.recommendation.field.name,
      pest: pest
        ? { id: pest.id, name: pest.name, scout: pest.scout }
        : {
            id: task.recommendation.subject,
            name: { en: task.recommendation.subject, uk: task.recommendation.subject },
            scout: null,
          },
      outline: outline ? (JSON.parse(outline.geojson) as unknown) : null,
      points,
      resultPct: task.resultPct,
      sentAt: task.sentAt,
      photos: await Promise.all(
        task.photos.map(async (p) => ({
          id: p.id,
          pointIdx: p.pointIdx,
          contentType: p.contentType,
          url: await this.readUrl(p.id, p.s3Key),
        })),
      ),
    };
  }

  // ---------- photos ----------

  private sign(photoId: string, op: "put" | "get", exp: number): string {
    return createHmac("sha256", this.env.JWT_SECRET).update(`${photoId}:${op}:${exp}`).digest("base64url");
  }

  verify(photoId: string, op: "put" | "get", exp: number, sig: string): boolean {
    if (!Number.isFinite(exp) || exp < Date.now() / 1000) return false;
    const want = Buffer.from(this.sign(photoId, op, exp));
    const got = Buffer.from(sig);
    return want.length === got.length && timingSafeEqual(want, got);
  }

  private localUrl(photoId: string, op: "put" | "get"): string {
    const exp = Math.floor(Date.now() / 1000) + URL_TTL_S;
    return `/api/scouting-photos/${photoId}?op=${op}&exp=${exp}&sig=${this.sign(photoId, op, exp)}`;
  }

  private async readUrl(photoId: string, key: string): Promise<string> {
    if (this.s3)
      return getSignedUrl(this.s3, new GetObjectCommand({ Bucket: this.env.S3_BUCKET, Key: key }), {
        expiresIn: URL_TTL_S,
      });
    return this.localUrl(photoId, "get");
  }

  /** Presigned PUT for one photo of a point (S-07.03): JPEG / PNG / HEIC up to 10 MB, private storage. */
  async presign(
    workspaceId: string,
    userId: string,
    taskId: string,
    body: { pointIdx: number; contentType: string; bytes: number },
  ) {
    const task = await this.prisma.db.scoutingTask.findFirst({
      where: { id: taskId, recommendation: { workspaceId } },
      select: { id: true, status: true, createdBy: true },
    });
    if (!task) throw new ProblemException(404, "not-found");
    if (task.createdBy !== userId)
      throw new ProblemException(
        403,
        "forbidden",
        "Only the agronomist who started the check can add photos",
      );
    if (!PHOTO_TYPES.has(body.contentType))
      throw new ProblemException(422, "photo-type", "Photos must be JPEG, PNG or HEIC");
    if (body.bytes > PHOTO_MAX_BYTES || body.bytes <= 0)
      throw new ProblemException(422, "photo-size", "Photos can be up to 10 MB");
    const id = randomUUID();
    const key = `scouting/${workspaceId}/${taskId}/${id}`;
    await this.prisma.db.scoutingPhoto.create({
      data: {
        id,
        taskId,
        pointIdx: body.pointIdx,
        s3Key: key,
        contentType: body.contentType,
        bytes: body.bytes,
      },
    });
    if (this.s3) {
      const url = await getSignedUrl(
        this.s3,
        new PutObjectCommand({
          Bucket: this.env.S3_BUCKET,
          Key: key,
          ContentType: body.contentType,
          ContentLength: body.bytes,
        }),
        { expiresIn: URL_TTL_S },
      );
      return { photoId: id, method: "PUT", url, headers: { "Content-Type": body.contentType } };
    }
    return {
      photoId: id,
      method: "PUT",
      url: this.localUrl(id, "put"),
      headers: { "Content-Type": body.contentType },
    };
  }

  /** Development storage when no bucket is configured: the signed URL writes into UPLOADS_DIR. */
  async putLocal(photoId: string, stream: Readable): Promise<void> {
    const photo = await this.prisma.db.scoutingPhoto.findUnique({ where: { id: photoId } });
    if (!photo) throw new ProblemException(404, "not-found");
    const path = join(this.env.UPLOADS_DIR, photo.s3Key);
    mkdirSync(join(path, ".."), { recursive: true });
    await pipeline(stream, createWriteStream(path));
    if (statSync(path).size > PHOTO_MAX_BYTES)
      throw new ProblemException(422, "photo-size", "Photos can be up to 10 MB");
  }

  async getLocal(photoId: string) {
    const photo = await this.prisma.db.scoutingPhoto.findUnique({ where: { id: photoId } });
    if (!photo) throw new ProblemException(404, "not-found");
    return {
      stream: createReadStream(join(this.env.UPLOADS_DIR, photo.s3Key)),
      contentType: photo.contentType,
    };
  }

  // ---------- send ----------

  /**
   * Send (S-07.04): all 5 counts, idempotent by client id; result = Σ affected / 100 plants. The result is added to the
   * item's evidence; a field check re-runs so the confidence cap lifts. The level changes only through a verified
   * `scoutAction` threshold (RFC §10.7).
   */
  async send(
    workspaceId: string,
    userId: string,
    taskId: string,
    body: { clientId: string; counts: number[] },
  ) {
    const task = await this.prisma.db.scoutingTask.findFirst({
      where: { id: taskId, recommendation: { workspaceId } },
      include: { recommendation: true },
    });
    if (!task) throw new ProblemException(404, "not-found");
    if (task.status === "sent") {
      if (task.clientId === body.clientId) return this.get(workspaceId, taskId); // replay
      throw new ProblemException(409, "already-sent", "This check was already sent");
    }
    if (task.createdBy !== userId)
      throw new ProblemException(403, "forbidden", "Only the agronomist who started the check can send it");
    if (body.counts.length !== W_POINTS.length)
      throw new ProblemException(422, "points-missing", "All 5 points need a count");
    const affected = body.counts.reduce((a, b) => a + b, 0);
    const pct = Math.round((affected / (W_POINTS.length * PLANTS_PER_POINT)) * 1000) / 10;
    const now = new Date();
    const model = this.lib.enabledModels.find((m) => m.pest === task.recommendation.subject);
    const action = model?.scoutAction;
    const actionApplies = action?.verified && action.value !== null;
    await this.prisma.system.$transaction(async (tx) => {
      for (const [i, n] of body.counts.entries()) {
        await tx.$executeRaw`UPDATE scouting_points SET affected = ${n}, checked_at = ${now} WHERE task_id = ${taskId}::uuid AND idx = ${i + 1}`;
      }
      await tx.scoutingTask.update({
        where: { id: taskId },
        data: { status: "sent", resultPct: pct, sentAt: now, clientId: body.clientId },
      });
      const evidence = [
        ...((task.recommendation.evidence as unknown[]) ?? []),
        {
          kind: "scouting",
          source: "Scouting",
          date: now.toISOString().slice(0, 10),
          value: pct,
          unit: "% plants affected",
        },
      ];
      await tx.recommendation.update({
        where: { id: task.recommendationId },
        data: {
          evidence: evidence as unknown as Prisma.InputJsonValue,
          ...(actionApplies ? { level: pct >= action!.value! ? "high" : "low" } : {}),
        },
      });
      await tx.auditLog.create({
        data: { workspaceId, userId, action: "scouting.send", target: `${taskId}:${pct}` },
      });
      await this.outbox.add(tx, [
        eventRow(EventKeys.brief(workspaceId), "scouting.sent", workspaceId, { id: taskId, pct }),
      ]);
    });
    // Re-check the field so the confidence cap lifts for this pest (RFC §10.3).
    try {
      const ws = await this.prisma.system.workspace.findUniqueOrThrow({
        where: { id: workspaceId },
        select: { timeZone: true },
      });
      await this.analysis.start(workspaceId, "manual", userId, localDate(ws.timeZone), [task.fieldId]);
    } catch (e) {
      this.log.warn(`re-check after scouting skipped: ${(e as Error).message}`);
    }
    return this.get(workspaceId, taskId);
  }
}
