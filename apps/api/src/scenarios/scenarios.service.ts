import { createHash } from "node:crypto";
import { Worker } from "node:worker_threads";
import { Inject, Injectable, Logger } from "@nestjs/common";
import type { Library } from "@terrasight/library";
import { stableStringify } from "@terrasight/evaluators";
import {
  ENGINE_VERSION,
  planSeasons,
  splitRotations,
  unevaluableCrops,
  weatherRuns,
  withEt0,
  yieldRange,
  type EngineInput,
  type EngineResult,
  type Rotation,
} from "@terrasight/scenario-engine";
import type { HydGroup, WeatherDay } from "@terrasight/simulator";
import {
  soilFromTexture,
  type DailyWeather as PowerSeries,
  type SoilGridsSummary,
  type SoilSummary,
} from "@terrasight/sources";
import { CROPS } from "@terrasight/simulator";
import { ENV, type Env } from "../config/config.js";
import { PrismaService } from "../db/prisma.service.js";
import type { Prisma } from "../generated/prisma/client.js";
import { GeoService } from "../geo/geo.service.js";
import { matchBaseline } from "../history/compute.js";
import { ProblemException } from "../http/problem.js";
import { LIBRARY } from "../library/library.module.js";
import { SeasonsService } from "../seasons/seasons.service.js";
import { SourcesService } from "../sources/sources.service.js";
import {
  AiRotationsService,
  doubleCropPairs,
  irrigationOnlyCrops,
  toRotations,
  type AiStatus,
  type HistoryEntry,
  type Proposal,
  type ProposalContext,
} from "./ai-rotations.service.js";

/** How the inputs were obtained: shown in the UI so estimates are never presented as measurements. */
export interface InputMeta {
  /** baseline = matched a library rotation; detected = from confirmed history; estimated = satellite guess only; missing = nothing. */
  currentBasis: "baseline" | "detected" | "estimated" | "missing";
  currentSequence: EngineInput["current"]["sequence"];
  soilBasis: "ssurgo" | "soilgrids" | "default";
  lastSeason: number;
  /** Library crops left out because the simulator has no parameters for them (rotations with them do not compete). */
  unmodelled?: string[];
}

export interface Overrides {
  waterCapMm?: number;
  deltaT?: number;
  precipFactor?: number;
}

/** Soil organic carbon assumed at the start when no measurement exists, t C/ha (0–30 cm, Great Plains cropland). */
const DEFAULT_SOIL_C = 45;
const WORKER_TIMEOUT_MS = 60_000;

/** Season windows by harvest year from a POWER daily series: 1 Sep (year−1) → 31 Aug (north); 1 Jul → 30 Jun (south). */
export function seasonWindows(power: PowerSeries, southern: boolean): Map<number, WeatherDay[]> {
  const v = power.values;
  const out = new Map<number, WeatherDay[]>();
  power.dates.forEach((date, i) => {
    const tmin = v.T2M_MIN[i];
    const tmax = v.T2M_MAX[i];
    const precip = v.PRECTOTCORR[i];
    if (tmin == null || tmax == null || precip == null) return;
    const y = Number(date.slice(0, 4));
    const m = Number(date.slice(5, 7));
    const harvestYear = southern ? (m >= 7 ? y + 1 : y) : m >= 9 ? y + 1 : y;
    (out.get(harvestYear) ?? out.set(harvestYear, []).get(harvestYear)!).push({
      date,
      tmin,
      tmax,
      precip,
      rh: v.RH2M[i] ?? null,
      rs: v.ALLSKY_SFC_SW_DWN[i] ?? null,
      u2: v.WS2M[i] ?? null,
    });
  });
  for (const [y, days] of out) if (days.length < 360) out.delete(y); // only complete seasons
  return out;
}

