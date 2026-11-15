import { createHash } from "node:crypto";
import { availableParallelism } from "node:os";
import { Worker } from "node:worker_threads";
import { Inject, Injectable, Logger, type OnModuleDestroy } from "@nestjs/common";
import type { Library } from "@terrasight/library";
import { stableStringify } from "@terrasight/evaluators";
import {
  ENGINE_VERSION,
  planSeasons,
  splitRotations,
  unevaluableCrops,
  weatherRuns,
  yieldRange,
  type EngineInput,
  type EngineResult,
} from "@terrasight/scenario-engine";
import { CROPS } from "@terrasight/simulator";
import { ENV, type Env } from "../config/config.js";
import { PrismaService } from "../db/prisma.service.js";
import type { Prisma } from "../generated/prisma/client.js";
import { ProblemException } from "../http/problem.js";
import { fieldSuitability } from "../suitability/suitability.js";
import { LIBRARY } from "../library/library.module.js";
import { SeasonsService } from "../seasons/seasons.service.js";
import { AiRotationsService, toRotations, type AiStatus, type Proposal } from "./ai-rotations.service.js";
import { PoolBusyError, WorkerPool, WorkerTimeoutError } from "./worker-pool.js";

import { priceLabel } from "./price-resolution.js";
import { priceBasisText, runDataBasis } from "./scenario-basis.js";
import { pendingView } from "./scenario-pending.js";
import { ScenarioInputsService, type InputMeta, type Overrides } from "./scenario-inputs.service.js";
import { ScenarioPlansService } from "./scenario-plans.service.js";

const WORKER_TIMEOUT_MS = 60_000;

export { seasonWindows, type InputMeta, type Overrides } from "./scenario-inputs.service.js";

/** Pool size: SCENARIO_WORKERS, else all cores but one (the API's event loop keeps one). */
export function scenarioPoolSize(raw = process.env.SCENARIO_WORKERS): number {
  const n = Math.floor(Number(raw));
  return n >= 1 ? n : Math.max(1, availableParallelism() - 1);
}

/** Rotation scenarios for a field (RFC D4–D5, Tech Design §9): inputs from the gathered sources, cached by inputs hash. */
@Injectable()
export class ScenariosService implements OnModuleDestroy {
  private readonly log = new Logger(ScenariosService.name);
  private readonly yieldCache = new Map<string, ReturnType<typeof yieldRange>>();
  private pool: WorkerPool<EngineInput, EngineResult> | null = null;

  constructor(
    @Inject(ENV) private readonly env: Env,
    @Inject(LIBRARY) private readonly lib: Library,
    private readonly prisma: PrismaService,
    private readonly seasons: SeasonsService,
    private readonly ai: AiRotationsService,
    private readonly inputsSvc: ScenarioInputsService,
    private readonly plansSvc: ScenarioPlansService,
  ) {}

  /** Builds the engine input; null fields mean "No rotation library for this region yet". */
  inputs(workspaceId: string, fieldId: string, o: Overrides): Promise<EngineInput> {
    return this.inputsSvc.inputs(workspaceId, fieldId, o);
  }

  savePlan(...args: Parameters<ScenarioPlansService["savePlan"]>) {
    return this.plansSvc.savePlan(...args);
  }

  overview(workspaceId: string) {
    return this.plansSvc.overview(workspaceId);
  }

  getPlan(workspaceId: string, fieldId: string, season: number) {
    return this.plansSvc.getPlan(workspaceId, fieldId, season);
  }

  async run(workspaceId: string, fieldId: string, o: Overrides, aiMode: "generate" | "cached" = "generate") {
    const prep = await this.prepare(workspaceId, fieldId, o, aiMode);
    if (prep.early) return prep.early;
    const { input, meta, ai, missing } = prep;
    const row = await this.execute(fieldId, input);
    return this.view(row.id, row.result, row.createdAt, row.durationMs, missing, input, meta, ai);
  }

