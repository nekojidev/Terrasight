import { createHash } from "node:crypto";
import { Inject, Injectable } from "@nestjs/common";
import { loadUaYields, normaliseAdminCode, type UaYieldsFile } from "@terrasight/library";
import {
  ENGINE_VERSION,
  hindcastSeasons,
  retrospective as runRetrospective,
  type EngineInput,
  type EngineResult,
  type Rotation,
} from "@terrasight/scenario-engine";
import type { Retrospective, TrustReport, TrustYear } from "@terrasight/shared";
import { CROPS, simulateSeason } from "@terrasight/simulator";
import { ENV, type Env } from "../config/config.js";
import { CropPricesService } from "../crop-prices/crop-prices.service.js";
import { PrismaService } from "../db/prisma.service.js";
import { ProblemException } from "../http/problem.js";
import { ScenariosService } from "../scenarios/scenarios.service.js";
import { CountyYieldsService } from "../yields/yields.service.js";
import {
  NOT_MODELLED,
  buildTable,
  missReason,
  type ActualPoint,
  type ActualSources,
  type SeasonRow,
} from "./hindcast.js";

/** The retrospective window (S-10.10): the five harvest years 2018…2022, when the weather has all of them. */
export const RETRO_SEASONS = [2018, 2019, 2020, 2021, 2022];

/** Library crop → crop key of data/ua-yields.json where the file has the crop itself (no aggregates such as "cereals"). */
const UA_CROP: Record<string, string> = {
  sunflower: "sunflower",
  sugar_beet: "sugar_beet",
  soybean: "soybean",
  potato: "potato",
  winter_canola: "rapeseed",
  spring_canola: "rapeseed",
};

/** Typical sowing date, as the engine does it (autumn dates belong to the year before harvest). */
function sowingDate(sowing: Record<string, string>, crop: string, year: number): string {
  const mmdd = sowing[crop] ?? "04-25";
  return `${Number(mmdd.slice(0, 2)) >= 8 ? year - 1 : year}-${mmdd}`;
}

const empty = (fieldId: string, status: TrustReport["status"], reason?: string): TrustReport => ({
  status,
  ...(reason ? { reason } : {}),
  fieldId,
  years: [],
  vsCounty: null,
  vsNdvi: null,
  actual: { kind: "none", connected: true, area: null, verified: false },
  case2022: null,
  notModelled: NOT_MODELLED,
  caveats: [],
  retrospective: null,
});

/** "How far can you trust this" (S-10.08, S-10.10): the simulator over past seasons against what happened. */
@Injectable()
export class TrustService {
  private readonly cache = new Map<string, TrustReport>();
  private uaYields: UaYieldsFile | null | undefined;

  constructor(
    @Inject(ENV) private readonly env: Env,
    private readonly prisma: PrismaService,
    private readonly scenarios: ScenariosService,
    private readonly yields: CountyYieldsService,
    private readonly prices: CropPricesService,
  ) {}

  async report(workspaceId: string, fieldId: string): Promise<TrustReport> {
    const field = await this.prisma.db.field.findFirst({
      where: { id: fieldId, workspaceId, archivedAt: null },
      select: { id: true, country: true, adminCode: true },
    });
    if (!field) throw new ProblemException(404, "not-found");
    const [history, seasons, lastRun] = await Promise.all([
      this.prisma.db.fieldHistory.findUnique({ where: { fieldId } }),
      this.prisma.db.cropSeason.findMany({ where: { fieldId }, orderBy: { season: "asc" } }),
      this.prisma.db.scenarioRun.findFirst({
        where: { fieldId },
        orderBy: { createdAt: "desc" },
        select: { id: true },
      }),
    ]);
    if (!history) return empty(fieldId, "pending");
    // A season counts when its crop is known: a library crop (not fallow, not an unmapped land-use class).
    const known = seasons.filter((s) => s.mainCrop !== "fallow" && !s.mainCrop.startsWith("other:"));
    if (!known.length) return empty(fieldId, "unavailable", "history-missing");

    let input: EngineInput;
    try {
      input = await this.scenarios.inputs(workspaceId, fieldId, {});
    } catch (e) {
      if (e instanceof ProblemException && e.getStatus() === 409) return empty(fieldId, "unavailable", "weather-missing");
      throw e;
    }
    if (!known.some((s) => CROPS[s.mainCrop])) return empty(fieldId, "unavailable", "no-crop-parameters");

    const lastYear = Math.max(...input.weatherByYear.keys());
    const key = createHash("sha256")
      .update(
        JSON.stringify([
          history.inputsHash,
          history.builtAt,
          known.map((s) => [s.season, s.mainCrop, s.source]),
          ENGINE_VERSION,
          input.weatherByYear.get(lastYear)?.at(-1)?.date,
          input.irrigated,
          lastRun?.id ?? null,
          field.country,
        ]),
      )
      .digest("hex");
    const hit = this.cache.get(`${fieldId}:${key}`);
    if (hit) return hit;

    const out = await this.compute(workspaceId, field, input, known, history.ndviPeaks);
    for (const k of this.cache.keys()) if (k.startsWith(`${fieldId}:`)) this.cache.delete(k);
    this.cache.set(`${fieldId}:${key}`, out);
    if (this.cache.size > 200) this.cache.delete(this.cache.keys().next().value!);
    return out;
  }

