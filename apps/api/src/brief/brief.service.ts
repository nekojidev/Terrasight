import { Injectable } from "@nestjs/common";
import { classifyUrgency, compareItems, localDay, type Urgency } from "@terrasight/evaluators";
import { forecastCell, nextFrostDay, type Forecast } from "@terrasight/sources";
import { AiDaySummaryService } from "../analysis/ai-day-summary.service.js";
import { AnalysisService } from "../analysis/analysis.service.js";
import { PrismaService } from "../db/prisma.service.js";
import { thumbPath } from "../geo/thumb.js";
import { ProblemException } from "../http/problem.js";
import { RecommendationsService } from "../recommendations/recommendations.service.js";

const GROUP_RANK: Record<Urgency, number> = { urgent: 0, this_week: 1, all_good: 2 };
/** Levels that make an item worth a row; low / none count as "fine" for the field. */
const ACTIONABLE = new Set(["high", "moderate", "unknown"]);

/**
 * The morning brief in one call (S-04.02, RFC §10.5): groups, hero, one item per field with "+N", All good chips with
 * each field's 5-season strip, the last run, and the rail (today in numbers, weather by county, open owner question).
 */
@Injectable()
export class BriefService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly recs: RecommendationsService,
    private readonly analysis: AnalysisService,
    private readonly daySummary: AiDaySummaryService,
  ) {}

  async get(workspaceId: string, now = new Date()) {
    const ws = await this.prisma.system.workspace.findUnique({
      where: { id: workspaceId },
      select: { timeZone: true, name: true },
    });
    if (!ws) throw new ProblemException(404, "not-found");
    const today = localDay(now, ws.timeZone);
    const [fields, recs, run, question] = await Promise.all([
      this.prisma.system.$queryRaw<
        Array<{
          id: string;
          name: string;
          alias_no: number;
          area_ha: number;
          county_name: string | null;
          admin_code: string | null;
          lat: number;
          lon: number;
          thumb_geojson: string | null;
        }>
      >`
        SELECT id, name, alias_no, area_ha, county_name, admin_code, ST_Y(centroid) AS lat, ST_X(centroid) AS lon,
          thumb_geojson
        FROM fields WHERE workspace_id = ${workspaceId}::uuid AND archived_at IS NULL ORDER BY alias_no`,
      this.prisma.system.recommendation.findMany({
        where: { workspaceId, status: "open", field: { archivedAt: null } },
        include: {
          field: { select: { name: true, aliasNo: true } },
          scoutingTasks: { where: { status: "open" }, select: { id: true } },
        },
      }),
      this.analysis.latest(workspaceId),
      this.prisma.system.ownerAnswer.findFirst({
        where: { answer: "question", reportItem: { workspaceId } },
        orderBy: { createdAt: "desc" },
        include: {
          reportItem: {
            select: {
              recommendationId: true,
              recommendation: { select: { field: { select: { name: true } } } },
            },
          },
        },
      }),
    ]);
    const crops = await this.prisma.system.cropSeason.findMany({
      where: { fieldId: { in: fields.map((f) => f.id) } },
      orderBy: { season: "asc" },
    });

    // Items: open, not expired (deadline passed), classified in the workspace time zone.
    const items = recs
      .filter((r) => !r.deadline || r.deadline.toISOString().slice(0, 10) >= today)
      .map((r) => {
        const view = this.recs.view(r, now);
        const urgency: Urgency = ACTIONABLE.has(r.level)
          ? classifyUrgency(
              {
                deadline: view.deadline,
                irreversible: r.irreversible,
                planning: r.planning,
                openScoutingTask: r.scoutingTasks.length > 0,
              },
              now,
              ws.timeZone,
            )
          : "all_good";
        return { ...view, urgency, actionable: ACTIONABLE.has(r.level) };
      });

    // Assistant-suggested watch-items ("worth a look", no verified model) never join the groups: not Urgent, not hero.
    const watch = items.filter((i) => i.aiSuggested);
    items.splice(0, items.length, ...items.filter((i) => !i.aiSuggested));

    // One item per field: the most urgent; the rest are "+N" (decision 10).
    const byField = new Map<string, typeof items>();
    for (const i of items) (byField.get(i.fieldId) ?? byField.set(i.fieldId, []).get(i.fieldId)!).push(i);
    const top = [...byField.values()].map((list) => {
      const sorted = [...list].sort(
        (a, b) =>
          GROUP_RANK[a.urgency] - GROUP_RANK[b.urgency] ||
          Number(b.actionable) - Number(a.actionable) ||
          compareItems(a, b),
      );
      return {
        ...sorted[0]!,
        more: sorted.filter((x) => x.actionable).length - (sorted[0]!.actionable ? 1 : 0),
      };
    });
    const group = (u: Urgency) => top.filter((t) => t.urgency === u && t.actionable).sort(compareItems);
    const urgent = group("urgent");
    const thisWeek = group("this_week");
    const hero = urgent[0] ?? thisWeek[0] ?? null;
    const worthALook = watch.sort((a, b) => a.fieldName.localeCompare(b.fieldName) || a.id.localeCompare(b.id));

    const cropsOf = new Map<string, typeof crops>();
    for (const c of crops) (cropsOf.get(c.fieldId) ?? cropsOf.set(c.fieldId, []).get(c.fieldId)!).push(c);
    const strip = (fieldId: string) =>
      (cropsOf.get(fieldId) ?? [])
        .slice(-5)
        .map((c) => ({ season: c.season, crop: c.mainCrop, secondCrop: c.secondCrop }));
    const thumbs = new Map(fields.map((f) => [f.id, thumbPath(f.thumb_geojson)]));
    const topOf = new Map(top.map((t) => [t.fieldId, t]));
    const allGood = fields
      .filter((f) => {
        const t = topOf.get(f.id);
        return !t || t.urgency === "all_good" || !t.actionable;
      })
      .map((f) => {
        const t = topOf.get(f.id);
        return {
          fieldId: f.id,
          name: f.name,
          areaHa: f.area_ha,
          county: f.county_name,
          seasons: strip(f.id),
          thumb: thumbs.get(f.id) ?? null,
          // A planning item under All good shows as "Plan: … · by <date>" (RFC §10.5).
          plan:
            t && t.actionable && t.planning ? { id: t.id, title: t.text.title, deadline: t.deadline } : null,
          unknown: t && t.level === "unknown" ? { id: t.id, title: t.text.title } : null,
        };
      });

    const weather = await this.weatherByCounty(fields, today);
    return {
      date: today,
      timeZone: ws.timeZone,
      workspaceName: ws.name,
      counts: {
        fields: fields.length,
        urgent: urgent.length,
        thisWeek: thisWeek.length,
        allGood: allGood.length,
        worthALook: worthALook.length,
      },
      daySummary: this.summary(workspaceId, fields, urgent, thisWeek, worthALook, today, weather),
      hero: hero ? { ...hero, seasons: strip(hero.fieldId), thumb: thumbs.get(hero.fieldId) ?? null } : null,
      urgent: urgent.filter((i) => i.id !== hero?.id).map((i) => ({ ...i, seasons: strip(i.fieldId), thumb: thumbs.get(i.fieldId) ?? null })),
      thisWeek: thisWeek.filter((i) => i.id !== hero?.id).map((i) => ({ ...i, seasons: strip(i.fieldId), thumb: thumbs.get(i.fieldId) ?? null })),
      allGood,
      worthALook: worthALook.map((i) => ({ ...i, thumb: thumbs.get(i.fieldId) ?? null })),
      lastRun: run
        ? { id: run.id, status: run.status, finishedAt: run.finishedAt, summary: run.summary }
        : null,
      rail: {
        today: {
          fields: fields.length,
          checked: run?.summary?.checked ?? null,
          newRecommendations: run?.summary?.newRecommendations ?? null,
          urgent: urgent.length,
        },
        weather,
        ownerQuestion: question
          ? {
              reportItemId: question.reportItemId,
              recommendationId: question.reportItem.recommendationId,
              fieldName: question.reportItem.recommendation.field.name,
              text: question.text,
              at: question.createdAt,
            }
          : null,
      },
    };
  }

  /**
   * The header sentence written by the assistant (number-checked, from the brief facts) when it is ready; null
   * otherwise, and the web shows its own template sentence from the counts.
   * Fields are named "F<alias>" in the facts and replaced by their names for display.
   */
  private summary(
    workspaceId: string,
    fields: Array<{ id: string; name: string; alias_no: number }>,
    urgent: Array<{ fieldId: string; text: { title: { en: string } }; level: string; deadline: string | null }>,
    thisWeek: Array<{ fieldId: string; text: { title: { en: string } }; level: string; deadline: string | null }>,
    worth: unknown[],
    today: string,
    weather: Array<{ today: { tminC: number | null; tmaxC: number | null; precipMm: number | null } | null; nextFrost: { date: string; tminC: number } | null }>,
  ) {
    const ref = new Map(fields.map((f) => [f.id, `F${f.alias_no}`]));
    const names = new Map(fields.map((f) => [`F${f.alias_no}`, f.name]));
    const row = (i: (typeof urgent)[number]) => ({
      field: ref.get(i.fieldId),
      item: i.text.title.en,
      level: i.level,
      deadline: i.deadline,
    });
    const nums = (k: "tminC" | "tmaxC" | "precipMm") =>
      weather.map((w) => w.today?.[k]).filter((v): v is number => typeof v === "number");
    const facts = {
      date: today,
      fields: fields.length,
      urgentCount: urgent.length,
      thisWeekCount: thisWeek.length,
      worthALookCount: worth.length,
      urgent: urgent.slice(0, 4).map(row),
      thisWeek: thisWeek.slice(0, 4).map(row),
      weatherToday: {
        lowestMinC: nums("tminC").length ? Math.min(...nums("tminC")) : null,
        highestMaxC: nums("tmaxC").length ? Math.max(...nums("tmaxC")) : null,
        maxRainMm: nums("precipMm").length ? Math.max(...nums("precipMm")) : null,
        nextFrost: weather.find((w) => w.nextFrost)?.nextFrost ?? null,
      },
    };
    const ai = this.daySummary.lookup(workspaceId, facts, names);
    return ai
      ? { text: ai, source: "ai" as const, meta: this.daySummary.metaFor(workspaceId, facts) }
      : null;
  }

  /** Today's forecast and the next frost per county, from cached forecasts only (no network in the request path). */
  private async weatherByCounty(
    fields: Array<{ county_name: string | null; admin_code: string | null; lat: number; lon: number }>,
    today: string,
  ) {
    const counties = new Map<
      string,
      { county: string; region: string | null; cell: string; fields: number }
    >();
    for (const f of fields) {
      const county = f.county_name ?? f.admin_code ?? "—";
      const key = `${county}|${f.admin_code}`;
      const c = counties.get(key);
      if (c) c.fields += 1;
      else
        counties.set(key, { county, region: f.admin_code, cell: forecastCell(f.lat, f.lon).key, fields: 1 });
    }
    const rows = await this.prisma.system.sourceCache.findMany({
      where: { key: { in: [...counties.values()].map((c) => `forecast:${c.cell}`) } },
    });
    const byCell = new Map(
      rows.map((r) => [
        r.key.slice("forecast:".length),
        { forecast: r.payload as unknown as Forecast, fetchedAt: r.fetchedAt },
      ]),
    );
    return [...counties.values()].map((c) => {
      const f = byCell.get(c.cell);
      const day = f?.forecast.days.find((d) => d.date === today) ?? null;
      const frost = f ? nextFrostDay(f.forecast) : null;
      return {
        county: c.county,
        region: c.region,
        fields: c.fields,
        today: day ? { tminC: day.tminC, tmaxC: day.tmaxC, precipMm: day.precipMm } : null,
        nextFrost: frost,
        attribution: f?.forecast.attribution ?? null,
        fetchedAt: f?.fetchedAt ?? null,
      };
    });
  }
}