  /**
   * Everything before the engine: suitability, inputs, the evaluable candidates, agronomy-only fallback and the
   * assistant's proposals. `early` is a view that needs no run (unsuitable land, no library, missing data).
   */
  async prepare(workspaceId: string, fieldId: string, o: Overrides, aiMode: "generate" | "cached" = "generate") {
    // Unsuitable land (not overridden): the page explains why instead of showing options.
    const suitability = await fieldSuitability(this.prisma.system, fieldId);
    if (suitability?.blocked)
      return { early: { id: null, landUnsuitable: true as const, suitability } };
    const { input: full, meta, aiCtx, power } = await this.inputsSvc.build(workspaceId, fieldId, o);
    if (!full.rotations.length) return { early: { id: null, noLibrary: true as const } };
    const missing = [
      ...new Set(
        full.rotations.flatMap((r) =>
          r.sequence.flatMap((s) => (typeof s === "string" ? [s] : [s.main, s.second])),
        ),
      ),
    ].filter((c) => c !== "fallow" && !full.prices[c]);
    const split = splitRotations(full.rotations, full.prices);
    // Never invent the current rotation, never rank on missing prices: say what is missing instead.
    if (meta.currentBasis === "missing")
      return { early: pendingView(this.lib, "crop-history", full, meta, missing) };
    // Only rotations whose every crop has a verified price compete (a missing price would count as $0 revenue).
    const bad = unevaluableCrops(full.current.sequence, full.prices);
    const curAll = new Set(
      full.current.sequence.flatMap((x) => (typeof x === "string" ? [x] : [x.main, x.second])),
    );
    // A library rotation as "current" must be fully evaluable; a detected one only needs some evaluable crop.
    // Detected land use with no farm crop at all (grassland, developed, "other:<CDL class>") is compared as
    // "no crop" (all seasons fallow, margin 0) instead of blocking the comparison.
    const libraryCrops = new Set(Object.keys(this.lib.rotations.crops));
    const noFarmCrop =
      full.current.label !== "baseline" && [...curAll].every((c) => c === "fallow" || !libraryCrops.has(c));
    if (noFarmCrop) full.current = { ...full.current, sequence: full.current.sequence.map(() => "fallow") };
    const currentOk =
      full.current.label === "baseline"
        ? bad.length === 0
        : noFarmCrop || [...curAll].some((c) => !bad.includes(c) && c !== "fallow");
    let agronomyOnly = false;
    let candidates = split.usable;
    if (!candidates.length || !currentOk) {
      // Margin cannot be computed (a crop has no price): still run water, soil, erosion, drought resilience and pests.
      // Only crops the simulator has parameters for can take part; nothing monetary is simulated or shown.
      const modelled = splitRotations(full.rotations, {}, false);
      const currentModelled =
        full.current.label === "baseline"
          ? [...curAll].every((c) => c === "fallow" || CROPS[c])
          : noFarmCrop || [...curAll].some((c) => c !== "fallow" && CROPS[c]);
      if (!modelled.usable.length || !currentModelled)
        return { early: pendingView(this.lib, "crops", full, meta, missing, modelled.unmodelled) };
      agronomyOnly = true;
      candidates = modelled.usable;
      split.unmodelled = modelled.unmodelled;
      full.yieldRefs = {
        ...full.yieldRefs,
        ...Object.fromEntries(Object.entries(full.prices).map(([c, e]) => [c, e.yieldRef])),
      };
      full.prices = {};
      full.agronomyOnly = true;
    }
    meta.unmodelled = split.unmodelled;
    // AI proposals join the library candidates and go through the same engine path (numbers come only from the engine).
    // Without prices the assistant proposes nothing (its crop list comes from the priced crops).
    const ai: { status: AiStatus; proposals: Proposal[] } =
      aiCtx && !agronomyOnly ? await this.ai.propose(aiCtx, aiMode) : { status: "skipped", proposals: [] };
    const input: EngineInput = {
      ...full,
      rotations: [...candidates, ...toRotations(ai.proposals, full.irrigated)],
    };
    return { input, meta, ai, missing, power };
  }