/** Rotation scenarios for a field (RFC D4–D5, Tech Design §9): inputs from the gathered sources, cached by inputs hash. */
@Injectable()
export class ScenariosService {
  private readonly log = new Logger(ScenariosService.name);
  private readonly yieldCache = new Map<string, ReturnType<typeof yieldRange>>();

  constructor(
    @Inject(ENV) private readonly env: Env,
    @Inject(LIBRARY) private readonly lib: Library,
    private readonly prisma: PrismaService,
    private readonly sources: SourcesService,
    private readonly geo: GeoService,
    private readonly seasons: SeasonsService,
    private readonly ai: AiRotationsService,
  ) {}

  /** Builds the engine input; null fields mean "No rotation library for this region yet". */
  async inputs(workspaceId: string, fieldId: string, o: Overrides): Promise<EngineInput> {
    return (await this.build(workspaceId, fieldId, o)).input;
  }

  private async build(
    workspaceId: string,
    fieldId: string,
    o: Overrides,
  ): Promise<{ input: EngineInput; meta: InputMeta; aiCtx: ProposalContext | null }> {
    const field = await this.prisma.db.field.findFirst({
      where: { id: fieldId, workspaceId, archivedAt: null },
      select: { id: true, regionId: true, irrigation: true, slopePct: true, tier: true },
    });
    if (!field) throw new ProblemException(404, "not-found");
    const region = field.regionId ? this.lib.rotations.regions[field.regionId] : undefined;
    const southern = region?.hemisphere === "S";
    const geom = await this.geo.fieldGeometry(fieldId);
    const today = new Date().toISOString().slice(0, 10);
    const [power, soil, soilGrids] = await Promise.all([
      this.sources.fresh<PowerSeries>("power", geom, today, async () => undefined),
      this.sources.fresh<SoilSummary>("ssurgo", geom, today, async () => undefined),
      this.sources.fresh<SoilGridsSummary>("soilgrids", geom, today, async () => undefined),
    ]);
    if (!power?.result.payload)
      throw new ProblemException(409, "weather-missing", "Weather for this field is not gathered yet");
    const s = soil?.result.payload;
    // Outside the US there is no SSURGO: the SoilGrids texture gives a class-typical water capacity (an estimate).
    const tex = soilGrids?.result.payload ? soilFromTexture(soilGrids.result.payload) : null;
    const aws = s?.aws100Mm ?? (s?.awsMm != null ? (s.awsMm * 2) / 3 : (tex?.awsMmPerM ?? null));
    const site = {
      latDeg: geom.centroid.lat,
      elevationM: power.result.payload.elevationM ?? 500,
      awsMmPerM: aws ?? 150,
      hydGroup: ((s?.hydrologicGroup?.[0] ?? tex?.hydrologicGroup ?? "B") as HydGroup) || "B",
      slopePct: field.slopePct ?? 1,
    };

    const crops = await this.prisma.system.cropSeason.findMany({
      where: { fieldId },
      orderBy: { season: "asc" },
    });
    const first = this.env.PLAN_FIRST_SEASON;
    const rotations = (field.regionId
      ? this.lib.rotations.rotations.filter((r) => r.region === field.regionId)
      : []) as unknown as Rotation[];
    // Satellite-only guesses (NDVI curve shape) never claim a library rotation: the current one is then "estimated".
    const recentConfirmed = crops.slice(-3).some((c) => c.source !== "ndvi");
    const match = matchBaseline(
      crops
        .filter((c) => recentConfirmed || c.source !== "ndvi")
        .map((c) => ({
          season: c.season,
          mainCrop: c.mainCrop,
          secondCrop: c.secondCrop,
          confidence: c.confidence,
          source: c.source as never,
          isOverride: c.isOverride,
        })),
      this.lib,
      field.regionId,
    );
    const lastSeason = crops.at(-1)?.season ?? first - 1;
    const gap = Math.max(0, first - lastSeason - 1);
    const baseline = match.rotationId ? rotations.find((r) => r.id === match.rotationId) : undefined;
    const detected = match.detected
      .slice(-4)
      .map((d) => (d.includes("+") ? { main: d.split("+")[0]!, second: d.split("+")[1]! } : d));
    const basis: InputMeta["currentBasis"] = !crops.length
      ? "missing"
      : baseline
        ? "baseline"
        : recentConfirmed
          ? "detected"
          : "estimated";
    const current: EngineInput["current"] = baseline
      ? {
          rotationId: baseline.id,
          sequence: baseline.sequence,
          position: ((match.position ?? 0) + gap) % baseline.sequence.length,
          label: "baseline",
        }
      : {
          rotationId: null,
          sequence: detected.length ? detected : ["fallow"],
          position: gap % Math.max(1, detected.length),
          label: "detected",
        };

    const irrigated = field.irrigation === "irrigated";
    const regionPrices = field.regionId ? (this.lib.prices.regions[field.regionId]?.crops ?? {}) : {};
    const prices: EngineInput["prices"] = {};
    for (const [crop, e] of Object.entries(regionPrices)) {
      if (!e.verified) continue;
      const irr = { variableCost: e.variableCost.value, yieldRef: e.yieldRef.value };
      const dry = e.dryland
        ? { variableCost: e.dryland.variableCost.value, yieldRef: e.dryland.yieldRef.value }
        : irr;
      const pick = irrigated && irr.variableCost != null ? irr : dry.variableCost != null ? dry : irr;
      if (e.price.value == null || pick.variableCost == null || pick.yieldRef == null) continue;
      prices[crop] = { price: e.price.value, variableCost: pick.variableCost, yieldRef: pick.yieldRef };
    }
    const pestModels = this.lib.enabledModels.flatMap((m) => {
      const tree = m.tree as { kind?: string; host?: string[]; seasons?: { ref?: string } };
      if (tree.kind !== "host_repeat" || !tree.host) return [];
      const t = tree.seasons?.ref ? m.thresholds[tree.seasons.ref] : undefined;
      return t?.value != null ? [{ pest: m.pest, hosts: tree.host, repeatSeasons: t.value }] : [];
    });
    const input: EngineInput = {
      fieldKey: fieldId,
      site,
      irrigated,
      firstSeason: first,
      southern,
      rotations,
      current,
      weatherByYear: new Map(
        [...seasonWindows(power.result.payload, southern).entries()].map(([y, d]) => [y, withEt0(d, site)]),
      ),
      sowing: this.seasons.sowingCalendar(field.regionId),
      prices,
      soilCarbon: DEFAULT_SOIL_C,
      ...(o.waterCapMm !== undefined ? { waterCapMm: o.waterCapMm } : {}),
      ...(o.deltaT ? { deltaT: o.deltaT } : {}),
      ...(o.precipFactor && o.precipFactor !== 1 ? { precipFactor: o.precipFactor } : {}),
      pestModels,
      history: crops.slice(-3).map((c) => c.mainCrop),
    };
    const soilBasis: InputMeta["soilBasis"] = s ? "ssurgo" : tex ? "soilgrids" : "default";
    const aiCtx = region
      ? this.proposalContext(input, field.regionId!, region, field.tier, soilBasis, basis, crops)
      : null;
    return {
      input,
      meta: { currentBasis: basis, currentSequence: input.current.sequence, soilBasis, lastSeason },
      aiCtx,
    };
  }

