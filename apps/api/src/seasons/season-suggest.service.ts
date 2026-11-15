import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Inject, Injectable } from "@nestjs/common";
import { localDay } from "@terrasight/evaluators";
import type { Library } from "@terrasight/library";
import type { DailyWeather as PowerSeries } from "@terrasight/sources";
import { ForecastService } from "../analysis/forecast.service.js";
import { mergeWeather } from "../analysis/inputs.js";
import { RateLimitService } from "../auth/rate-limit.js";
import { ENV, type Env } from "../config/config.js";
import { PrismaService } from "../db/prisma.service.js";
import { ProblemException } from "../http/problem.js";
import { assertNotBlocked } from "../suitability/suitability.js";
import { LIBRARY } from "../library/library.module.js";
import { GeoService } from "../geo/geo.service.js";
import { SourcesService } from "../sources/sources.service.js";
import { SeasonsService } from "./seasons.service.js";
import {
  addDays,
  bestSowing,
  climatology,
  dailySoilMeans,
  emergenceByGdd,
  resolveWindow,
  sowingYear,
  suggestTillage,
  windowStatus,
  type DailySoil,
  type EmergenceMethod,
  type StatusResult,
  type Tillage,
  type TillageConfig,
  type WindowStatus,
} from "./suggest.js";

interface SourceRef {
  title: string;
  url: string | null;
  accessed: string | null;
}

/** data/crop-phenology.json */
interface Phenology {
  sources: Record<string, SourceRef>;
  crops: Record<
    string,
    {
      tBaseC: number;
      emergenceGdd?: number;
      typicalEmergenceDays?: number;
      sowingSoilTempC?: number;
      source: string;
      verified: boolean;
    }
  >;
  tillage: TillageConfig & {
    source: string;
    verified: boolean;
    regions: Record<string, { practice: Tillage; note: string }>;
  };
}

export interface SowingAlternative {
  crop: string;
  /** Harvest year the window belongs to (next year for winter crops sown this autumn). */
  season: number;
  window: { from: string; to: string };
  status: "open" | "not-yet";
  daysLeft?: number;
  opensInDays?: number;
}

export interface SeasonSuggestion {
  season: number;
  crop: string;
  today: string;
  sowing: {
    window: { from: string; to: string } | null;
    best: string | null;
    /** What picked `best`: the typical date, or the forecast soil temperature. */
    bestBasis: "typical" | "soil-temp" | "soil-temp-cold" | null;
    source: SourceRef | null;
    verified: boolean;
    status: WindowStatus | "unknown";
    daysLeft?: number;
    opensInDays?: number;
  };
  emergence: {
    date: string;
    method: EmergenceMethod;
    /** Degree days accumulated to the date (degree-day methods). */
    gdd: number | null;
    source: SourceRef | null;
    verified: boolean;
  } | null;
  tillage: {
    value: Tillage;
    reason: string;
    reasonCode: string;
    params: Record<string, unknown>;
    rusle: number | null;
    source: SourceRef | null;
    verified: boolean;
  } | null;
  alternatives?: SowingAlternative[];
}

const MAX_ALTERNATIVES = 6;

/** "This season" suggestions: the user picks the crop, the app proposes sowing, emergence and tillage (all editable). */
@Injectable()
export class SeasonSuggestService {
  private readonly pheno: Phenology;

  constructor(
    private readonly prisma: PrismaService,
    private readonly seasons: SeasonsService,
    private readonly forecasts: ForecastService,
    private readonly sources: SourcesService,
    private readonly limits: RateLimitService,
    private readonly geo: GeoService,
    @Inject(ENV) env: Env,
    @Inject(LIBRARY) private readonly lib: Library,
  ) {
    this.pheno = JSON.parse(readFileSync(join(env.DATA_DIR, "crop-phenology.json"), "utf8")) as Phenology;
  }

  /** 404 for a field outside the workspace, before any input is validated (no existence leak). */
  async assertField(workspaceId: string, fieldId: string): Promise<void> {
    const f = await this.prisma.db.field.findFirst({
      where: { id: fieldId, workspaceId, archivedAt: null },
      select: { id: true },
    });
    if (!f) throw new ProblemException(404, "not-found");
  }

