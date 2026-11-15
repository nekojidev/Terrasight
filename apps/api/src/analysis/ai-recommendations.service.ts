import { Inject, Injectable, Logger } from "@nestjs/common";
import { daysUntil } from "@terrasight/evaluators";
import type { Library } from "@terrasight/library";
import type { SafetyFilter } from "@terrasight/assistant-core";
import { aiEnabled, GeminiJson, loadSafety } from "../ai/gemini-json.js";
import { ENV, type Env } from "../config/config.js";
import { PrismaService } from "../db/prisma.service.js";
import { Prisma } from "../generated/prisma/client.js";
import type { RecStatus, RecType } from "../generated/prisma/enums.js";
import { LIBRARY } from "../library/library.module.js";
import { recommendationText, value as textValue } from "../recommendations/text.js";
import type { BuiltInputs } from "./eval-inputs.service.js";
import {
  batchSchema,
  hashOf,
  SYSTEM,
  validateBatch,
  type Rejected,
  type WrittenText,
} from "./ai-text.js";

const LIVE: RecStatus[] = ["open", "accepted", "snoozed", "in_report", "dismissed"];
/** Items that get AI text: the ones that fire (or are unknown); low / none are not shown as rows. */
const TEXT_LEVELS = ["high", "moderate", "unknown"] as const;
const DISEASE_KINDS = new Set(["fungus", "oomycete", "bacteria", "virus", "mycotoxin"]);
const CACHE_MAX = 500;
const WATCH_CANDIDATES = 10;
const BREAKER_FAILURES = 3;
const BREAKER_MS = 5 * 60_000;

export interface AiTextRecord {
  source: "ai" | "template";
  hash: string;
  at: string;
  reason?: string;
  title?: WrittenText["title"];
  action?: WrittenText["action"];
  why?: WrittenText["why"];
}

export interface AiStats {
  calls: number;
  failures: number;
  tokensIn: number;
  tokensOut: number;
  tokensThoughts: number;
  aiTexts: number;
  templateFallbacks: number;
  cacheHits: number;
  watchKept: number;
  watchDropped: number;
}

const round1 = (n: number) => Math.round(n * 10) / 10;

/** A weather summary the texts may quote: last 7 observed days and the next 7 forecast days (rounded to 0.1). */
export function weatherSummary(weather: BuiltInputs["inputs"]["weather"], asOf: string) {
  const agg = (rows: typeof weather) => {
    const n = (k: "tminC" | "tmaxC") => rows.map((r) => r[k]).filter((v): v is number => v !== null);
    const p = rows.map((r) => r.precipMm).filter((v): v is number => v !== null);
    return {
      days: rows.length,
      lowestMinC: n("tminC").length ? round1(Math.min(...n("tminC"))) : null,
      highestMaxC: n("tmaxC").length ? round1(Math.max(...n("tmaxC"))) : null,
      rainMm: p.length ? round1(p.reduce((a, b) => a + b, 0)) : null,
    };
  };
  const past = weather.filter((w) => w.origin !== "forecast" && w.date <= asOf).slice(-7);
  const next = weather.filter((w) => w.date > asOf).slice(0, 7);
  return { last7Days: agg(past), next7Days: agg(next) };
}

/**
 * AI-written recommendation texts and watch-items for one field check (PD v2.11). One batched Gemini call per field:
 * the changed evaluator results (title / action / why in EN and UK) plus up to two qualitative "worth scouting" items
 * for library pests with no verified model. Cached by facts hash; every text is number-checked and safety-filtered, and
 * any failure leaves the template text in place.
 */
@Injectable()
export class AiRecommendationsService {
  private readonly log = new Logger(AiRecommendationsService.name);
  private readonly safety: SafetyFilter;
  /** Replaceable in tests (`gemini.client`); null without an API key. */
  readonly gemini: GeminiJson;
  private readonly cache = new Map<string, WrittenText>();
  private failures = 0;
  private openUntil = 0;
  readonly stats: AiStats = {
    calls: 0,
    failures: 0,
    tokensIn: 0,
    tokensOut: 0,
    tokensThoughts: 0,
    aiTexts: 0,
    templateFallbacks: 0,
    cacheHits: 0,
    watchKept: 0,
    watchDropped: 0,
  };

  constructor(
    @Inject(ENV) private readonly env: Env,
    @Inject(LIBRARY) private readonly lib: Library,
    private readonly prisma: PrismaService,
  ) {
    this.gemini = new GeminiJson(env, this.log);
    this.safety = loadSafety(env, this.log);
  }