  private async compute(
    workspaceId: string,
    field: { id: string; country: string | null; adminCode: string | null },
    input: EngineInput,
    known: Array<{ season: number; mainCrop: string; secondCrop: string | null; source: string }>,
    ndviPeaks: unknown,
  ): Promise<TrustReport> {
    const fieldId = field.id;
    const hind = hindcastSeasons(
      input,
      known.map((s) => ({ year: s.season, crop: s.mainCrop })),
    );
    const peaks = new Map(
      ((ndviPeaks as Array<{ season: number; peak: number | null }> | null) ?? []).map((p) => [p.season, p.peak]),
    );
    const rows: SeasonRow[] = hind.map((h) => ({
      year: h.year,
      crop: h.crop,
      relative: h.relative,
      ndviPeak: peaks.get(h.year) ?? null,
    }));
    const caveats = new Set<string>(hind.flatMap((h) => h.caveats).filter((c) => !c.startsWith("no-weather:")));
    for (const h of hind) if (h.caveats.some((c) => c.startsWith("no-weather:"))) caveats.add(`no-weather:${h.year}`);
    if (known.some((s) => s.source === "ndvi")) caveats.add("estimated-crop-history");
    if (known.some((s) => s.secondCrop)) caveats.add("second-crop-ignored");

    const actual = await this.actual(field);
    const fieldPractice = input.irrigated ? "irrigated" : "non-irrigated";
    const table = buildTable(rows, actual.sources, fieldPractice, (row) => {
      const sowing = sowingDate(input.sowing, row.crop, row.year);
      const sim = simulateSeason(
        {
          site: input.site,
          crops: [{ crop: row.crop, sowing }],
          irrigated: input.irrigated,
          ...(input.waterCapMm !== undefined ? { waterCapMm: input.waterCapMm } : {}),
          startDepletionMm: 0,
        },
        input.weatherByYear.get(row.year) ?? [],
      );
      const harvest = sim.crops[0]?.harvest;
      return harvest ? missReason(row.year, input.weatherByYear, { sowing, harvest }) : "unknown";
    });
    for (const c of table.caveats) caveats.add(c);

    const noCounty = actual.sources.kind === "none" || !actual.connected;
    return {
      status: "ready",
      fieldId,
      years: table.years,
      vsCounty: noCounty ? null : table.vsCounty,
      vsNdvi: table.vsNdvi,
      actual: {
        kind: actual.sources.kind,
        connected: actual.connected,
        area: table.area ?? actual.area,
        verified: actual.sources.kind === "nass",
      },
      case2022: table.years.find((y: TrustYear) => y.year === 2022) ?? null,
      notModelled: NOT_MODELLED,
      caveats: [...caveats].sort(),
      retrospective: await this.retrospective(workspaceId, fieldId, input),
    };
  }

  /** Actual yields for the field: NASS county + state (US), Derzhstat oblast (Ukraine), none elsewhere. */
  private async actual(field: {
    id: string;
    country: string | null;
    adminCode: string | null;
  }): Promise<{ sources: ActualSources; connected: boolean; area: string | null }> {
    const blank: ActualSources = { kind: "none", connected: true, county: {}, state: {}, oblast: false };
    if (field.country === "US") {
      const r = await this.yields.forField(field.id);
      if (!r.connected) return { sources: { ...blank, kind: "nass", connected: false }, connected: false, area: null };
      if (r.kind === "none") return { sources: blank, connected: true, area: null };
      const conv = (m: Record<string, Array<{ year: number; tPerHa: number; practice: string }>>, area: string) =>
        Object.fromEntries(
          Object.entries(m).map(([c, pts]) => [c, { area, points: pts as ActualPoint[] }]),
        );
      return {
        sources: {
          kind: "nass",
          connected: true,
          county: conv(r.crops, r.area),
          state: conv(r.state.crops, r.state.area),
          oblast: false,
        },
        connected: true,
        area: r.area,
      };
    }
    if (field.adminCode?.startsWith("UA-")) {
      if (this.uaYields === undefined) this.uaYields = loadUaYields(this.env.DATA_DIR);
      const code = normaliseAdminCode(field.adminCode);
      const oblast = this.uaYields ? Object.values(this.uaYields.oblasts).find((o) => o.iso === code) : undefined;
      if (oblast) {
        const county: ActualSources["county"] = {};
        for (const [crop, ua] of Object.entries(UA_CROP)) {
          const series = oblast.yieldTHa[ua];
          if (!series) continue;
          county[crop] = {
            area: `${oblast.en} oblast (State Statistics Service, unverified)`,
            points: Object.entries(series).map(([y, v]) => ({ year: Number(y), tPerHa: v, practice: "all" as const })),
          };
        }
        return {
          sources: { kind: "derzhstat", connected: true, county, state: {}, oblast: true },
          connected: true,
          area: `${oblast.en} oblast (State Statistics Service, unverified)`,
        };
      }
    }
    return { sources: blank, connected: true, area: null };
  }

