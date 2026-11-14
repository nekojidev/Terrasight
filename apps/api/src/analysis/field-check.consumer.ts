import { Inject, Injectable, Logger, type OnModuleInit } from "@nestjs/common";
import {
  evaluate,
  modelApplies,
  snapshotHash,
  winterWheatStage,
  type EvalInputs,
  type Level,
  type RiskResult,
  type SeasonStage,
} from "@terrasight/evaluators";
import type { Library, PestModel } from "@terrasight/library";
import type { Envelope } from "@terrasight/shared";
import type { DailyWeather as PowerSeries, S2Result } from "@terrasight/sources";
import { RateLimitService } from "../auth/rate-limit.js";
import { ENV, runsWorker, type Env } from "../config/config.js";
import { PrismaService } from "../db/prisma.service.js";
import type { Prisma } from "../generated/prisma/client.js";
import type { RecStatus, RecType } from "../generated/prisma/enums.js";
import { GeoService } from "../geo/geo.service.js";
import { LIBRARY } from "../library/library.module.js";
import { BROKER, type Broker } from "../messaging/broker.js";
import { JobConsumer } from "../messaging/consumer.js";
import { QUEUES } from "../messaging/topology.js";
import { SeasonsService } from "../seasons/seasons.service.js";
import { SOURCE_LABELS, SourcesService } from "../sources/sources.service.js";
import { AnalysisService, type FieldCheckJob } from "./analysis.service.js";
import { ForecastService } from "./forecast.service.js";
import { mergeWeather, ndviObservations, observedUntil } from "./inputs.js";

const LIVE: RecStatus[] = ["open", "accepted", "snoozed", "in_report", "dismissed"];
const ORDER: Record<Level, number> = { unknown: -1, none: 0, low: 1, moderate: 2, high: 3 };
const DISEASE_KINDS = new Set(["fungus", "oomycete", "bacteria", "virus", "mycotoxin"]);
const BUCKET = { capacity: 8, refillPerSec: 2 };
/** Weather kept in a stored snapshot; the full 1981+ series is referenced by its POWER cache date. */
const SNAPSHOT_WEATHER_DAYS = 430;