  enabled(): boolean {
    return aiEnabled(this.env.AI_RECOMMENDATIONS, !!this.gemini.client);
  }

  /** Candidate library pests for a watch-item: host crop and region match, no verified model, not already a live item. */
  watchCandidates(crop: string | null, regionId: string | null, taken: Set<string>) {
    if (!crop || !regionId) return [];
    const modelled = new Set(this.lib.enabledModels.map((m) => m.pest));
    return this.lib.pests.pests
      .filter(
        (p) =>
          !modelled.has(p.id) &&
          !taken.has(p.id) &&
          p.crops.includes(crop) &&
          (p.regions.length === 0 || p.regions.includes(regionId)),
      )
      .slice(0, WATCH_CANDIDATES);
  }

  /** How to write a value in words: an ISO date as a natural date, a crop id as the crop's name (EN and UK). */
  private display(v: unknown): { as?: { en: string; uk: string } } {
    if (typeof v !== "string") return {};
    if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return { as: { en: textValue(v, "en"), uk: textValue(v, "uk") } };
    const crop = this.lib.rotations.crops[v] as { en: string; uk: string } | undefined;
    return crop ? { as: { en: crop.en.toLowerCase(), uk: crop.uk.toLowerCase() } } : {};
  }

  private recFacts(
    r: {
      id: string;
      type: string;
      subject: string;
      season: number;
      level: string;
      confidence: string;
      planning: boolean;
      deadline: Date | null;
      keyNumbers: unknown;
      drivers: unknown;
      evidence: unknown;
      unknowns: unknown;
    },
    asOf: string,
  ) {
    const pest = this.lib.pests.pests.find((p) => p.id === r.subject);
    const deadline = r.deadline ? r.deadline.toISOString().slice(0, 10) : null;
    const drivers = ((r.drivers as Array<{ driver: string; value: unknown; fired: boolean }>) ?? [])
      .filter((d) => d.fired)
      .map((d) => ({
        driver: this.lib.pests.drivers[d.driver]?.en ?? d.driver.replace(/_/g, " "),
        value: d.value,
        ...this.display(d.value),
      }));
    const evidence = ((r.evidence as Array<Record<string, unknown>>) ?? [])
      .filter((e) => e.kind !== "citation" && e.kind !== "scouting")
      .slice(0, 6)
      .map((e) => ({ source: e.source, from: e.from, to: e.to, value: e.value, unit: e.unit, note: e.note }));
    const base = recommendationText(
      { ...r, keyNumbers: r.keyNumbers, drivers: r.drivers } as Parameters<typeof recommendationText>[0],
      this.lib,
    );
    return {
      ref: r.id,
      type: r.type,
      subject: pest ? pest.name.en : r.subject,
      ...(pest
        ? {
            pest: {
              nameUk: pest.name.uk,
              kind: pest.kind,
              season: pest.season.en,
              damage: pest.damage.en,
              riskWhen: pest.riskWhen.en,
              scout: pest.scout.en,
              prevent: pest.prevent.en,
            },
          }
        : {}),
      level: r.level,
      confidence: r.confidence,
      planning: r.planning,
      deadline,
      daysToDeadline: deadline ? daysUntil(deadline, new Date(`${asOf}T12:00:00Z`), "UTC") : null,
      keyNumbers: ((r.keyNumbers as Array<{ id: string; value: unknown; unit?: string }>) ?? []).map((k) => ({
        id: k.id,
        value: k.value,
        ...(k.unit ? { unit: k.unit } : {}),
        ...this.display(k.value),
      })),
      drivers,
      evidence,
      unknowns: r.unknowns,
      templateText: { title: base.title.en, action: base.action.en, why: base.why.en },
    };
  }

  /** Writes the day's AI texts for a field. Never throws: a failure leaves the template texts. */
  async enrich(fieldId: string, built: BuiltInputs, asOf: string): Promise<void> {
    if (!this.enabled()) return;
    try {
      await this.run(fieldId, built, asOf);
    } catch (e) {
      this.log.warn(`AI recommendations for ${fieldId} skipped: ${(e as Error).message}`);
    }
  }