  async suggest(
    workspaceId: string,
    fieldId: string,
    season: number,
    crop: string,
    sowingOverride: string | null,
    now = new Date(),
  ): Promise<SeasonSuggestion> {
    if (!this.lib.rotations.crops[crop]) throw new ProblemException(422, "unknown-crop");
    const field = await this.prisma.db.field.findFirst({
      where: { id: fieldId, workspaceId, archivedAt: null },
      select: { regionId: true, slopePct: true, country: true, suitability: true, suitabilityOverride: true },
    });
    if (!field) throw new ProblemException(404, "not-found");
    assertNotBlocked(field.suitability, field.suitabilityOverride);
    const ws = await this.prisma.system.workspace.findUnique({
      where: { id: workspaceId },
      select: { timeZone: true },
    });
    const today = localDay(now, ws?.timeZone ?? "UTC");
    const regionId = field.regionId;
    const region = regionId ? this.lib.rotations.regions[regionId] : undefined;
    const geom = await this.geometry(fieldId);

    const ph = this.pheno.crops[crop];
    const phRef = ph ? (this.pheno.sources[ph.source] ?? null) : null;
    const rules = this.seasons.sowingWindows(regionId);
    const rule = rules[crop];
    const calUnverified = this.seasons.calendarUnverified(regionId);
    const calRef: SourceRef = {
      title: `Crop calendar, ${region?.en ?? regionId} (team rule of thumb)`,
      url: null,
      accessed: null,
    };

    // ---- sowing ----
    let sowing: SeasonSuggestion["sowing"] = {
      window: null,
      best: null,
      bestBasis: null,
      source: null,
      verified: false,
      status: "unknown",
    };
    let alternatives: SowingAlternative[] | undefined;
    if (rule) {
      const window = resolveWindow(rule, season);
      const st: StatusResult = windowStatus(window, today);
      const typicalMmdd = regionId ? this.seasons.sowingCalendar(regionId)[crop] : undefined;
      const typical = typicalMmdd ? `${sowingYear(typicalMmdd, season)}-${typicalMmdd}` : null;
      const soil = st.status === "open" ? await this.soil(geom, today) : null;
      const best = bestSowing(window, today, typical, soil, ph?.sowingSoilTempC ?? null);
      sowing = {
        window,
        best: best?.date ?? null,
        bestBasis: best?.basis ?? null,
        source:
          best?.basis === "soil-temp" && phRef
            ? { ...calRef, title: `${calRef.title}; soil temperature: ${phRef.title}` }
            : calRef,
        verified: !calUnverified,
        status: st.status,
        ...(st.daysLeft !== undefined ? { daysLeft: st.daysLeft } : {}),
        ...(st.opensInDays !== undefined ? { opensInDays: st.opensInDays } : {}),
      };
      if (st.status === "late" || st.status === "closed")
        alternatives = this.alternatives(rules, crop, season, today);
    }

    // ---- emergence ----
    const sowDate = sowingOverride ?? sowing.best;
    const emergence = sowDate ? await this.emergence(geom, field.country, crop, sowDate, today) : null;

    // ---- tillage ----
    const t = this.pheno.tillage;
    const annualP = region ? (region.precipMm[0] + region.precipMm[1]) / 2 : null;
    const till = suggestTillage({
      slopePct: field.slopePct ?? null,
      annualPrecipMm: annualP,
      crop,
      regionPractice: (regionId && t.regions[regionId]?.practice) || null,
      cfg: t,
    });

    return {
      season,
      crop,
      today,
      sowing,
      emergence,
      tillage: till
        ? {
            value: till.value,
            reason: till.reason,
            reasonCode: till.reasonCode,
            params: till.params,
            rusle: till.rusle,
            source: this.pheno.sources[t.source] ?? null,
            verified: t.verified,
          }
        : null,
      ...(alternatives?.length ? { alternatives } : {}),
    };
  }

  /** Crops of the region whose window is open or opens soon: this season's, and next season's autumn-sown ones. */
  private alternatives(
    rules: Record<string, [string, string]>,
    crop: string,
    season: number,
    today: string,
  ): SowingAlternative[] {
    const out: SowingAlternative[] = [];
    for (const [id, rule] of Object.entries(rules)) {
      if (id === crop) continue;
      const winterSown = Number(rule[0].slice(0, 2)) >= 8;
      for (const s of winterSown ? [season, season + 1] : [season]) {
        const window = resolveWindow(rule, s);
        const st = windowStatus(window, today);
        if (st.status !== "open" && st.status !== "not-yet") continue;
        out.push({
          crop: id,
          season: s,
          window,
          status: st.status,
          ...(st.daysLeft !== undefined ? { daysLeft: st.daysLeft } : {}),
          ...(st.opensInDays !== undefined ? { opensInDays: st.opensInDays } : {}),
        });
        break;
      }
    }
    const rank = (a: SowingAlternative) => (a.status === "open" ? 0 : 1);
    return out
      .sort((a, b) => rank(a) - rank(b) || a.window.from.localeCompare(b.window.from))
      .slice(0, MAX_ALTERNATIVES);
  }

  private geometry(fieldId: string) {
    return this.geo.fieldGeometry(fieldId);
  }

  /** Daily soil temperature from the hourly forecast (Open-Meteo); null when unavailable. */
  private async soil(
    geom: { centroid: { lat: number; lon: number } },
    today: string,
  ): Promise<DailySoil[] | null> {
    try {
      const h = await this.forecasts.getHourly(geom.centroid.lat, geom.centroid.lon, today);
      return h ? dailySoilMeans(h.forecast.hours) : null;
    } catch {
      return null;
    }
  }

  private async emergence(
    geom: Awaited<ReturnType<GeoService["fieldGeometry"]>>,
    country: string | null,
    crop: string,
    sowing: string,
    today: string,
  ): Promise<SeasonSuggestion["emergence"]> {
    const ph = this.pheno.crops[crop];
    if (!ph) return null;
    const ref = this.pheno.sources[ph.source] ?? null;
    if (ph.emergenceGdd !== undefined) {
      try {
        const take = () => this.limits.takeWithin("source:power", { capacity: 8, refillPerSec: 2 }, 250);
        const [power, forecast] = await Promise.all([
          this.sources.fresh<PowerSeries>("power", geom, today, take),
          this.forecasts.get(geom.centroid.lat, geom.centroid.lon, country, today),
        ]);
        const series = power?.result.payload ?? null;
        const weather = mergeWeather(series, forecast?.forecast ?? null, today);
        const climate = series
          ? climatology(
              series.dates,
              series.values.T2M_MIN,
              series.values.T2M_MAX,
              Number(today.slice(0, 4)) - 15,
            )
          : null;
        if (weather.length || climate) {
          const r = emergenceByGdd({
            sowing,
            weather,
            baseC: ph.tBaseC,
            requiredGdd: ph.emergenceGdd,
            climate,
          });
          if (r) return { date: r.date, method: r.method, gdd: r.gdd, source: ref, verified: ph.verified };
        }
      } catch {
        // Weather unavailable: fall through to the typical number of days.
      }
    }
    if (ph.typicalEmergenceDays !== undefined)
      return {
        date: addDays(sowing, ph.typicalEmergenceDays),
        method: "typical-days",
        gdd: null,
        source: ref,
        verified: false,
      };
    return null;
  }
}
