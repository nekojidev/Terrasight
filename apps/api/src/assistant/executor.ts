import { Inject, Injectable } from "@nestjs/common";
import { parseArgs, type ToolArgs, type ToolName } from "@terrasight/assistant-core";
import { classifyUrgency, evaluate } from "@terrasight/evaluators";
import type { Library } from "@terrasight/library";
import type { DailyWeather as PowerSeries } from "@terrasight/sources";
import { EvalInputsService } from "../analysis/eval-inputs.service.js";
import { ForecastService } from "../analysis/forecast.service.js";
import { localDate } from "../analysis/scheduler.js";
import { BriefService } from "../brief/brief.service.js";
import { PrismaService } from "../db/prisma.service.js";
import { GeoService } from "../geo/geo.service.js";
import { HistoryService } from "../history/history.service.js";
import { LIBRARY } from "../library/library.module.js";
import { RecommendationsService } from "../recommendations/recommendations.service.js";
import { SeasonsService } from "../seasons/seasons.service.js";
import { SourcesService } from "../sources/sources.service.js";

/** Session scope: taken from the request, never from the model's arguments (RFC §12.3). */
export interface Scope {
  workspaceId: string;
  userId: string;
  role: string;
  lang: "en" | "uk";
}

export class ToolError extends Error {}

const q = (value: number | null | undefined, unit: string, precision: number) =>
  value === null || value === undefined || !Number.isFinite(value)
    ? null
    : { value: Math.round(value * 10 ** precision) / 10 ** precision, unit, precision };

/** Runs the read-only tools (RFC §12.3) inside the user's workspace. Field names never leave: only aliases F<n>. */
@Injectable()
export class ToolExecutor {
  constructor(
    @Inject(LIBRARY) private readonly lib: Library,
    private readonly prisma: PrismaService,
    private readonly brief: BriefService,
    private readonly recs: RecommendationsService,
    private readonly history: HistoryService,
    private readonly seasons: SeasonsService,
    private readonly forecasts: ForecastService,
    private readonly sources: SourcesService,
    private readonly geo: GeoService,
    private readonly inputs: EvalInputsService,
  ) {}

  /** alias ↔ field id and name for the workspace (names only go to the UI to restore aliases). */
  async aliases(workspaceId: string): Promise<Map<string, { id: string; name: string }>> {
    const fields = await this.prisma.system.field.findMany({
      where: { workspaceId, archivedAt: null },
      select: { id: true, name: true, aliasNo: true },
    });
    return new Map(fields.map((f) => [`F${f.aliasNo}`, { id: f.id, name: f.name }]));
  }

  private async field(scope: Scope, alias: string): Promise<{ id: string; alias: string }> {
    const m = /^F(\d+)$/.exec(alias);
    const f = m
      ? await this.prisma.system.field.findFirst({
          where: { workspaceId: scope.workspaceId, aliasNo: Number(m[1]), archivedAt: null },
          select: { id: true },
        })
      : null;
    if (!f) throw new ToolError(`field ${alias} not found`);
    return { id: f.id, alias };
  }

  private async aliasOf(fieldId: string): Promise<string> {
    const f = await this.prisma.system.field.findUnique({
      where: { id: fieldId },
      select: { aliasNo: true },
    });
    return f ? `F${f.aliasNo}` : "F?";
  }

  private async today(workspaceId: string): Promise<string> {
    const ws = await this.prisma.system.workspace.findUniqueOrThrow({
      where: { id: workspaceId },
      select: { timeZone: true },
    });
    return localDate(ws.timeZone);
  }