  /**
   * Retrospective 2018–2022 (S-10.10): the field's current rotation and the recommended option of the latest default
   * rotation run, each simulated over the real weather of those years with today's prices. A comparison of two
   * simulations, not what the field earned. Null without a stored run, without the weather, or when the run cannot be
   * built.
   */
  private async retrospective(workspaceId: string, fieldId: string, input: EngineInput): Promise<Retrospective | null> {
    if (!RETRO_SEASONS.every((y) => (input.weatherByYear.get(y)?.length ?? 0) >= 360)) return null;
    // Reads the latest stored run, never computes one (a GET must not start a 60 s simulation). Runs made with a
    // different year set are skipped; runs do not record the water cap / climate sliders, so a run made with a slider
    // cannot be told apart from the default (the scenarios page stores both the same way).
    const rows = await this.prisma.db.scenarioRun.findMany({
      where: { fieldId },
      orderBy: { createdAt: "desc" },
      take: 10,
      select: { result: true },
    });
    const result = rows
      .map((r) => r.result as unknown as EngineResult)
      .find((r) => r?.current && (!r.weather || r.weather.yearSet === "all"));
    if (!result) return null;
    try {
      const mode = result.mode ?? "money";
      const currency = await this.prices.currency(workspaceId);
      const recId = result.bestFit ?? result.current.id;
      const rec = [result.current, ...result.alternatives].find((s) => s.id === recId) ?? result.current;
      const back = input.firstSeason - RETRO_SEASONS[0]!;
      const start = (seq: Rotation["sequence"], position: number) =>
        (((position - back) % seq.length) + seq.length) % seq.length;
      const cur = { id: input.current.rotationId ?? "current", sequence: input.current.sequence, position: input.current.position };
      // Library rotations run with their own sequence; an AI-proposed one only has its 5-season plan, used as the cycle.
      const lib = input.rotations.find((r) => r.id === rec.id);
      const recSeq = (lib?.sequence ?? rec.plan.map((p) => (p.crops.length > 1 ? { main: p.crops[0]!, second: p.crops[1]! } : (p.crops[0] ?? "fallow")))) as Rotation["sequence"];
      const same = rec.id === cur.id || rec.id === result.current.id;
      const scenarios = [
        { id: cur.id, sequence: cur.sequence, position: start(cur.sequence, cur.position) },
        ...(same ? [] : [{ id: rec.id, sequence: recSeq, position: start(recSeq, 0) }]),
      ];
      let engineInput: EngineInput = input;
      if (mode === "agronomy") {
        engineInput = {
          ...input,
          yieldRefs: {
            ...input.yieldRefs,
            ...Object.fromEntries(Object.entries(input.prices).map(([c, e]) => [c, e.yieldRef])),
          },
          prices: {},
          agronomyOnly: true,
        };
      }
      const out = runRetrospective(engineInput, { seasons: RETRO_SEASONS, scenarios });
      const scale = mode === "agronomy" ? 100 : 1;
      const shape = (o: (typeof out)[number], id: string) => {
        const bySeason = o.bySeason.map((v) => (Number.isFinite(v) ? Math.round(v * scale * 10) / 10 : null));
        return {
          id,
          bySeason,
          total: bySeason.every((v) => v !== null) ? Math.round(bySeason.reduce((a, b) => a! + b!, 0)! * 10) / 10 : null,
        };
      };
      const c = shape(out[0]!, cur.id);
      return {
        seasons: RETRO_SEASONS,
        mode,
        currency: mode === "money" ? currency : null,
        current: c,
        recommended: same ? { ...c } : shape(out[1]!, rec.id),
        priceBasis: "today",
      };
    } catch {
      return null;
    }
  }
}