  /** Inputs hash of a run: everything the engine reads, the library versions and the engine version. */
  inputsHash(input: EngineInput): string {
    return createHash("sha256")
      .update(
        stableStringify({
          ...input,
          weatherByYear: [...input.weatherByYear.keys()],
          weatherDate: input.weatherByYear.get(Math.max(...input.weatherByYear.keys()))?.at(-1)?.date,
          versions: this.lib.versions,
          engine: ENGINE_VERSION,
        }),
      )
      .digest("hex");
  }

  /** The stored run of these inputs, if it is current (a result made before `if2022BySeason` existed is not). */
  async cachedRun(fieldId: string, input: EngineInput) {
    const row = await this.prisma.db.scenarioRun.findUnique({
      where: { fieldId_inputsHash: { fieldId, inputsHash: this.inputsHash(input) } },
    });
    const result = row?.result as unknown as EngineResult | undefined;
    if (!row || !result || !Array.isArray(result.current?.if2022BySeason) || !result.weather) return null;
    return { id: row.id, result, createdAt: row.createdAt, durationMs: row.durationMs };
  }

  /** True when no scenario job is running or waiting (heavy work that nobody asked for may start). */
  poolIdle(): boolean {
    return !this.pool || (this.pool.busy === 0 && this.pool.queued === 0);
  }

  /** Cached run of these inputs, else computed on the worker pool and stored. */
  async execute(fieldId: string, input: EngineInput) {
    const cached = await this.cachedRun(fieldId, input);
    if (cached) return cached;
    const hash = this.inputsHash(input);
    const t0 = Date.now();
    const result = await this.inWorker(input);
    const durationMs = Date.now() - t0;
    const data = {
      libraryVersions: this.lib.versions as unknown as Prisma.InputJsonValue,
      result: result as unknown as Prisma.InputJsonValue,
      durationMs,
    };
    const row = await this.prisma.db.scenarioRun.upsert({
      where: { fieldId_inputsHash: { fieldId, inputsHash: hash } },
      create: { fieldId, inputsHash: hash, ...data },
      update: { ...data, createdAt: new Date() },
    });
    this.log.log(`scenarios for ${fieldId}: ${result.candidates} candidates in ${durationMs} ms`);
    return { id: row.id, result, createdAt: row.createdAt, durationMs };
  }

  /**
   * Yield range P10 / P50 / P90 for the planned crop of the first season (FR-YF-1) from the same inputs and the same
   * 150 block-bootstrap weather runs as the scenarios. Crop: saved plan, else the rotation recommendation's first
   * crop, else the current rotation's next crop. Pest losses are not modelled.
   */
  async yieldRange(workspaceId: string, fieldId: string) {
    const input = await this.inputs(workspaceId, fieldId, {});
    if (!input.rotations.length) return { noLibrary: true as const };
    const season = input.firstSeason;
    const [plan, rec] = await Promise.all([
      this.prisma.db.plan.findUnique({ where: { fieldId_season: { fieldId, season } } }),
      this.prisma.db.recommendation.findFirst({
        where: {
          workspaceId,
          fieldId,
          type: "rotation",
          subject: "rotation",
          season,
          status: { in: ["open", "accepted", "snoozed", "in_report"] },
        },
      }),
    ]);
    const recCrop = ((rec?.drivers as Array<{ driver: string; value: unknown }> | null) ?? []).find(
      (d) => d.driver === "first_crop",
    )?.value;
    const currentFirst = planSeasons(input.current.sequence, input.current.position, season)[0]?.crops[0];
    const [crop, source] = plan?.crop
      ? ([plan.crop, "plan"] as const)
      : typeof recCrop === "string"
        ? ([recCrop, "recommendation"] as const)
        : ([currentFirst, "current-rotation"] as const);
    const base = {
      noLibrary: false as const,
      season,
      source,
      cropNames: this.lib.rotations.crops[crop ?? ""] ?? null,
    };
    if (!crop) return { ...base, crop: null, range: null, yieldRef: null };
    const key = createHash("sha256")
      .update(
        stableStringify({
          ...input,
          weatherByYear: [...input.weatherByYear.keys()],
          weatherDate: input.weatherByYear.get(Math.max(...input.weatherByYear.keys()))?.at(-1)?.date,
          crop,
          engine: ENGINE_VERSION,
        }),
      )
      .digest("hex");
    let range = this.yieldCache.get(key);
    if (range === undefined) {
      range = yieldRange(input, [{ season, crops: [crop] }], weatherRuns(input));
      this.yieldCache.set(key, range);
      if (this.yieldCache.size > 200) this.yieldCache.delete(this.yieldCache.keys().next().value!);
    }
    return { ...base, crop, range, yieldRef: input.prices[crop]?.yieldRef ?? null };
  }