  async run(name: ToolName, rawArgs: unknown, scope: Scope): Promise<unknown> {
    const parsed = parseArgs(name, rawArgs);
    if (!parsed.ok) throw new ToolError(`invalid arguments: ${parsed.error}`);
    const a = parsed.args as Record<string, unknown>;
    switch (name) {
      case "list_fields":
        return this.listFields(scope, a as ToolArgs<"list_fields">);
      case "get_brief":
        return this.getBrief(scope);
      case "get_field_summary":
        return this.fieldSummary(scope, a as ToolArgs<"get_field_summary">);
      case "get_field_history":
        return this.fieldHistory(scope, a as ToolArgs<"get_field_history">);
      case "get_weather":
        return this.weather(scope, a as ToolArgs<"get_weather">);
      case "get_forecast":
        return this.forecast(scope, a as ToolArgs<"get_forecast">);
      case "list_recommendations":
        return this.listRecommendations(scope, a as ToolArgs<"list_recommendations">);
      case "explain_recommendation":
        return this.explain(scope, a as ToolArgs<"explain_recommendation">);
      case "run_risk_model":
        return this.whatIf(scope, a as ToolArgs<"run_risk_model">);
      case "compare":
        return this.compare(a as ToolArgs<"compare">);
      case "get_pest_info":
        return this.pestInfo(scope, a as ToolArgs<"get_pest_info">);
    }
  }

  private async listFields(scope: Scope, a: ToolArgs<"list_fields">) {
    const b = await this.brief.get(scope.workspaceId);
    const fields = await this.prisma.system.field.findMany({
      where: { workspaceId: scope.workspaceId, archivedAt: null },
      select: { id: true, aliasNo: true, regionId: true, tier: true, areaHa: true, irrigation: true },
    });
    const urgencyOf = new Map<string, string>();
    for (const i of [...(b.hero ? [b.hero] : []), ...b.urgent, ...b.thisWeek])
      urgencyOf.set(i.fieldId, i.urgency);
    const crops = await this.prisma.system.cropSeason.findMany({
      where: { fieldId: { in: fields.map((f) => f.id) } },
      orderBy: { season: "desc" },
    });
    const list = fields
      .map((f) => ({
        field: `F${f.aliasNo}`,
        region: f.regionId,
        tier: f.tier,
        area: q(f.areaHa, "ha", 1),
        irrigation: f.irrigation,
        lastCrop: crops.find((c) => c.fieldId === f.id)
          ? {
              season: crops.find((c) => c.fieldId === f.id)!.season,
              crop: crops.find((c) => c.fieldId === f.id)!.mainCrop,
            }
          : null,
        urgency: urgencyOf.get(f.id) ?? "all_good",
      }))
      .filter((f) => !a.urgency || f.urgency === a.urgency);
    return { count: list.length, fields: list };
  }

  private async getBrief(scope: Scope) {
    const b = await this.brief.get(scope.workspaceId);
    const item = async (i: (typeof b.urgent)[number]) => ({
      id: i.id,
      field: await this.aliasOf(i.fieldId),
      title: i.text.title[scope.lang],
      action: i.text.action[scope.lang],
      level: i.level,
      confidence: i.confidence,
      deadline: i.deadline,
      urgency: i.urgency,
      keyNumbers: i.keyNumbers,
      moreOnField: i.more,
    });
    return {
      date: b.date,
      counts: b.counts,
      startHere: b.hero ? await item(b.hero) : null,
      urgent: await Promise.all(b.urgent.map(item)),
      thisWeek: await Promise.all(b.thisWeek.map(item)),
      allGood: await Promise.all(
        b.allGood.map(async (g) => ({
          field: await this.aliasOf(g.fieldId),
          plan: g.plan ? { title: g.plan.title[scope.lang], deadline: g.plan.deadline } : null,
        })),
      ),
      lastRun: b.lastRun
        ? {
            finishedAt: b.lastRun.finishedAt,
            checked: b.lastRun.summary?.checked ?? null,
            total: b.lastRun.summary?.total ?? null,
            newRecommendations: b.lastRun.summary?.newRecommendations ?? null,
          }
        : null,
      // The owner's free-text question is never sent (RFC §12.6); only whether one is open.
      ownerQuestionOpen: b.rail.ownerQuestion !== null,
    };
  }