  /** What the assistant is told about the field (and what its proposals are checked against). No name, no coordinates. */
  private proposalContext(
    input: EngineInput,
    regionId: string,
    region: Library["rotations"]["regions"][string],
    tier: "A" | "B" | "C",
    soilBasis: string,
    currentBasis: string,
    crops: Array<{ season: number; mainCrop: string; secondCrop: string | null; source: string; isOverride: boolean }>,
  ): ProposalContext {
    const irrOnly = irrigationOnlyCrops(this.lib.rotations.rotations);
    const allowed = Object.keys(input.prices)
      .filter((c) => CROPS[c] && this.lib.rotations.crops[c] && (input.irrigated || !irrOnly.includes(c)))
      .sort()
      .map((id) => ({ id, name: this.lib.rotations.crops[id]!.en }));
    const usable = splitRotations(input.rotations, input.prices).usable;
    const years = [...input.weatherByYear.values()].filter((d) => d.length >= 360);
    const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
    const names = new Map(
      this.lib.rotations.rotations.map((r) => [r.id, (r as unknown as { name: { en: string } }).name.en]),
    );
    const sources = { cdl: "cdl", lpis: "lpis", ndvi: "estimate", user: "agronomist" } as const;
    const history: HistoryEntry[] = crops.slice(-5).map((c) => ({
      season: c.season,
      crop: c.mainCrop,
      ...(c.secondCrop ? { second: c.secondCrop } : {}),
      source: c.isOverride ? "agronomist" : (sources[c.source as keyof typeof sources] ?? "estimate"),
    }));
    return {
      regionId,
      regionName: { en: region.en, uk: region.uk },
      countries: region.countries,
      tier,
      irrigated: input.irrigated,
      southern: !!input.southern,
      firstSeason: input.firstSeason,
      soil: {
        waterCapacityMmPerM: Math.round(input.site.awsMmPerM),
        hydrologicGroup: input.site.hydGroup ?? "unknown",
        basis: soilBasis,
      },
      climate: years.length
        ? {
            meanSeasonRainfallMm: Math.round(mean(years.map((d) => d.reduce((a, x) => a + x.precip, 0)))),
            meanSeasonTempC:
              Math.round(mean(years.map((d) => mean(d.map((x) => (x.tmin + x.tmax) / 2)))) * 10) / 10,
            weatherYears: years.length,
          }
        : null,
      history,
      currentRotation: { basis: currentBasis, sequence: input.current.sequence },
      allowed,
      irrigationOnly: irrOnly,
      doubleCrops: doubleCropPairs(usable),
      libraryExamples: usable
        .filter((r) => input.irrigated || r.irrigation !== "required")
        .slice(0, 8)
        .map((r) => ({ name: names.get(r.id) ?? r.id, sequence: r.sequence })),
      pestModels: input.pestModels ?? [],
      existingPlans: [
        ...input.rotations.map((r) => planSeasons(r.sequence, 0, input.firstSeason)),
        planSeasons(input.current.sequence, input.current.position, input.firstSeason),
      ].map((plan) => plan.map((p) => p.crops.join("+") || "fallow").join(",")),
    };
  }