  async get(workspaceId: string, fieldId: string, runId: string) {
    const row = await this.prisma.db.scenarioRun.findFirst({
      where: { id: runId, fieldId, field: { workspaceId } },
    });
    if (!row) throw new ProblemException(404, "not-found");
    return { id: row.id, result: row.result, createdAt: row.createdAt, durationMs: row.durationMs };
  }

  private view(
    id: string,
    result: EngineResult,
    createdAt: Date,
    durationMs: number,
    missingPrices: string[],
    input: EngineInput,
    meta: InputMeta,
    ai: { status: AiStatus; proposals: Proposal[] },
  ) {
    const regionId =
      this.lib.rotations.rotations.find((x) => x.id === input.rotations[0]?.id)?.region ?? null;
    const regionPrices = regionId ? (this.lib.prices.regions[regionId]?.crops ?? {}) : {};
    const proposed = new Map(ai.proposals.map((p) => [p.id, p]));
    const usedCrops = [result.current, ...result.alternatives].flatMap((s) => s.plan.flatMap((p) => p.crops));
    const label = priceLabel(meta.priceSources, usedCrops);
    // Names and reasons of the assistant's options; all their numbers are already in the engine result.
    const decorate = <T extends { id: string }>(s: T) =>
      proposed.has(s.id)
        ? {
            ...s,
            source: "ai" as const,
            rationale: proposed.get(s.id)!.rationale,
            aiMeta: proposed.get(s.id)!.meta ?? null,
          }
        : s;
    return {
      id,
      noLibrary: false as const,
      createdAt,
      durationMs,
      firstSeason: input.firstSeason,
      irrigated: input.irrigated,
      regionId,
      regionVerify: regionId ? (this.lib.rotations.regions[regionId]?.verify ?? false) : false,
      missingPrices,
      unmodelledCrops: meta.unmodelled ?? [],
      pending: null,
      mode: result.mode ?? "money",
      currency: meta.currency,
      priceSources: meta.priceSources,
      priceLabel: label,
      /** In words, derived from the sources of the used crops (library values are typed in from cited reports). */
      priceBasis: priceBasisText(label, usedCrops, regionPrices),
      weather: { ...result.weather, lastDate: meta.weatherLastDate },
      dataBasis: runDataBasis({
        weather: result.weather,
        firstDate: input.weatherByYear.get(result.weather.from)?.[0]?.date ?? null,
        lastBootstrapDate: input.weatherByYear.get(result.weather.to)?.at(-1)?.date ?? null,
        lastDate: meta.weatherLastDate,
        stress2022: result.current.if2022BySeason?.some((x) => x != null) ?? false,
        soilBasis: meta.soilBasis,
        history: meta.historyRead,
      }),
      needYield: meta.needYield,
      yieldHints: meta.yieldHints,
      /** Modelled crops of the library rotations (and the current one) that have no price yet: the price form lists them. */
      cropsNeedingPrices: this.cropsNeedingPrices(input, meta, missingPrices),
      currentBasis: meta.currentBasis,
      currentSequence: meta.currentSequence,
      lastSeason: meta.lastSeason,
      soilBasis: meta.soilBasis,
      priceAsOf: [...new Set(Object.values(regionPrices).map((p) => p.asOf))].join(", "),
      cropNames: Object.fromEntries(
        Object.entries(this.lib.rotations.crops).map(([id, c]) => [id, { en: c.en, uk: c.uk }]),
      ),
      aiStatus: ai.status,
      names: this.namesOf(input, ai.proposals),
      result: { ...result, alternatives: result.alternatives.map(decorate) },
    };
  }