  private async fieldSummary(scope: Scope, a: ToolArgs<"get_field_summary">) {
    const f = await this.field(scope, a.field);
    const row = await this.prisma.system.field.findUniqueOrThrow({
      where: { id: f.id },
      select: {
        areaHa: true,
        regionId: true,
        tier: true,
        irrigation: true,
        irrigationSource: true,
        slopePct: true,
        adminCode: true,
      },
    });
    const season = SeasonsService.currentSeason(new Date(`${await this.today(scope.workspaceId)}T12:00:00Z`));
    const record = await this.seasons.get(scope.workspaceId, f.id, season);
    return {
      field: f.alias,
      area: q(row.areaHa, "ha", 1),
      region: row.regionId,
      state: row.adminCode, // ISO 3166-2 code; county names are not sent (RFC §12.6)
      tier: row.tier,
      irrigation: { value: row.irrigation, source: row.irrigationSource },
      slope: q(row.slopePct, "%", 1),
      season: {
        season: record.season,
        crop: record.crop,
        sowingDate: record.sowingDate,
        emergenceDate: record.emergenceDate,
        tillage: record.tillage,
        missing: record.missing,
      },
    };
  }

  private async fieldHistory(scope: Scope, a: ToolArgs<"get_field_history">) {
    const f = await this.field(scope, a.field);
    const h = await this.history.get(scope.workspaceId, f.id);
    const inRange = (s: number) => (!a.fromSeason || s >= a.fromSeason) && (!a.toSeason || s <= a.toSeason);
    const stats = (
      h.seasonStats as Array<{
        season: number;
        precipMm: number | null;
        heatDays: number | null;
        ndviPeak: number | null;
      }>
    ).filter((s) => inRange(s.season));
    return {
      field: f.alias,
      seasons: h.seasons
        .filter((s) => inRange(s.season))
        .map((s) => ({
          season: s.season,
          crop: s.mainCrop,
          secondCrop: s.secondCrop,
          source: s.source,
          confidence: q(s.confidence, "share", 2),
        })),
      stressYearCount: (h.stressYears as Array<{ season: number }>).filter((s) => inRange(s.season)).length,
      stressYears: (h.stressYears as Array<{ season: number; reasons: string[] }>)
        .filter((s) => inRange(s.season))
        .map((s) => ({ season: s.season, reasons: s.reasons })),
      seasonStats: stats.map((s) => ({
        season: s.season,
        precipitation: q(s.precipMm, "mm", 0),
        heatDays: q(s.heatDays, "days", 0),
        ndviPeak: q(s.ndviPeak, "NDVI", 2),
      })),
      irrigation: h.irrigation,
      // Seasons after the last mapped one: USDA CDL for a season is published early the next year.
      notYetMapped: (() => {
        const last = Math.max(...h.seasons.map((x) => x.season), 0);
        const current = SeasonsService.currentSeason(new Date());
        return last ? Array.from({ length: Math.max(0, current - last - 1) }, (_, i) => last + 1 + i) : [];
      })(),
      source: "USDA CDL / MODIS NDVI, NASA POWER",
    };
  }

