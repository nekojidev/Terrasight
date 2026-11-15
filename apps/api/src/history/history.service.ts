import { createHash } from "node:crypto";
import { Inject, Injectable, Logger, type OnModuleInit } from "@nestjs/common";
import { ModuleRef } from "@nestjs/core";
import { loadUaYields, oblastYields, seqCrops, type Library, type UaYieldsFile } from "@terrasight/library";
import { EventKeys, type Envelope } from "@terrasight/shared";
import {
  soilSummaryFromGrids,
  type CdlHistory,
  type CroplandHistory,
  type DailyWeather,
  type EtSeries,
  type NdviSeries,
  type SoilGridsSummary,
  type SoilSummary,
  type SourceResult,
} from "@terrasight/sources";
import { ENV, runsWorker, type Env } from "../config/config.js";
import { PrismaService } from "../db/prisma.service.js";
import type { Prisma } from "../generated/prisma/client.js";
import { ProblemException } from "../http/problem.js";
import { LIBRARY } from "../library/library.module.js";
import { BROKER, type Broker } from "../messaging/broker.js";
import { JobConsumer } from "../messaging/consumer.js";
import { eventRow, jobRow } from "../messaging/outbox.js";
import { OutboxService } from "../messaging/outbox.service.js";
import { QUEUES } from "../messaging/topology.js";
import {
  applyCroplandMask,
  bareMonths,
  baselineCrops,
  cropsFromCdl,
  cropsFromNdvi,
  detectIrrigation,
  HISTORY_SEASONS,
  matchBaseline,
  seasonStats,
  stressYears,
  type SeasonCrop,
} from "./compute.js";

interface BuildJob {
  fieldId: string;
  jobId: string;
  provisional: boolean;
}

/**
 * Builds the field's 18-season history from the results its last gather job produced (RFC D3, Tech Design §8.1).
 * Provisional when weather, soil and crops are in; rebuilt when every source has finished.
 */
@Injectable()
export class HistoryService extends JobConsumer<BuildJob> implements OnModuleInit {
  constructor(
    @Inject(BROKER) broker: Broker,
    @Inject(ENV) private readonly env: Env,
    @Inject(LIBRARY) private readonly lib: Library,
    private readonly prisma: PrismaService,
    private readonly outbox: OutboxService,
    private readonly moduleRef?: ModuleRef,
  ) {
    super(broker, { queue: QUEUES.historyBuild, prefetch: 2, retries: 2 });
  }

  async onModuleInit(): Promise<void> {
    if (runsWorker(this.env)) await this.start();
  }

  private async results(jobId: string): Promise<Partial<Record<string, SourceResult>>> {
    const tasks = await this.prisma.system.gatherTask.findMany({
      where: { jobId, cacheKey: { not: null } },
      select: { source: true, cacheKey: true },
    });
    const rows = await this.prisma.system.sourceCache.findMany({
      where: { key: { in: tasks.map((t) => t.cacheKey!) } },
      select: { key: true, payload: true },
    });
    const byKey = new Map(rows.map((r) => [r.key, r.payload as unknown as SourceResult]));
    return Object.fromEntries(tasks.map((t) => [t.source, byKey.get(t.cacheKey!)]).filter(([, v]) => v));
  }