  /** Display names of the rotations of an input: the assistant's own name for its proposals, else the library's. */
  namesOf(input: EngineInput, proposals: Proposal[]): Record<string, { en: string; uk: string }> {
    const proposed = new Map(proposals.map((p) => [p.id, p]));
    return Object.fromEntries(
      input.rotations.map((r) => [
        r.id,
        proposed.get(r.id)?.name ??
          (
            this.lib.rotations.rotations.find((x) => x.id === r.id) as unknown as
              { name: { en: string; uk: string } } | undefined
          )?.name ?? { en: r.id, uk: r.id },
      ]),
    );
  }

  /** Crops the simulator can model that lack a usable price, for the candidate rotations: what the company can enter. */
  private cropsNeedingPrices(input: EngineInput, meta: InputMeta, missing: string[]): string[] {
    const wanted = new Set([...missing, ...meta.needYield]);
    return [...wanted].filter((c) => c !== "fallow" && CROPS[c] && !input.prices[c]).sort();
  }

  async onModuleDestroy(): Promise<void> {
    await this.pool?.close();
  }

  /** Runs the engine on a reusable worker thread from a fixed-size pool; extra runs wait in the pool's queue. */
  private async inWorker(input: EngineInput): Promise<EngineResult> {
    this.pool ??= new WorkerPool<EngineInput, EngineResult>(
      () => new Worker(new URL("./scenario.worker.js", import.meta.url)),
      { size: scenarioPoolSize(), timeoutMs: WORKER_TIMEOUT_MS },
    );
    try {
      return await this.pool.run(input);
    } catch (e) {
      if (e instanceof WorkerTimeoutError)
        throw new ProblemException(503, "scenarios-timeout", "The scenario run took too long");
      if (e instanceof PoolBusyError)
        throw new ProblemException(503, "scenarios-busy", "Too many scenario runs; try again shortly");
      this.log.error(`scenario worker failed: ${(e as Error).message}`);
      throw e;
    }
  }