  /** Runs (or reuses) the scenarios for a field with the given overrides. */
  async run(workspaceId: string, fieldId: string, o: Overrides, aiMode: "generate" | "cached" = "generate") {
    const { input: full, meta, aiCtx } = await this.build(workspaceId, fieldId, o);
    if (!full.rotations.length) return { id: null, noLibrary: true as const };
    const missing = [
      ...new Set(
        full.rotations.flatMap((r) =>
          r.sequence.flatMap((s) => (typeof s === "string" ? [s] : [s.main, s.second])),
        ),
      ),
    ].filter((c) => c !== "fallow" && !full.prices[c]);
    const split = splitRotations(full.rotations, full.prices);
    // Never invent the current rotation, never rank on missing prices: say what is missing instead.
    if (meta.currentBasis === "missing") return this.pending("crop-history", full, meta, missing);
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
    if (!split.usable.length || !currentOk) {
      return this.pending(
        split.unpriced.length || bad.some((c) => !full.prices[c]) ? "prices" : "crops",
        full,
        meta,
        missing,
        split.unmodelled,
      );
    }
    meta.unmodelled = split.unmodelled;
    // AI proposals join the library candidates and go through the same engine path (numbers come only from the engine).
    const ai: { status: AiStatus; proposals: Proposal[] } = aiCtx
      ? await this.ai.propose(aiCtx, aiMode)
      : { status: "skipped", proposals: [] };
    const input: EngineInput = {
      ...full,
      rotations: [...split.usable, ...toRotations(ai.proposals, full.irrigated)],
    };
    const hash = createHash("sha256")
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
    const cached = await this.prisma.system.scenarioRun.findUnique({
      where: { fieldId_inputsHash: { fieldId, inputsHash: hash } },
    });
    if (cached)
      return this.view(
        cached.id,
        cached.result as unknown as EngineResult,
        cached.createdAt,
        cached.durationMs,
        missing,
        input,
        meta,
        ai,
      );
    const t0 = Date.now();
    const result = await this.inWorker(input);
    const durationMs = Date.now() - t0;
    const row = await this.prisma.system.scenarioRun.create({
      data: {
        fieldId,
        inputsHash: hash,
        libraryVersions: this.lib.versions as unknown as Prisma.InputJsonValue,
        result: result as unknown as Prisma.InputJsonValue,
        durationMs,
      },
    });
    this.log.log(`scenarios for ${fieldId}: ${result.candidates} candidates in ${durationMs} ms`);
    return this.view(row.id, result, row.createdAt, durationMs, missing, input, meta, ai);
  }