  async handle(env: Envelope<BuildJob>): Promise<void> {
    const { fieldId, jobId, provisional } = env.data;
    const field = await this.prisma.system.field.findUnique({
      where: { id: fieldId },
      select: { id: true, workspaceId: true, regionId: true, irrigationSource: true },
    });
    if (!field) return;
    const r = await this.results(jobId);
    const payload = <T>(id: string): T | null => (r[id]?.payload ?? null) as T | null;
    const weather = payload<DailyWeather>("power");
    const cdl = payload<CdlHistory>("cdl");
    const ndvi = payload<NdviSeries>("modis");
    // Outside the US SoilGrids is the soil source and WaPOR the water-use source (estimates, flagged in the payload).
    const grids = payload<SoilGridsSummary>("soilgrids");
    const soil = payload<SoilSummary>("ssurgo") ?? (grids ? soilSummaryFromGrids(grids) : null);
    const et = payload<EtSeries>("openet") ?? payload<EtSeries>("wapor");
    const cropland = payload<CroplandHistory>("cropland");

    const thisYear = new Date().getUTCFullYear();
    const lastSeason = thisYear - 1;
    const seasons = Array.from({ length: HISTORY_SEASONS }, (_, i) => lastSeason - HISTORY_SEASONS + 1 + i);
    const crops: SeasonCrop[] = cdl
      ? cropsFromCdl(cdl, field.regionId)
      : ndvi
        ? applyCroplandMask(
            cropsFromNdvi(ndvi, baselineCrops(this.lib, field.regionId), lastSeason),
            cropland,
          )
        : [];
    const croplandShare = new Map((cropland?.seasons ?? []).map((s) => [s.year, s.cropShare]));
    const stats = seasonStats(weather, ndvi, seasons);
    const irrigation = detectIrrigation(et, stats, soil, ndvi);

    // The agronomist's corrections win (S-02.07): drop computed seasons they overrode.
    const overrides = await this.prisma.db.cropSeason.findMany({ where: { fieldId, isOverride: true } });
    const overridden = new Set(overrides.map((o) => o.season));
    const merged: SeasonCrop[] = [
      ...crops.filter((c) => !overridden.has(c.season)),
      ...overrides.map((o) => ({
        season: o.season,
        mainCrop: o.mainCrop,
        secondCrop: o.secondCrop,
        confidence: 1,
        source: "cdl" as const,
      })),
    ];
    const baseline = matchBaseline(merged, this.lib, field.regionId);
    const inputsHash = createHash("sha256")
      .update(
        JSON.stringify(
          Object.keys(r)
            .sort()
            .map((k) => [k, r[k]?.dataDate]),
        ),
      )
      .digest("hex")
      .slice(0, 16);

    await this.prisma.system.$transaction(async (tx) => {
      for (const c of crops) {
        if (overridden.has(c.season)) continue;
        await tx.cropSeason.upsert({
          where: { fieldId_season: { fieldId, season: c.season } },
          create: {
            fieldId,
            season: c.season,
            mainCrop: c.mainCrop,
            secondCrop: c.secondCrop,
            confidence: c.confidence,
            source: c.source,
          },
          update: {
            mainCrop: c.mainCrop,
            secondCrop: c.secondCrop,
            confidence: c.confidence,
            source: c.source,
          },
        });
      }
      const data = {
        builtAt: new Date(),
        inputsHash,
        provisional,
        bareMonths: bareMonths(ndvi ?? { points: [], pixelSizeM: 250 }, seasons[0]!) as Prisma.InputJsonValue,
        stressYears: stressYears(stats) as unknown as Prisma.InputJsonValue,
        ndviPeaks: stats.map((s) => ({
          season: s.season,
          peak: s.ndviPeak,
          precipMm: s.precipMm,
          heatDays: s.heatDays,
          cropland: croplandShare.get(s.season) ?? null,
        })) as Prisma.InputJsonValue,
        irrigationDetection: irrigation as unknown as Prisma.InputJsonValue,
        baselineMatch: baseline as unknown as Prisma.InputJsonValue,
      };
      await tx.fieldHistory.upsert({ where: { fieldId }, create: { fieldId, ...data }, update: data });
      // Detection fills in only what nobody confirmed (RFC §6.2).
      if (field.irrigationSource !== "confirmed" && irrigation.status !== "unknown") {
        await tx.field.update({
          where: { id: fieldId },
          data: { irrigation: irrigation.status, irrigationSource: "estimate" },
        });
      }
      await this.outbox.add(tx, [
        eventRow(EventKeys.fieldHistory(fieldId), "history.built", field.workspaceId, {
          fieldId,
          provisional,
        }),
      ]);
    });
    // New field pipeline (Tech Design §8.1): once the final history is in, check the field so its first
    // recommendations appear without waiting for the next 06:00 run.
    if (!provisional) await this.firstCheck(field.workspaceId, fieldId);
    this.log.log(
      `history for ${fieldId}: ${crops.length} seasons, irrigation ${irrigation.status}, ${baseline.label}${provisional ? " (provisional)" : ""}`,
    );
  }