  /**
   * The rotation recommendation (S-03.08): after the history build and every autumn recompute, a planning item with the
   * best-fit option's first crop, key numbers from the scenarios (Tech Design §9.2) and the next crop's sowing date as
   * the default deadline. Returns whether the item is new.
   */
  async upsertRecommendation(workspaceId: string, fieldId: string, runId: string | null): Promise<boolean> {
    const view = await this.run(workspaceId, fieldId, {}, "cached");
    if ("landUnsuitable" in view || view.noLibrary || !("result" in view)) return false;
    // A crop recommendation needs money: the agronomy-only comparison is shown on the page but never becomes an item.
    if (view.mode === "agronomy") return false;
    const { result, firstSeason, regionId } = view;
    const all = [result.current, ...result.alternatives];
    const best = all.find((s) => s.id === result.bestFit) ?? result.current;
    const firstCrop = best.plan[0]?.crops.find((c) => c !== "fallow") ?? best.plan[0]?.crops[0] ?? "fallow";
    const hostSeasons = (s: typeof best) => s.pestPressure.reduce((n, p) => Math.max(n, p.seasons), 0);
    const field = await this.prisma.system.field.findUniqueOrThrow({
      where: { id: fieldId },
      select: { tier: true },
    });
    const crops = await this.prisma.db.cropSeason.findMany({
      where: { fieldId },
      orderBy: { season: "desc" },
      take: 6,
    });
    let inRow = 0;
    for (const c of crops)
      if (c.mainCrop === crops[0]?.mainCrop) inRow++;
      else break;
    // Default deadline: the first crop's typical sowing date; with the fixed horizon (PLAN_FIRST_SEASON) it may already
    // be past, so the next such date counts.
    let deadline = this.seasons.typicalSowing(regionId, firstCrop, firstSeason);
    const today = new Date().toISOString().slice(0, 10);
    while (deadline && deadline < today) deadline = `${Number(deadline.slice(0, 4)) + 1}${deadline.slice(4)}`;
    const alt = result.alternatives[0];
    const keyNumbers = [
      { id: "hostSeasonsInPlan", value: `${hostSeasons(result.current)}/5`, weight: 1 },
      { id: "lastCropInRow", value: inRow, unit: "seasons", weight: 0.66 },
      ...(alt && alt.delta.margin != null
        ? [
            {
              id: "marginVsCurrent",
              value: Math.round(alt.delta.margin),
              unit: view.currency === "USD" ? "$/ha" : `${view.currency}/ha`,
              weight: 0.33,
              option: alt.id,
            },
          ]
        : []),
    ];
    const level = best.kind === "current" ? "low" : "moderate";
    const data = {
      level: level as "low" | "moderate",
      confidence: (field.tier === "A" ? "medium" : "low") as "medium" | "low",
      tier: field.tier,
      deadline: deadline ? new Date(`${deadline}T00:00:00Z`) : null,
      irreversible: false,
      planning: true,
      keyNumbers: keyNumbers as unknown as Prisma.InputJsonValue,
      drivers: [
        {
          driver: "best_option",
          value: best.kind === "current" ? "current" : best.id,
          fired: best.kind !== "current",
        },
        { driver: "first_crop", value: firstCrop, fired: true },
      ] as unknown as Prisma.InputJsonValue,
      evidence: [
        {
          source: `Scenario engine (FAO-56, FAO-33, ICBM, RUSLE; NASA POWER ${result.weather.from}–${result.weather.to}; ${
            ("priceBasis" in view ? view.priceBasis?.en : null) ?? "no prices"
          })`,
          from: String(result.weather.from),
          to: String(result.weather.to),
          value: runId ?? view.id ?? "",
          note: `${result.candidates + 1} rotations compared`,
        },
      ] as unknown as Prisma.InputJsonValue,
      unknowns: [] as unknown as Prisma.InputJsonValue,
      modelRef: `scenarios@${this.lib.versions.rotations}`,
      versions: this.lib.versions as unknown as Prisma.InputJsonValue,
    };
    const live = await this.prisma.system.recommendation.findFirst({
      where: {
        fieldId,
        type: "rotation",
        subject: "rotation",
        season: firstSeason,
        status: { in: ["open", "accepted", "snoozed", "in_report", "dismissed"] },
      },
    });
    if (live) {
      await this.prisma.system.recommendation.update({ where: { id: live.id }, data });
      await this.prisma.db.recommendationLevel.create({
        data: { recommendationId: live.id, runId, level: data.level, confidence: data.confidence },
      });
      return false;
    }
    const rec = await this.prisma.system.recommendation.create({
      data: { workspaceId, fieldId, type: "rotation", subject: "rotation", season: firstSeason, ...data },
    });
    await this.prisma.db.recommendationLevel.create({
      data: { recommendationId: rec.id, runId, level: data.level, confidence: data.confidence },
    });
    return level === "moderate";
  }
}