  /** Nothing is simulated: the agronomist sees what is missing (prices awaiting verification, or the last crops). */
  private pending(
    reason: "prices" | "crop-history" | "crops",
    input: EngineInput,
    meta: InputMeta,
    missingPrices: string[],
    unmodelled: string[] = [],
  ) {
    const regionId =
      this.lib.rotations.rotations.find((x) => x.id === input.rotations[0]?.id)?.region ?? null;
    const regionPrices = regionId ? (this.lib.prices.regions[regionId]?.crops ?? {}) : {};
    const unverified = Object.entries(regionPrices)
      .filter(([, e]) => !e.verified)
      .map(([c]) => c);
    return {
      id: null,
      noLibrary: false as const,
      pending: reason,
      firstSeason: input.firstSeason,
      regionId,
      regionVerify: regionId ? (this.lib.rotations.regions[regionId]?.verify ?? false) : false,
      missingPrices,
      unverifiedPrices: unverified,
      unmodelledCrops: unmodelled,
      priceAsOf: [...new Set(Object.values(regionPrices).map((p) => p.asOf))].join(", "),
      currentBasis: meta.currentBasis,
      currentSequence: meta.currentSequence,
      lastSeason: meta.lastSeason,
      soilBasis: meta.soilBasis,
      cropNames: Object.fromEntries(
        Object.entries(this.lib.rotations.crops).map(([id, c]) => [id, { en: c.en, uk: c.uk }]),
      ),
      candidates: input.rotations.map((r) => ({
        id: r.id,
        sequence: r.sequence,
        name: (
          this.lib.rotations.rotations.find((x) => x.id === r.id) as unknown as
            { name: { en: string; uk: string } } | undefined
        )?.name ?? { en: r.id, uk: r.id },
      })),
    };
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
      this.prisma.system.plan.findUnique({ where: { fieldId_season: { fieldId, season } } }),
      this.prisma.system.recommendation.findFirst({
        where: {
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
    const row = await this.prisma.system.scenarioRun.findFirst({
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
    // Names and reasons of the assistant's options; all their numbers are already in the engine result.
    const decorate = <T extends { id: string }>(s: T) =>
      proposed.has(s.id) ? { ...s, source: "ai" as const, rationale: proposed.get(s.id)!.rationale } : s;
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
      currentBasis: meta.currentBasis,
      currentSequence: meta.currentSequence,
      lastSeason: meta.lastSeason,
      soilBasis: meta.soilBasis,
      priceAsOf: [...new Set(Object.values(regionPrices).map((p) => p.asOf))].join(", "),
      cropNames: Object.fromEntries(
        Object.entries(this.lib.rotations.crops).map(([id, c]) => [id, { en: c.en, uk: c.uk }]),
      ),
      aiStatus: ai.status,
      names: Object.fromEntries(
        input.rotations.map((r) => [
          r.id,
          proposed.get(r.id)?.name ??
          (
            this.lib.rotations.rotations.find((x) => x.id === r.id) as unknown as
              { name: { en: string; uk: string } } | undefined
          )?.name ?? { en: r.id, uk: r.id },
        ]),
      ),
      result: { ...result, alternatives: result.alternatives.map(decorate) },
    };
  }

  private inWorker(input: EngineInput): Promise<EngineResult> {
    return new Promise((resolve, reject) => {
      const w = new Worker(new URL("./scenario.worker.js", import.meta.url), { workerData: input });
      const timer = setTimeout(() => {
        void w.terminate();
        reject(new ProblemException(503, "scenarios-timeout", "The scenario run took too long"));
      }, WORKER_TIMEOUT_MS);
      w.once("message", (r: EngineResult) => {
        clearTimeout(timer);
        resolve(r);
        void w.terminate();
      });
      w.once("error", (e) => {
        clearTimeout(timer);
        reject(e);
      });
    });
  }

  /**
   * The rotation recommendation (S-03.08): after the history build and every autumn recompute, a planning item with the
   * best-fit option's first crop, key numbers from the scenarios (Tech Design §9.2) and the next crop's sowing date as
   * the default deadline. Returns whether the item is new.
   */
  async upsertRecommendation(workspaceId: string, fieldId: string, runId: string | null): Promise<boolean> {
    const view = await this.run(workspaceId, fieldId, {}, "cached");
    if (view.noLibrary || !("result" in view)) return false;
    const { result, firstSeason, regionId } = view;
    const all = [result.current, ...result.alternatives];
    const best = all.find((s) => s.id === result.bestFit) ?? result.current;
    const firstCrop = best.plan[0]?.crops.find((c) => c !== "fallow") ?? best.plan[0]?.crops[0] ?? "fallow";
    const hostSeasons = (s: typeof best) => s.pestPressure.reduce((n, p) => Math.max(n, p.seasons), 0);
    const field = await this.prisma.system.field.findUniqueOrThrow({
      where: { id: fieldId },
      select: { tier: true },
    });
    const crops = await this.prisma.system.cropSeason.findMany({
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
      ...(alt
        ? [
            {
              id: "marginVsCurrent",
              value: Math.round(alt.delta.margin),
              unit: "$/ha",
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
          source:
            "Scenario engine (FAO-56, FAO-33, ICBM, RUSLE; NASA POWER 1981–2025; USDA NASS / K-State prices)",
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
      await this.prisma.system.recommendationLevel.create({
        data: { recommendationId: live.id, runId, level: data.level, confidence: data.confidence },
      });
      return false;
    }
    const rec = await this.prisma.system.recommendation.create({
      data: { workspaceId, fieldId, type: "rotation", subject: "rotation", season: firstSeason, ...data },
    });
    await this.prisma.system.recommendationLevel.create({
      data: { recommendationId: rec.id, runId, level: data.level, confidence: data.confidence },
    });
    return level === "moderate";
  }

  /** "Save to the 2026 plan" (S-06.06): the crop and rotation for the season; the season record reads it as "From plan". */
  async savePlan(
    workspaceId: string,
    userId: string,
    fieldId: string,
    season: number,
    body: { crop: string; rotationId?: string | null; scenarioRunId?: string | null },
  ) {
    const field = await this.prisma.db.field.findFirst({
      where: { id: fieldId, workspaceId, archivedAt: null },
      select: { id: true },
    });
    if (!field) throw new ProblemException(404, "not-found");
    if (!this.lib.rotations.crops[body.crop]) throw new ProblemException(422, "unknown-crop", "Unknown crop");
    const data = {
      crop: body.crop,
      rotationId: body.rotationId ?? null,
      scenarioRunId: body.scenarioRunId ?? null,
      savedBy: userId,
      savedAt: new Date(),
    };
    const plan = await this.prisma.system.plan.upsert({
      where: { fieldId_season: { fieldId, season } },
      create: { fieldId, season, ...data },
      update: data,
    });
    await this.prisma.db.auditLog.create({
      data: { workspaceId, userId, action: "plan.save", target: `${fieldId}:${season}:${body.crop}` },
    });
    return { season: plan.season, crop: plan.crop, rotationId: plan.rotationId, savedAt: plan.savedAt };
  }

  /** Rotations overview (sidebar "Rotations"): each field's plan for the first season and its rotation item. */
  async overview(workspaceId: string) {
    const season = this.env.PLAN_FIRST_SEASON;
    const fields = await this.prisma.db.field.findMany({
      where: { workspaceId, archivedAt: null },
      select: {
        id: true,
        name: true,
        aliasNo: true,
        regionId: true,
        irrigation: true,
        areaHa: true,
        countyName: true,
      },
      orderBy: { aliasNo: "asc" },
    });
    const ids = fields.map((f) => f.id);
    const [plans, recs, crops] = await Promise.all([
      this.prisma.system.plan.findMany({ where: { fieldId: { in: ids }, season } }),
      this.prisma.system.recommendation.findMany({
        where: {
          fieldId: { in: ids },
          type: "rotation",
          season,
          status: { in: ["open", "accepted", "snoozed", "in_report"] },
        },
      }),
      this.prisma.system.cropSeason.findMany({ where: { fieldId: { in: ids } }, orderBy: { season: "asc" } }),
    ]);
    return {
      season,
      horizon: [season, season + 4],
      cropNames: Object.fromEntries(
        Object.entries(this.lib.rotations.crops).map(([id, c]) => [id, { en: c.en, uk: c.uk }]),
      ),
      fields: fields.map((f) => {
        const plan = plans.find((p) => p.fieldId === f.id);
        const rec = recs.find((r) => r.fieldId === f.id);
        const drivers = ((rec?.drivers as Array<{ driver: string; value: unknown }>) ?? []).reduce<
          Record<string, unknown>
        >((a, d) => ({ ...a, [d.driver]: d.value }), {});
        return {
          fieldId: f.id,
          name: f.name,
          areaHa: f.areaHa,
          county: f.countyName,
          irrigation: f.irrigation,
          hasLibrary: Boolean(
            f.regionId && this.lib.rotations.rotations.some((r) => r.region === f.regionId),
          ),
          recent: crops
            .filter((c) => c.fieldId === f.id)
            .slice(-5)
            .map((c) => ({ season: c.season, crop: c.mainCrop })),
          plan: plan ? { crop: plan.crop, rotationId: plan.rotationId, savedAt: plan.savedAt } : null,
          recommendation: rec
            ? {
                id: rec.id,
                level: rec.level,
                firstCrop: (drivers.first_crop as string) ?? null,
                bestOption: (drivers.best_option as string) ?? null,
                deadline: rec.deadline?.toISOString().slice(0, 10) ?? null,
                keyNumbers: rec.keyNumbers,
              }
            : null,
        };
      }),
    };
  }

  async getPlan(workspaceId: string, fieldId: string, season: number) {
    const field = await this.prisma.db.field.findFirst({
      where: { id: fieldId, workspaceId },
      select: { id: true },
    });
    if (!field) throw new ProblemException(404, "not-found");
    const plan = await this.prisma.system.plan.findUnique({ where: { fieldId_season: { fieldId, season } } });
    return plan
      ? { season: plan.season, crop: plan.crop, rotationId: plan.rotationId, savedAt: plan.savedAt }
      : null;
  }
}
