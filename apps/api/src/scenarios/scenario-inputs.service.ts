import { Inject, Injectable } from "@nestjs/common";
import { loadUaYields, oblastYields, type Library, type UaYieldsFile } from "@terrasight/library";
import {
  planSeasons,
  splitRotations,
  withEt0,
  type EngineInput,
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
import { CropPricesService } from "../crop-prices/crop-prices.service.js";
import { GeoService } from "../geo/geo.service.js";
import { matchBaseline } from "../history/compute.js";
import { ProblemException } from "../http/problem.js";
import { LIBRARY } from "../library/library.module.js";
import { SeasonsService } from "../seasons/seasons.service.js";
import { SourcesService } from "../sources/sources.service.js";
import { resolvePrices, type LibraryPrice, type PriceSource } from "./price-resolution.js";
import {
  doubleCropPairs,
  irrigationOnlyCrops,
  type HistoryEntry,
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
  /** Workspace currency of the company's prices and the margins. */
  currency: string;
  /** Where each priced crop's numbers come from. */
  priceSources: Record<string, PriceSource>;
  /** Crops the company priced without a yield, where no verified library yield exists (the user's yield is required). */
  needYield: string[];
  /** Oblast average yields (t/ha) for context next to the yield field; never a model input. */
  yieldHints: Record<string, { meanTHa: number; oblast: string }>;
  /** Last day with POWER weather (the newest day, which may belong to a season that is not complete yet). */
  weatherLastDate: string | null;
  /** Crop seasons that defined the current rotation (satellite guesses are left out when a confirmed one is recent). */
  historyRead: Array<{ season: number; source: string }>;
}

export interface Overrides {
  waterCapMm?: number;
  deltaT?: number;
  precipFactor?: number;
}

/** Soil organic carbon assumed at the start when no measurement exists, t C/ha (0–30 cm, Great Plains cropland). */
const DEFAULT_SOIL_C = 45;

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

/** Newest date of a POWER series that has temperature and precipitation. */
function lastPowerDay(power: PowerSeries): string | null {
  const v = power.values;
  for (let i = power.dates.length - 1; i >= 0; i--)
    if (v.T2M_MIN[i] != null && v.T2M_MAX[i] != null && v.PRECTOTCORR[i] != null) return power.dates[i] ?? null;
  return null;
}

/** Builds the engine inputs for a field: gathered sources, confirmed history, soil, prices, rotation candidates. */
@Injectable()
export class ScenarioInputsService {
  constructor(
    @Inject(ENV) private readonly env: Env,
    @Inject(LIBRARY) private readonly lib: Library,
    private readonly prisma: PrismaService,
    private readonly sources: SourcesService,
    private readonly geo: GeoService,
    private readonly seasons: SeasonsService,
    private readonly cropPrices: CropPricesService,
  ) {}
  /** Builds the engine input; null fields mean "No rotation library for this region yet". */
  async inputs(workspaceId: string, fieldId: string, o: Overrides): Promise<EngineInput> {
    return (await this.build(workspaceId, fieldId, o)).input;
  }

  async build(
    workspaceId: string,
    fieldId: string,
    o: Overrides,
  ): Promise<{ input: EngineInput; meta: InputMeta; aiCtx: ProposalContext | null; power: PowerSeries }> {
    const field = await this.prisma.db.field.findFirst({
      where: { id: fieldId, workspaceId, archivedAt: null },
      select: { id: true, regionId: true, irrigation: true, slopePct: true, tier: true, adminCode: true },
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

    const crops = await this.prisma.db.cropSeason.findMany({
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
    const library: Record<string, LibraryPrice> = Object.fromEntries(
      Object.entries(regionPrices).map(([crop, e]) => [
        crop,
        {
          verified: e.verified,
          price: e.price.value,
          irrigated: { variableCost: e.variableCost.value, yieldRef: e.yieldRef.value },
          dryland: e.dryland
            ? { variableCost: e.dryland.variableCost.value, yieldRef: e.dryland.yieldRef.value }
            : null,
        },
      ]),
    );
    const [currency, company] = await Promise.all([
      this.cropPrices.currency(workspaceId),
      this.cropPrices.rows(workspaceId),
    ]);
    const seqCrops = (seq: EngineInput["current"]["sequence"]) =>
      seq.flatMap((x) => (typeof x === "string" ? [x] : [x.main, x.second]));
    const resolved = resolvePrices({
      crops: [
        ...new Set([
          ...Object.keys(regionPrices),
          ...rotations.flatMap((r) => seqCrops(r.sequence)),
          ...seqCrops(current.sequence),
        ]),
      ].filter((c) => c !== "fallow"),
      irrigated,
      currency,
      libraryCurrency: this.lib.prices.currency,
      company,
      library,
    });
    const prices = resolved.prices;
    // Pumping cost only once verified (CLAUDE.md: thresholds and inputs are used after verification).
    const ic = this.lib.prices.irrigationCostPerMm;
    const irrCost = ic?.verified && ic.value != null && ic.value > 0 ? ic.value : undefined;
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
      yieldRefs: resolved.yieldRefs,
      ...(irrCost ? { irrigationCostPerMm: irrCost } : {}),
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
      meta: {
        currentBasis: basis,
        currentSequence: input.current.sequence,
        soilBasis,
        lastSeason,
        currency,
        priceSources: resolved.sources,
        needYield: resolved.needYield,
        yieldHints: this.yieldHints(field.adminCode),
        weatherLastDate: lastPowerDay(power.result.payload),
        historyRead: crops
          .filter((c) => !c.isOverride && (recentConfirmed || c.source !== "ndvi"))
          .map((c) => ({ season: c.season, source: c.source })),
      },
      aiCtx,
      power: power.result.payload,
    };
  }

  private uaYields: UaYieldsFile | null | undefined;

  /** Oblast average yields for crops whose id matches the library's (context only, never a price or model input). */
  private yieldHints(adminCode: string | null): InputMeta["yieldHints"] {
    if (!adminCode?.startsWith("UA-")) return {};
    if (this.uaYields === undefined) this.uaYields = loadUaYields(this.env.DATA_DIR);
    const ctx = this.uaYields ? oblastYields(this.uaYields, adminCode) : null;
    if (!ctx) return {};
    const alias: Record<string, string[]> = {
      sunflower: ["sunflower"],
      sugar_beet: ["sugar_beet"],
      soybean: ["soybean"],
      potato: ["potato"],
      rapeseed: ["winter_canola", "spring_canola"],
    };
    const out: InputMeta["yieldHints"] = {};
    for (const y of ctx.yields)
      for (const id of alias[y.crop] ?? []) out[id] = { meanTHa: y.meanTHa, oblast: ctx.oblast.en };
    return out;
  }

  /** What the assistant is told about the field (and what its proposals are checked against). No name, no coordinates. */
  private proposalContext(
    input: EngineInput,
    regionId: string,
    region: Library["rotations"]["regions"][string],
    tier: "A" | "B" | "C",
    soilBasis: string,
    currentBasis: string,
    crops: Array<{
      season: number;
      mainCrop: string;
      secondCrop: string | null;
      source: string;
      isOverride: boolean;
    }>,
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
}
