import { Inject, Injectable, Logger, Optional, type OnModuleInit } from "@nestjs/common";
import { evaluate, snapshotHash, type EvalInputs, type Level, type RiskResult } from "@terrasight/evaluators";
import type { Library, PestModel } from "@terrasight/library";
import type { Envelope } from "@terrasight/shared";
import { ENV, runsWorker, type Env } from "../config/config.js";
import { PrismaService } from "../db/prisma.service.js";
import type { Prisma } from "../generated/prisma/client.js";
import type { RecStatus, RecType } from "../generated/prisma/enums.js";
import { LIBRARY } from "../library/library.module.js";
import { BROKER, type Broker } from "../messaging/broker.js";
import { JobConsumer } from "../messaging/consumer.js";
import { QUEUES } from "../messaging/topology.js";
import { AiRecommendationsService } from "./ai-recommendations.service.js";
import { AlertsService } from "./alerts.service.js";
import { AnalysisService, STALE_RUNNING_MS, type FieldCheckJob } from "./analysis.service.js";
import { EvalInputsService } from "./eval-inputs.service.js";
import { fieldBlocked } from "../suitability/suitability.js";
import { ScenariosService } from "../scenarios/scenarios.service.js";

const LIVE: RecStatus[] = ["open", "accepted", "snoozed", "in_report", "dismissed"];
const ORDER: Record<Level, number> = { unknown: -1, none: 0, low: 1, moderate: 2, high: 3 };
const DISEASE_KINDS = new Set(["fungus", "oomycete", "bacteria", "virus", "mycotoxin"]);
/** Weather kept in a stored snapshot; the full 1981+ series is referenced by its POWER cache date. */
const SNAPSHOT_WEATHER_DAYS = 430;
/** Transient source failures are retried twice with the consumer's 5 s / 30 s backoff. */
export const FIELD_CHECK_RETRIES = 2;

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
    private readonly inputsService: EvalInputsService,
    private readonly scenarios: ScenariosService,
    private readonly alerts: AlertsService,
    @Optional() private readonly ai?: AiRecommendationsService,
  ) {
    super(broker, {
      queue: QUEUES.fieldCheck,
      prefetch: env.FIELD_CHECK_PREFETCH,
      retries: FIELD_CHECK_RETRIES,
    });
  }

  async onModuleInit(): Promise<void> {
    if (runsWorker(this.env)) await this.start();
  }

  async handle(env: Envelope<FieldCheckJob>, attempt = 0): Promise<void> {
    const { runId, fieldId } = env.data;
    const workspaceId = env.workspaceId!;
    // attempt > 0: a retry or a redelivery after a worker crash, which may find its row still "running".
    const reclaim = attempt > 0 ? STALE_RUNNING_MS : undefined;
    if (!(await this.analysis.running(workspaceId, runId, fieldId, reclaim))) return; // already handled
    const retry = attempt < this.options.retries;
    try {
      const r = await this.check(workspaceId, runId, fieldId);
      if (r.status === "failed" && retry) throw new Error(r.error ?? "no weather data");
      await this.analysis.finish(workspaceId, runId, fieldId, r.status, r.dataDate, r.error, r.created);
    } catch (e) {
      if (retry) {
        // Transient (sources down, DB blip): back to "waiting" and let the consumer schedule the retry.
        this.logger.warn(`field check ${fieldId} will be retried: ${(e as Error).message}`);
        await this.analysis.release(runId, fieldId);
        throw e;
      }
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
    // Unsuitable land (not overridden): no crop recommendations. Every item the field has (pest, disease, frost and
    // water-stress alerts all need a crop, rotation, watch-items) leaves the brief; accepted / reported ones stay.
    if (await fieldBlocked(this.prisma.system, fieldId)) {
      await this.prisma.system.recommendation.updateMany({
        where: { fieldId, status: { in: ["open", "snoozed"] } },
        data: { status: "superseded" },
      });
      this.logger.log(`field ${fieldId}: land is unsuitable for crops, crop evaluators skipped`);
      return { status: "ok" as const, dataDate: null, error: null, created: 0 };
    }
    const built = await this.inputsService.build(workspaceId, fieldId, asOf);
    const { inputs, stage, due, dataDate, problems } = built;
    const models = this.lib.enabledModels;
    if (!inputs.weather.length)
      return {
        status: "failed" as const,
        dataDate: null,
        error: problems.join(". ") || "no weather data",
        created: 0,
      };
    let created = 0;
    for (const model of due) {
      const planningDeadline = built.planningDeadline(model);
      const result = evaluate(model, { ...inputs, planningDeadline }, asOf);
      if (await this.upsert(workspaceId, fieldId, runId, model, result, inputs, asOf, built.powerDate))
        created += 1;
    }
    // Weather and irrigation items (L-13): frost alert, FAO-56 water stress on irrigated fields.
    try {
      created += await this.alerts.run(workspaceId, fieldId, runId, built, asOf);
    } catch (e) {
      this.logger.warn(`alerts for ${fieldId} skipped: ${(e as Error).message}`);
    }
    // Rotation item (S-03.08): best-fit option from the scenario engine (cached by inputs hash, so cheap daily).
    try {
      if (await this.scenarios.upsertRecommendation(workspaceId, fieldId, runId)) created += 1;
    } catch (e) {
      this.logger.warn(`rotation scenarios for ${fieldId} skipped: ${(e as Error).message}`);
    }
    // AI wording of the results and "worth scouting" watch-items (PD v2.11): one batched call, never fails the check.
    await this.ai?.enrich(fieldId, built, asOf);
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
      // Scouting results stay in the evidence across re-evaluations (RFC §10.7: observed beats modelled).
      const scouted = ((existing.evidence as Array<{ kind?: string }>) ?? []).filter(
        (e) => e.kind === "scouting",
      );
      await tx.recommendation.update({
        where: { id: existing.id },
        data: {
          ...data,
          ...(scouted.length
            ? {
                evidence: [
                  ...(data.evidence as unknown as unknown[]),
                  ...scouted,
                ] as unknown as Prisma.InputJsonValue,
              }
            : {}),
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