  private async run(fieldId: string, built: BuiltInputs, asOf: string): Promise<void> {
    const { inputs } = built;
    const season = inputs.season;
    // The crop in the ground, else the crop planned for next season, else the latest crop of the history (at most two
    // seasons back): the watch-items are qualitative, so a close guess is enough and the facts say where it came from.
    const latest = [...inputs.crops].sort((a, b) => b.season - a.season)[0];
    const crop =
      inputs.record.crop.value ??
      inputs.nextCrop.crop ??
      (latest && latest.season >= season - 2 ? latest.mainCrop : null);
    const live = await this.prisma.system.recommendation.findMany({
      where: { fieldId, season, status: { in: LIVE } },
    });
    const model = this.env.GEMINI_MODEL;
    const shared = {
      season,
      today: asOf,
      crop,
      growthStage: built.stage,
      sowingDate: inputs.record.sowingDate.value,
      emergenceDate: inputs.record.emergenceDate.value,
      region: inputs.regionId,
      dataTier: inputs.tier,
      nextCrop: inputs.nextCrop.crop,
      history: [...inputs.crops]
        .sort((a, b) => a.season - b.season)
        .slice(-5)
        .map((c) => ({ season: c.season, crop: c.mainCrop, ...(c.secondCrop ? { second: c.secondCrop } : {}) })),
      weather: weatherSummary(inputs.weather, asOf),
    };
    // What the hash of an item depends on: its facts, the crop / stage / season context and the model.
    const context = { season, crop, stage: built.stage, region: inputs.regionId, model };

    // 1. Evaluator results whose facts changed since their text was written.
    const itemFacts = new Map<string, ReturnType<AiRecommendationsService["recFacts"]>>();
    const hashes = new Map<string, string>();
    for (const r of live) {
      if (r.aiSuggested || !["pest", "disease", "weather", "irrigation"].includes(r.type)) continue;
      if (!(TEXT_LEVELS as readonly string[]).includes(r.level) || !["open", "snoozed", "accepted"].includes(r.status))
        continue;
      const f = this.recFacts(r, asOf);
      const { ref: _ref, ...hashed } = f;
      const hash = hashOf({ f: hashed, context });
      if ((r.aiText as AiTextRecord | null)?.hash === hash) continue;
      itemFacts.set(r.id, f);
      hashes.set(r.id, hash);
    }
    // Facts seen before (same crop, stage and numbers on another field) reuse the text without a call.
    const pending = new Map<string, ReturnType<AiRecommendationsService["recFacts"]>>();
    for (const [id, f] of itemFacts) {
      const hit = this.cache.get(hashes.get(id)!);
      if (hit) {
        this.stats.cacheHits += 1;
        await this.saveText(id, { source: "ai", hash: hashes.get(id)!, at: new Date().toISOString(), ...hit });
      } else pending.set(id, f);
    }

    // 2. Watch-items: pests without a verified model that suit this crop and region.
    const taken = new Set(live.filter((r) => !r.aiSuggested).map((r) => r.subject));
    const candidates = this.watchCandidates(crop, inputs.regionId, taken);
    const watchHash = hashOf({ ids: candidates.map((c) => c.id), crop, region: inputs.regionId, season, month: asOf.slice(0, 7), model });
    const cacheKey = `ai-watch:${fieldId}`;
    const stored = await this.prisma.system.sourceCache.findUnique({ where: { key: cacheKey } });
    const needWatch = candidates.length > 0 && (stored?.payload as { hash?: string } | null)?.hash !== watchHash;
    // A watch-item whose pest no longer qualifies (a verified model now covers it, or the crop changed) leaves the brief.
    const stale = live.filter(
      (r) => r.aiSuggested && ["open", "snoozed"].includes(r.status) && !candidates.some((c) => c.id === r.subject),
    );
    if (stale.length)
      await this.prisma.system.recommendation.updateMany({
        where: { id: { in: stale.map((r) => r.id) } },
        data: { status: "superseded" },
      });

    if (!pending.size && !needWatch) return;
    if (Date.now() < this.openUntil) {
      for (const id of pending.keys()) await this.saveText(id, null);
      return;
    }

    // 3. One batched call.
    const watchFacts = new Map(
      candidates.map((p) => [
        p.id,
        {
          pestId: p.id,
          name: p.name.en,
          kind: p.kind,
          season: p.season.en,
          damage: p.damage.en,
          riskWhen: p.riskWhen.en,
          scout: p.scout.en,
          nameUk: p.name.uk,
        },
      ]),
    );
    const prompt = JSON.stringify({
      field: shared,
      items: [...pending.values()],
      ...(needWatch ? { watchCandidates: [...watchFacts.values()] } : {}),
    });
    let call;
    try {
      this.stats.calls += 1;
      call = await this.gemini.call(SYSTEM, prompt, batchSchema(needWatch));
      this.failures = 0;
    } catch (e) {
      this.stats.failures += 1;
      if (++this.failures >= BREAKER_FAILURES) this.openUntil = Date.now() + BREAKER_MS;
      this.log.warn(`AI recommendations unavailable: ${(e as Error).message}`);
      for (const id of pending.keys()) await this.saveText(id, null);
      return;
    }
    this.stats.tokensIn += call.tokens.in ?? 0;
    this.stats.tokensOut += call.tokens.out ?? 0;
    this.stats.tokensThoughts += call.tokens.thoughts;
    const v = validateBatch(
      call.json,
      new Map([...pending].map(([id, f]) => [id, f])),
      shared,
      needWatch ? watchFacts : new Map(),
      this.safety,
    );
    const rejected: Rejected[] = [...v.rejected];
    const at = new Date().toISOString();
    for (const id of pending.keys()) {
      const hash = hashes.get(id)!;
      const w = v.items.get(id);
      if (w) {
        this.stats.aiTexts += 1;
        this.cache.set(hash, w);
        if (this.cache.size > CACHE_MAX) this.cache.delete(this.cache.keys().next().value!);
        await this.saveText(id, { source: "ai", hash, at, ...w });
      } else {
        this.stats.templateFallbacks += 1;
        // Facts unchanged next time: do not ask again for the same facts, show the template text.
        await this.saveText(id, {
          source: "template",
          hash,
          at,
          reason: rejected.find((x) => x.id === id)?.reason ?? "missing from the response",
        });
      }
    }
    if (needWatch) {
      await this.saveWatch(fieldId, built, v.watch, live, at);
      this.stats.watchKept += v.watch.length;
      this.stats.watchDropped += v.rejected.filter((x) => x.id.startsWith("watch:")).length;
      await this.prisma.system.sourceCache.upsert({
        where: { key: cacheKey },
        create: { key: cacheKey, source: "ai-watch", params: {}, payload: { hash: watchHash }, fetchedAt: new Date() },
        update: { payload: { hash: watchHash }, fetchedAt: new Date() },
      });
      // A watch-item the assistant no longer proposes leaves the brief.
      const keep = new Set(v.watch.map((w) => w.pestId));
      await this.prisma.system.recommendation.updateMany({
        where: { fieldId, season, aiSuggested: true, status: { in: ["open", "snoozed"] }, subject: { notIn: [...keep] } },
        data: { status: "superseded" },
      });
    }
    for (const r of rejected) this.log.warn(`AI text rejected (${r.id}): ${r.reason}`);
    this.log.log(
      `AI recommendations ${fieldId}: ${v.items.size}/${pending.size} texts, ${v.watch.length} watch; tokens in ${call.tokens.in ?? "?"} out ${call.tokens.out ?? "?"} thoughts ${call.tokens.thoughts}`,
    );
  }