  private async weather(scope: Scope, a: ToolArgs<"get_weather">) {
    const f = await this.field(scope, a.field);
    if (a.from > a.to) throw new ToolError("from is after to");
    const geom = await this.geo.fieldGeometry(f.id);
    const today = await this.today(scope.workspaceId);
    const power = await this.sources.fresh<PowerSeries>("power", geom, today, async () => undefined);
    const series = power?.result.payload;
    if (!series) throw new ToolError("weather is not available for this field yet");
    const start = Date.parse(`${a.from}T00:00:00Z`);
    const days = Math.round((Date.parse(`${a.to}T00:00:00Z`) - start) / 864e5) + 1;
    if (days > 400) throw new ToolError("the window can be at most 400 days");
    const offset =
      (Date.parse(`${a.from}T00:00:00Z`) - Date.parse(`${a.from.slice(0, 4)}-01-01T00:00:00Z`)) / 864e5;
    const window = (year: number) => {
      const s0 = Date.parse(`${year}-01-01T00:00:00Z`) + offset * 864e5;
      let precip = 0,
        t = 0,
        n = 0,
        frost = 0,
        tmin = Infinity,
        tmax = -Infinity,
        count = 0;
      series.dates.forEach((d, i) => {
        const k = (Date.parse(`${d}T00:00:00Z`) - s0) / 864e5;
        if (k < 0 || k >= days) return;
        count += 1;
        const v = series.values;
        if (v.PRECTOTCORR[i] != null) precip += v.PRECTOTCORR[i]!;
        if (v.T2M[i] != null) {
          t += v.T2M[i]!;
          n += 1;
        }
        if (v.T2M_MIN[i] != null) {
          tmin = Math.min(tmin, v.T2M_MIN[i]!);
          if (v.T2M_MIN[i]! <= 0) frost += 1;
        }
        if (v.T2M_MAX[i] != null) tmax = Math.max(tmax, v.T2M_MAX[i]!);
      });
      return count >= days * 0.8 && n ? { precip, mean: t / n, frost, tmin, tmax } : null;
    };
    const year = Number(a.from.slice(0, 4));
    const cur = window(year);
    if (!cur)
      throw new ToolError(
        `no complete weather for ${a.from}–${a.to} (NASA POWER data until ${power.result.dataDate})`,
      );
    const past = [];
    for (let y = 1981; y < year; y++) {
      const w = window(y);
      if (w) past.push(w);
    }
    const pct = (vals: number[], v: number) =>
      vals.length ? Math.round((vals.filter((x) => x < v).length / vals.length) * 100) : null;
    return {
      field: f.alias,
      from: a.from,
      to: a.to,
      precipitation: q(cur.precip, "mm", 0),
      meanTemperature: q(cur.mean, "°C", 1),
      minTemperature: q(cur.tmin, "°C", 1),
      maxTemperature: q(cur.tmax, "°C", 1),
      frostDays: q(cur.frost, "days", 0),
      percentileVsPastYears: {
        since: 1981,
        precipitation: q(
          pct(
            past.map((p) => p.precip),
            cur.precip,
          ),
          "percentile",
          0,
        ),
        meanTemperature: q(
          pct(
            past.map((p) => p.mean),
            cur.mean,
          ),
          "percentile",
          0,
        ),
        years: past.length,
      },
      source: `NASA POWER daily, data until ${power.result.dataDate}`,
    };
  }

  private async forecast(scope: Scope, a: ToolArgs<"get_forecast">) {
    const f = await this.field(scope, a.field);
    const geom = await this.geo.fieldGeometry(f.id);
    const row = await this.prisma.system.field.findUniqueOrThrow({
      where: { id: f.id },
      select: { country: true },
    });
    const fc = await this.forecasts.get(
      geom.centroid.lat,
      geom.centroid.lon,
      row.country,
      await this.today(scope.workspaceId),
    );
    if (!fc) throw new ToolError("forecast unavailable");
    return {
      field: f.alias,
      provider: fc.forecast.provider,
      issuedAt: fc.forecast.issuedAt,
      stale: fc.origin === "stale",
      days: fc.forecast.days
        .filter((d) => d.origin === "forecast")
        .slice(0, a.days)
        .map((d) => ({
          date: d.date,
          min: q(d.tminC, "°C", 0),
          max: q(d.tmaxC, "°C", 0),
          precipitation: q(d.precipMm, "mm", 0),
          uncertain: (d.forecastDay ?? 0) > 7,
        })),
      attribution: fc.forecast.attribution,
    };
  }

  private async listRecommendations(scope: Scope, a: ToolArgs<"list_recommendations">) {
    const fieldId = a.field ? (await this.field(scope, a.field)).id : undefined;
    const ws = await this.prisma.system.workspace.findUniqueOrThrow({
      where: { id: scope.workspaceId },
      select: { timeZone: true },
    });
    const rows = await this.prisma.system.recommendation.findMany({
      where: {
        workspaceId: scope.workspaceId,
        ...(fieldId ? { fieldId } : {}),
        status: a.status ? a.status : { in: ["open", "accepted", "snoozed", "in_report"] },
      },
      include: { field: { select: { name: true, aliasNo: true } } },
      orderBy: { deadline: "asc" },
    });
    return rows.map((r) => {
      const v = this.recs.view(r);
      return {
        id: r.id,
        field: `F${r.field.aliasNo}`,
        type: r.type,
        pest: r.subject,
        title: v.text.title[scope.lang],
        level: r.level,
        confidence: r.confidence,
        deadline: v.deadline,
        planning: r.planning,
        urgency: classifyUrgency(
          {
            deadline: v.deadline,
            irreversible: r.irreversible,
            planning: r.planning,
            openScoutingTask: false,
          },
          new Date(),
          ws.timeZone,
        ),
        status: r.status,
      };
    });
  }

