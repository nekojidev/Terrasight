import { Inject, Injectable } from "@nestjs/common";
import { modelApplies, winterWheatStage, type EvalInputs, type SeasonStage } from "@terrasight/evaluators";
import type { Library, PestModel } from "@terrasight/library";
import type { DailyWeather as PowerSeries, S2Result } from "@terrasight/sources";
import { RateLimitService } from "../auth/rate-limit.js";
import { PrismaService } from "../db/prisma.service.js";
import { GeoService } from "../geo/geo.service.js";
import { LIBRARY } from "../library/library.module.js";
import { SeasonsService } from "../seasons/seasons.service.js";
import { SOURCE_LABELS, SourcesService } from "../sources/sources.service.js";
import { ForecastService } from "./forecast.service.js";
import { mergeWeather, ndviObservations, observedUntil } from "./inputs.js";

const BUCKET = { capacity: 8, refillPerSec: 2 };

/** First host crop named in a model tree (`host_repeat` / `host_interval`). */
export function hostCrop(model: PestModel): string | null {
  const m = /"host":\["([a-z_]+)"/.exec(JSON.stringify(model.tree));
  return m?.[1] ?? null;
}

export interface BuiltInputs {
  inputs: EvalInputs;
  stage: SeasonStage;
  /** Enabled models whose stage window matches today. */
  due: PestModel[];
  dataDate: string | null;
  powerDate: string | null;
  problems: string[];
  /** Planning deadline per model (next crop, else the model's host crop, else a repeat of the last crop). */
  planningDeadline: (model: PestModel) => string | null;
}

/** Builds evaluator inputs for a field (RFC §10.3): used by the field check and the assistant's what-if tool. */
@Injectable()
export class EvalInputsService {
  constructor(
    @Inject(LIBRARY) private readonly lib: Library,
    private readonly prisma: PrismaService,
    private readonly forecasts: ForecastService,
    private readonly sources: SourcesService,
    private readonly seasons: SeasonsService,
    private readonly geo: GeoService,
    private readonly limits: RateLimitService,
  ) {}

  async build(workspaceId: string, fieldId: string, asOf: string): Promise<BuiltInputs> {
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
    const problems: string[] = [];
    if (!power || power.origin === "stale")
      problems.push(`${SOURCE_LABELS.power} ${power?.error ?? "did not respond"}`);
    if (!forecast) problems.push("Forecast unavailable");
    else if (forecast.origin === "stale")
      problems.push(`Forecast from ${forecast.ageHours} h ago (${forecast.failures.join("; ")})`);

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
      record: { crop: record.crop, sowingDate: record.sowingDate, emergenceDate: record.emergenceDate },
      weather,
      ndvi: ndviObservations(s2?.result.payload ?? null),
      planningDeadline: null,
      scouted: scouted.map((s) => s.recommendation.subject),
      southernHemisphere: geom.centroid.lat < 0,
    };
    const stage: SeasonStage =
      record.crop.value === "winter_wheat" ? winterWheatStage(inputs, asOf) : "unknown";
    return {
      inputs,
      stage,
      due: models.filter((m) => modelApplies(m, { crop: record.crop.value, stage })),
      dataDate: observedUntil(weather),
      powerDate: power?.result.dataDate ?? null,
      problems,
      planningDeadline: (model) =>
        this.seasons.typicalSowing(field.regionId, nextCrop, season) ??
        this.seasons.typicalSowing(field.regionId, hostCrop(model), season) ??
        this.seasons.typicalSowing(field.regionId, lastCrop, season),
    };
  }
}