  private async saveText(id: string, rec: AiTextRecord | null): Promise<void> {
    await this.prisma.system.recommendation.update({
      where: { id },
      data: { aiText: rec === null ? Prisma.DbNull : (rec as unknown as Prisma.InputJsonValue) },
    });
  }

  private async saveWatch(
    fieldId: string,
    built: BuiltInputs,
    watch: Array<WrittenText & { pestId: string }>,
    live: Array<{ id: string; type: string; subject: string; aiSuggested: boolean }>,
    at: string,
  ): Promise<void> {
    const { inputs } = built;
    const workspaceId = (await this.prisma.system.field.findUniqueOrThrow({
      where: { id: fieldId },
      select: { workspaceId: true },
    })).workspaceId;
    for (const w of watch) {
      const pest = this.lib.pests.pests.find((p) => p.id === w.pestId)!;
      const type: RecType = DISEASE_KINDS.has(pest.kind) ? "disease" : "pest";
      const text: AiTextRecord = {
        source: "ai",
        hash: hashOf({ pest: w.pestId, season: inputs.season }),
        at,
        title: w.title,
        action: w.action,
        why: w.why,
      };
      const existing = live.find((r) => r.subject === w.pestId && r.type === type);
      if (existing) {
        if (existing.aiSuggested) await this.saveText(existing.id, text);
        continue;
      }
      await this.prisma.system.recommendation.create({
        data: {
          workspaceId,
          fieldId,
          type,
          subject: w.pestId,
          season: inputs.season,
          level: "unknown",
          confidence: "low",
          tier: inputs.tier,
          aiSuggested: true,
          aiText: text as unknown as Prisma.InputJsonValue,
        },
      });
    }
  }
}