/** First host crop named in a model tree (`host_repeat` / `host_interval`). */
function hostCrop(model: PestModel): string | null {
  const m = /"host":\["([a-z_]+)"/.exec(JSON.stringify(model.tree));
  return m?.[1] ?? null;
}

/**
 * One field check (RFC §10.2, Tech Design §8.2): refresh weather by grid cell → season state → the evaluators whose
 * stage window matches → upsert recommendations and append the level history → status ok / stale / failed.
 */
@Injectable()
export class FieldCheckConsumer extends JobConsumer<FieldCheckJob> implements OnModuleInit {
  private readonly logger = new Logger(FieldCheckConsumer.name);

  constructor(
    @Inject(BROKER) broker: Broker,
    @Inject(ENV) private readonly env: Env,
    @Inject(LIBRARY) private readonly lib: Library,
    private readonly prisma: PrismaService,
    private readonly analysis: AnalysisService,
    private readonly forecasts: ForecastService,
    private readonly sources: SourcesService,
    private readonly seasons: SeasonsService,
    private readonly geo: GeoService,
    private readonly limits: RateLimitService,
  ) {
    super(broker, { queue: QUEUES.fieldCheck, prefetch: 4, retries: 0 });
  }

  async onModuleInit(): Promise<void> {
    if (runsWorker(this.env)) await this.start();
  }

  async handle(env: Envelope<FieldCheckJob>): Promise<void> {
    const { runId, fieldId } = env.data;
    const workspaceId = env.workspaceId!;
    if (!(await this.analysis.running(workspaceId, runId, fieldId))) return; // already handled
    try {
      const r = await this.check(workspaceId, runId, fieldId);
      await this.analysis.finish(workspaceId, runId, fieldId, r.status, r.dataDate, r.error, r.created);
    } catch (e) {
      this.logger.error(`field check ${fieldId} failed: ${(e as Error).stack ?? String(e)}`);
      await this.analysis.finish(
        workspaceId,
        runId,
        fieldId,
        "failed",
        null,
        "the check failed unexpectedly",
        0,
      );
    }
  }

  async check(workspaceId: string, runId: string, fieldId: string) {
    const run = await this.prisma.system.analysisRun.findUniqueOrThrow({
      where: { id: runId },
      select: { asOf: true },
    });
    const asOf = run.asOf.toISOString().slice(0, 10);
    const field = await this.prisma.system.field.findUniqueOrThrow({
      where: { id: fieldId },
      select: { regionId: true, tier: true, country: true },
    });
    const geom = await this.geo.fieldGeometry(fieldId);
    const take = async () => {
      while (!(await this.limits.take("source:power", BUCKET)))
        await new Promise((res) => setTimeout(res, 250));
    };

    const models = this.lib.enabledModels;
    const needsNdvi = models.some((m) => JSON.stringify(m.tree).includes('"green_bridge"'));
    const [power, forecast, s2] = await Promise.all([
      this.sources.fresh<PowerSeries>("power", geom, asOf, take),
      this.forecasts.get(geom.centroid.lat, geom.centroid.lon, field.country, asOf),
      needsNdvi
        ? this.sources.fresh<S2Result>("sentinel2", geom, asOf, async () => undefined)
        : Promise.resolve(null),
    ]);

    const weather = mergeWeather(power?.result.payload ?? null, forecast?.forecast ?? null, asOf);
    const dataDate = observedUntil(weather);
    const problems: string[] = [];
    if (!power || power.origin === "stale")
      problems.push(`${SOURCE_LABELS.power} ${power?.error ?? "did not respond"}`);
    if (!forecast) problems.push("Forecast unavailable");
    else if (forecast.origin === "stale")
      problems.push(`Forecast from ${forecast.ageHours} h ago (${forecast.failures.join("; ")})`);
    if (!weather.length)
      return {
        status: "failed" as const,
        dataDate: null,
        error: problems.join(". ") || "no weather data",
        created: 0,
      };

    const season = SeasonsService.currentSeason(new Date(`${asOf}T12:00:00Z`));
    const [crops, record, plan, scouted] = await Promise.all([
      this.prisma.system.cropSeason.findMany({ where: { fieldId } }),
      this.seasons.get(workspaceId, fieldId, season),
      this.prisma.system.plan.findUnique({ where: { fieldId_season: { fieldId, season } } }),
      this.prisma.system.scoutingTask.findMany({
        where: { fieldId, status: "sent", recommendation: { season } },
        select: { recommendation: { select: { subject: true } } },
      }),
    ]);
    const confirmedCrop = record.crop.source === "confirmed" ? record.crop.value : null;
    const nextCrop = plan?.crop ?? confirmedCrop;
    const lastCrop = [...crops].sort((a, b) => b.season - a.season)[0]?.mainCrop ?? null;
    const inputs: EvalInputs = {
      fieldId,
      tier: field.tier,
      regionId: field.regionId,
      season,
      crops: crops.map((c) => ({
        season: c.season,
        mainCrop: c.mainCrop,
        secondCrop: c.secondCrop,
        confidence: c.confidence,
        source: c.source,
        isOverride: c.isOverride,
      })),
      nextCrop: { season, crop: nextCrop, source: plan ? "plan" : confirmedCrop ? "plan" : "unknown" },
      record: {
        crop: record.crop,
        sowingDate: record.sowingDate,
        emergenceDate: record.emergenceDate,
      },
      weather,
      ndvi: ndviObservations(s2?.result.payload ?? null),
      planningDeadline: null, // per model below
      scouted: scouted.map((s) => s.recommendation.subject),
      southernHemisphere: geom.centroid.lat < 0,
    };

    const stage: SeasonStage =
      record.crop.value === "winter_wheat" ? winterWheatStage(inputs, asOf) : "unknown";
    const due = models.filter((m) => modelApplies(m, { crop: record.crop.value, stage }));
    let created = 0;
    for (const model of due) {
      // Planning deadline: the next crop's typical sowing date; while it isn't chosen, the date the model's host
      // crop would be sown (the decision has to be made by then), else a repeat of the last crop.
      const host = hostCrop(model);
      const planningDeadline =
        this.seasons.typicalSowing(field.regionId, nextCrop, season) ??
        this.seasons.typicalSowing(field.regionId, host, season) ??
        this.seasons.typicalSowing(field.regionId, lastCrop, season);
      const result = evaluate(model, { ...inputs, planningDeadline }, asOf);
      if (
        await this.upsert(
          workspaceId,
          fieldId,
          runId,
          model,
          result,
          inputs,
          asOf,
          power?.result.dataDate ?? null,
        )
      )
        created += 1;
    }
    // Open or snoozed items whose deadline has passed leave the brief (RFC §10.4: Open → Expired).
    await this.prisma.system.recommendation.updateMany({
      where: {
        fieldId,
        status: { in: ["open", "snoozed"] },
        deadline: { lt: new Date(`${asOf}T00:00:00Z`) },
      },
      data: { status: "expired" },
    });
    this.logger.log(
      `field ${fieldId}: ${due.length}/${models.length} models due (stage ${stage}), ${created} new, data ${dataDate}`,
    );
    return {
      status: problems.length ? ("stale" as const) : ("ok" as const),
      dataDate,
      error: problems.join(". ") || null,
      created,
    };
  }

  /** One live recommendation per field / type / subject / season (RFC §10.4); returns true when a new one appeared. */
  private async upsert(
    workspaceId: string,
    fieldId: string,
    runId: string,
    model: PestModel,
    r: RiskResult,
    inputs: EvalInputs,
    asOf: string,
    powerDate: string | null,
  ): Promise<boolean> {
    const pest = this.lib.pests.pests.find((p) => p.id === model.pest);
    const type: RecType = pest && DISEASE_KINDS.has(pest.kind) ? "disease" : "pest";
    const season = inputs.season;
    const hash = snapshotHash(inputs, asOf, this.lib.versions.pestModels);
    const cutoff = new Date(Date.parse(`${asOf}T00:00:00Z`) - SNAPSHOT_WEATHER_DAYS * 864e5)
      .toISOString()
      .slice(0, 10);
    const payload = {
      asOf,
      inputs: { ...inputs, weather: inputs.weather.filter((w) => w.date >= cutoff) },
      weatherFrom: cutoff,
      powerDataDate: powerDate,
    };

    return this.prisma.system.$transaction(async (tx) => {
      const snap = await tx.inputSnapshot.upsert({
        where: { hash },
        create: { hash, payload: payload as unknown as Prisma.InputJsonValue },
        update: {},
        select: { id: true },
      });
      const existing = await tx.recommendation.findFirst({
        where: { fieldId, type, subject: model.pest, season, status: { in: LIVE } },
      });
      const data = {
        level: r.level,
        confidence: r.confidence,
        tier: r.tier,
        deadline: r.deadline ? new Date(`${r.deadline}T00:00:00Z`) : null,
        irreversible: r.irreversible,
        planning: r.planning,
        keyNumbers: r.keyNumbers as unknown as Prisma.InputJsonValue,
        drivers: r.drivers as unknown as Prisma.InputJsonValue,
        evidence: [
          ...r.evidence,
          ...r.citations.map((c) => ({ kind: "citation", ...c })),
        ] as unknown as Prisma.InputJsonValue,
        unknowns: r.unknowns as unknown as Prisma.InputJsonValue,
        modelRef: `${model.pest}@${this.lib.versions.pestModels}`,
        versions: this.lib.versions as unknown as Prisma.InputJsonValue,
        inputSnapshotId: snap.id,
      };
      if (!existing) {
        if (r.level === "none") return false;
        const rec = await tx.recommendation.create({
          data: { workspaceId, fieldId, type, subject: model.pest, season, ...data },
        });
        await tx.recommendationLevel.create({
          data: { recommendationId: rec.id, runId, level: r.level, confidence: r.confidence },
        });
        return ORDER[r.level] >= ORDER.moderate;
      }
      // Dismissed stays dismissed unless the level rises; a snooze ends at the next morning run if it still fires.
      const rose = ORDER[r.level] > ORDER[existing.level];
      const fires = ORDER[r.level] >= ORDER.moderate;
      const reopen =
        (existing.status === "dismissed" && rose) ||
        (existing.status === "snoozed" &&
          fires &&
          (!existing.snoozedUntil || existing.snoozedUntil <= new Date()));
      await tx.recommendation.update({
        where: { id: existing.id },
        data: {
          ...data,
          ...(reopen ? { status: "open", snoozedAt: null, snoozedUntil: null, dismissedAt: null } : {}),
        },
      });
      await tx.recommendationLevel.create({
        data: { recommendationId: existing.id, runId, level: r.level, confidence: r.confidence },
      });
      return false;
    });
  }
}