  private async firstCheck(workspaceId: string, fieldId: string): Promise<void> {
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
      new Logger(HistoryService.name).warn(`first check for ${fieldId} skipped: ${(e as Error).message}`);
    }
  }

  private uaYields: UaYieldsFile | null | undefined;

  private regionalYields(adminCode: string | null) {
    if (!adminCode?.startsWith("UA-")) return null;
    if (this.uaYields === undefined) this.uaYields = loadUaYields(this.env.DATA_DIR);
    return this.uaYields ? oblastYields(this.uaYields, adminCode) : null;
  }

  private regionCrops(regionId: string | null): string[] {
    if (!regionId) return [];
    const ids = new Set<string>();
    for (const r of this.lib.rotations.rotations)
      if (r.region === regionId) for (const item of r.sequence) for (const c of seqCrops(item)) ids.add(c);
    ids.delete("fallow");
    return [...ids].filter((c) => this.lib.rotations.crops[c]).sort();
  }

  /** History view for the field page (design 08): 18-season strip, stress years, irrigation, current rotation. */
  async get(workspaceId: string, fieldId: string) {
    const field = await this.prisma.db.field.findFirst({
      where: { id: fieldId, workspaceId, archivedAt: null },
      select: { id: true, irrigation: true, irrigationSource: true, adminCode: true, regionId: true },
    });
    if (!field) throw new ProblemException(404, "not-found");
    const [history, crops] = await Promise.all([
      this.prisma.db.fieldHistory.findUnique({ where: { fieldId } }),
      this.prisma.db.cropSeason.findMany({ where: { fieldId }, orderBy: { season: "asc" } }),
    ]);
    return {
      built: history ? { at: history.builtAt, provisional: history.provisional } : null,
      seasons: crops.map((c) => ({
        season: c.season,
        mainCrop: c.mainCrop,
        secondCrop: c.secondCrop,
        confidence: c.confidence,
        source: c.source,
        isOverride: c.isOverride,
      })),
      bareMonths: history?.bareMonths ?? [],
      stressYears: history?.stressYears ?? [],
      seasonStats: history?.ndviPeaks ?? [],
      irrigation: {
        value: field.irrigation,
        source: field.irrigationSource,
        detection: history?.irrigationDetection ?? null,
      },
      currentRotation: history?.baselineMatch ?? null,
      /** Ukraine only: oblast average yields (State Statistics Service). Context, never verified, never a price. */
      regionalYields: this.regionalYields(field.adminCode),
      /** Crops of the field's region (rotations of the library), for the "This season" crop picker; empty when the region has no library. */
      regionCrops: this.regionCrops(field.regionId),
      /** Localised names of every library crop: labels for the strip and the "correct a season" picker. */
      cropNames: Object.fromEntries(
        Object.entries(this.lib.rotations.crops).map(([id, c]) => [id, { en: c.en, uk: c.uk }]),
      ),
    };
  }

  /** The agronomist corrects a past season (S-02.07); the history is rebuilt from the cached sources. */
  async override(
    workspaceId: string,
    userId: string,
    fieldId: string,
    season: number,
    mainCrop: string,
    secondCrop: string | null,
  ) {
    const field = await this.prisma.db.field.findFirst({
      where: { id: fieldId, workspaceId, archivedAt: null },
      select: { id: true },
    });
    if (!field) throw new ProblemException(404, "not-found");
    if (!this.lib.rotations.crops[mainCrop] || (secondCrop && !this.lib.rotations.crops[secondCrop])) {
      throw new ProblemException(422, "unknown-crop", "Unknown crop");
    }
    const job = await this.prisma.system.gatherJob.findFirst({
      where: { fieldId },
      orderBy: { startedAt: "desc" },
      select: { id: true },
    });
    await this.prisma.system.$transaction(async (tx) => {
      await tx.cropSeason.upsert({
        where: { fieldId_season: { fieldId, season } },
        create: { fieldId, season, mainCrop, secondCrop, confidence: 1, source: "user", isOverride: true },
        update: { mainCrop, secondCrop, confidence: 1, source: "user", isOverride: true },
      });
      await tx.auditLog.create({
        data: { workspaceId, userId, action: "history.override", target: `${fieldId}:${season}` },
      });
      if (job)
        await this.outbox.add(tx, [
          jobRow(QUEUES.historyBuild, workspaceId, { fieldId, jobId: job.id, provisional: false }),
        ]);
    });
    return this.get(workspaceId, fieldId);
  }
}