  private async explain(scope: Scope, a: ToolArgs<"explain_recommendation">) {
    const r = await this.prisma.system.recommendation.findFirst({
      where: { id: a.id, workspaceId: scope.workspaceId },
      include: { field: { select: { name: true, aliasNo: true } } },
    });
    if (!r) throw new ToolError("recommendation not found");
    const v = this.recs.view(r);
    return {
      id: r.id,
      field: `F${r.field.aliasNo}`,
      title: v.text.title[scope.lang],
      action: v.text.action[scope.lang],
      level: r.level,
      confidence: r.confidence,
      tier: r.tier,
      deadline: v.deadline,
      irreversible: r.irreversible,
      planning: r.planning,
      keyNumbers: r.keyNumbers,
      drivers: r.drivers,
      evidence: r.evidence,
      unknowns: r.unknowns,
      scout: v.text.scout?.[scope.lang] ?? null,
    };
  }

  /** What-if: the same model on the same inputs with a changed sowing date or next crop; nothing is saved. */
  private async whatIf(scope: Scope, a: ToolArgs<"run_risk_model">) {
    const f = await this.field(scope, a.field);
    const model = this.lib.enabledModels.find((m) => m.pest === a.pest);
    if (!model)
      throw new ToolError(
        `no enabled model for ${a.pest}; enabled: ${this.lib.enabledModels.map((m) => m.pest).join(", ")}`,
      );
    const asOf = await this.today(scope.workspaceId);
    const built = await this.inputs.build(scope.workspaceId, f.id, asOf);
    const base = { ...built.inputs, planningDeadline: built.planningDeadline(model) };
    const changed = {
      ...base,
      ...(a.sowingDate
        ? { record: { ...base.record, sowingDate: { value: a.sowingDate, source: "confirmed" as const } } }
        : {}),
      ...(a.nextCrop ? { nextCrop: { ...base.nextCrop, crop: a.nextCrop, source: "plan" as const } } : {}),
    };
    const pick = (r: ReturnType<typeof evaluate>) => ({
      level: r.level,
      confidence: r.confidence,
      deadline: r.deadline,
      keyNumbers: r.keyNumbers,
      unknowns: r.unknowns,
    });
    return {
      field: f.alias,
      pest: a.pest,
      change: { sowingDate: a.sowingDate ?? null, nextCrop: a.nextCrop ?? null },
      current: pick(evaluate(model, base, asOf)),
      whatIf: pick(evaluate(model, changed, asOf)),
      saved: false,
    };
  }

  private compare(a: ToolArgs<"compare">) {
    const unit = a.unit ?? "";
    const pct = a.b !== 0 ? ((a.a - a.b) / Math.abs(a.b)) * 100 : null;
    return {
      label: a.label ?? null,
      a: { value: a.a, unit },
      b: { value: a.b, unit },
      aMinusB: q(a.a - a.b, unit, 2),
      bMinusA: q(a.b - a.a, unit, 2),
      percentChangeFromB: q(pct, "%", 1),
    };
  }

  private pestInfo(scope: Scope, a: ToolArgs<"get_pest_info">) {
    const p = this.lib.pests.pests.find(
      (x) => x.id === a.pest || x.name.en.toLowerCase() === a.pest.toLowerCase(),
    );
    if (!p) throw new ToolError(`no library entry for ${a.pest}`);
    const L = scope.lang;
    return {
      id: p.id,
      name: p.name[L],
      kind: p.kind,
      crops: p.crops,
      regions: p.regions,
      season: p.season[L],
      damage: p.damage[L],
      riskWhen: p.riskWhen[L],
      scout: p.scout[L],
      prevent: p.prevent[L],
      hasVerifiedModel: this.lib.enabledModels.some((m) => m.pest === p.id),
    };
  }
}
