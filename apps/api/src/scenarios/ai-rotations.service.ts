import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Inject, Injectable, Logger } from "@nestjs/common";
import { GoogleGenAI, ThinkingLevel, Type } from "@google/genai";
import { createSafetyFilter, parseActives, splitSentences, type SafetyFilter } from "@terrasight/assistant-core";
import { stableStringify } from "@terrasight/evaluators";
import type { Library } from "@terrasight/library";
import { ENGINE_VERSION, pestPressure, planSeasons, type EngineInput, type Rotation } from "@terrasight/scenario-engine";
import { CROPS } from "@terrasight/simulator";
import { ENV, type Env } from "../config/config.js";

/**
 * AI-proposed rotations (Product Definition v2.8). The assistant only proposes crop sequences and a short reason; every
 * number shown for them comes from the scenario engine. Proposals that break a rule are dropped and logged, never fixed.
 */

export const PROPOSAL_TIMEOUT_MS = 15_000;
const MIN_PROPOSALS = 3;
const MAX_PROPOSALS = 5;
const SEASONS = 5;
const MAX_FALLOW = 2;
const CACHE_TTL_MS = 24 * 3600_000;
const CACHE_MAX = 200;

export type AiStatus = "ok" | "unavailable" | "skipped";
type Text = { en: string; uk: string };

export interface HistoryEntry {
  season: number;
  crop: string;
  second?: string | null;
  /** cdl / lpis = official crop map, estimate = satellite curve guess, agronomist = entered or corrected by hand. */
  source: "cdl" | "lpis" | "estimate" | "agronomist";
}

/** Everything the prompt and the validator know about the field. Contains no field name or location. */
export interface ProposalContext {
  regionId: string;
  regionName: Text;
  countries: string[];
  tier: "A" | "B" | "C";
  irrigated: boolean;
  southern: boolean;
  firstSeason: number;
  soil: { waterCapacityMmPerM: number; hydrologicGroup: string; basis: string };
  climate: { meanSeasonRainfallMm: number; meanSeasonTempC: number; weatherYears: number } | null;
  history: HistoryEntry[];
  currentRotation: { basis: string; sequence: Rotation["sequence"] };
  /** Crops with simulator parameters and a verified price in the region (irrigation-only crops removed on dryland). */
  allowed: Array<{ id: string; name: string }>;
  /** Crops that need irrigation to be grown at all (derived from the library); never allowed on dryland. */
  irrigationOnly: string[];
  /** "main+second" pairs the region's library uses for double cropping; empty = double cropping not offered. */
  doubleCrops: string[];
  libraryExamples: Array<{ name: string; sequence: Rotation["sequence"] }>;
  pestModels: NonNullable<EngineInput["pestModels"]>;
  /** Plans (comma-joined crops per season) that already exist: library rotations from the first season and the current one. */
  existingPlans: string[];
}

export interface Proposal {
  id: string;
  name: Text;
  sequence: Rotation["sequence"];
  rationale: Text;
}

export interface Dropped {
  name: string;
  reason: string;
}

interface RawProposal {
  name?: { en?: unknown; uk?: unknown };
  sequence?: unknown;
  rationale?: { en?: unknown; uk?: unknown };
}

const cropsOfItem = (s: Rotation["sequence"][number]): string[] =>
  typeof s === "string" ? (s === "fallow" ? [] : [s]) : [s.main, s.second].filter((c) => c !== "fallow");

const planKey = (seq: Rotation["sequence"]) => seq.map((s) => cropsOfItem(s).join("+") || "fallow").join(",");

/** Crops that appear in the library only in rotations that require irrigation (e.g. rice), so they need water to be grown. */
export function irrigationOnlyCrops(rotations: Library["rotations"]["rotations"]): string[] {
  const needs = new Map<string, boolean>();
  for (const r of rotations)
    for (const c of r.sequence.flatMap(cropsOfItem))
      needs.set(c, (needs.get(c) ?? true) && r.irrigation === "required");
  return [...needs].filter(([, n]) => n).map(([c]) => c).sort();
}

/** "main+second" pairs used for double cropping in the region's library rotations. */
export function doubleCropPairs(rotations: Array<Pick<Rotation, "sequence">>): string[] {
  return [
    ...new Set(
      rotations.flatMap((r) =>
        r.sequence.flatMap((s) => (typeof s === "object" ? [`${s.main}+${s.second}`] : [])),
      ),
    ),
  ].sort();
}

export interface Validated {
  valid: Array<Proposal>;
  dropped: Dropped[];
}

/** Rule checks. A proposal that fails any rule is dropped (with the reason); nothing is corrected silently. */
export function validateProposals(
  raw: unknown,
  ctx: ProposalContext,
  safety: SafetyFilter = createSafetyFilter([]),
): Validated {
  const list = Array.isArray(raw) ? (raw as RawProposal[]) : [];
  const dropped: Dropped[] = [];
  const valid: Proposal[] = [];
  const seen = new Set(ctx.existingPlans);
  const allowed = new Set(ctx.allowed.map((a) => a.id));
  const irrOnly = new Set(ctx.irrigationOnly);
  const pairs = new Set(ctx.doubleCrops);
  const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");
  for (const [i, p] of list.entries()) {
    const label = str(p?.name?.en) || `#${i + 1}`;
    const drop = (reason: string) => dropped.push({ name: label, reason });
    const name = { en: str(p?.name?.en), uk: str(p?.name?.uk) };
    const rationale = { en: str(p?.rationale?.en), uk: str(p?.rationale?.uk) };
    if (!name.en || !name.uk || !rationale.en || !rationale.uk) {
      drop("missing text");
      continue;
    }
    if (!Array.isArray(p.sequence) || p.sequence.length !== SEASONS || p.sequence.some((c) => typeof c !== "string")) {
      drop(`sequence is not ${SEASONS} crop ids`);
      continue;
    }
    const tokens = (p.sequence as string[]).map((t) => t.trim());
    const bad = tokens.find((t) => {
      if (t === "fallow") return false;
      if (t.includes("+")) {
        const [a, b] = t.split("+");
        return !(pairs.has(t) && allowed.has(a!) && allowed.has(b!) && !!CROPS[a!] && !!CROPS[b!]);
      }
      return !allowed.has(t) || !CROPS[t];
    });
    if (bad) {
      drop(`crop not allowed or unknown: ${bad}`);
      continue;
    }
    const sequence: Rotation["sequence"] = tokens.map((t) => {
      if (!t.includes("+")) return t;
      const [main, second] = t.split("+");
      return { main: main!, second: second! };
    });
    const cropList = sequence.flatMap(cropsOfItem);
    if (!ctx.irrigated && cropList.some((c) => irrOnly.has(c))) {
      drop("crop that needs irrigation on a dryland field");
      continue;
    }
    const fallows = sequence.filter((s) => cropsOfItem(s).length === 0).length;
    if (fallows > MAX_FALLOW || SEASONS - fallows < 3) {
      drop("too many fallow seasons");
      continue;
    }
    // The same crop in 3+ consecutive seasons (history counts) is a host repeat; so is a verified pest model's threshold.
    const prior = ctx.history.slice(-4).map((h) => cropsOfItem(h.second ? { main: h.crop, second: h.second } : h.crop));
    const seqSets = [...prior, ...sequence.map(cropsOfItem)];
    let repeat = false;
    for (let k = prior.length; k < seqSets.length; k++) {
      let run = 1;
      for (let j = k - 1; j >= 0 && seqSets[j]!.some((c) => seqSets[k]!.includes(c)); j--) run++;
      if (run >= 3) repeat = true;
    }
    if (repeat) {
      drop("same crop in 3 or more seasons in a row");
      continue;
    }
    const plan = planSeasons(sequence, 0, ctx.firstSeason);
    const hist = ctx.history.slice(-3).map((h) => h.crop);
    if (pestPressure(plan, hist, ctx.pestModels).some((x) => x.seasons > 0)) {
      drop("host repeat beyond a verified pest model threshold");
      continue;
    }
    if (seen.has(planKey(sequence))) {
      drop("duplicates a library, current or earlier proposed sequence");
      continue;
    }
    // Rationale: no digits (every number must come from the engine), at most 2 sentences, no product or dose.
    const textBad = (t: string, lang: "en" | "uk") =>
      /\d/.test(t) || splitSentences(t, lang).length > 2 || safety.sentence(t, lang).blocked !== null;
    if (/\d/.test(rationale.en + rationale.uk + name.en + name.uk)) {
      drop("number in the text");
      continue;
    }
    if (textBad(rationale.en, "en") || textBad(rationale.uk, "uk")) {
      drop("rationale longer than 2 sentences or names a product");
      continue;
    }
    seen.add(planKey(sequence));
    const id = `ai:${createHash("sha256")
      .update(`${ctx.firstSeason}|${planKey(sequence)}`)
      .digest("hex")
      .slice(0, 10)}`;
    valid.push({ id, name, sequence, rationale });
    if (valid.length === MAX_PROPOSALS) break;
  }
  return { valid, dropped };
}

/** Proposals as engine candidates: the same shape as a library rotation, flagged source "ai". */
export function toRotations(proposals: Proposal[], irrigated: boolean): Rotation[] {
  return proposals.map((p) => ({
    id: p.id,
    sequence: p.sequence,
    irrigation: irrigated ? "optional" : "none",
    source: "ai" as const,
  }));
}

const SYSTEM = `You help an agronomist plan crop rotations. Propose between ${MIN_PROPOSALS} and ${MAX_PROPOSALS} different crop sequences, one crop per season, for the seasons listed in "seasons".
Rules:
- Use only crop ids from "allowedCrops". "fallow" is allowed for at most ${MAX_FALLOW} seasons. A "main+second" item (double cropping) is allowed only if it appears in "doubleCrops".
- Do not repeat the same crop in 3 or more seasons in a row, counting "history" and "currentRotation". Respect "hostRepeatLimits": do not let a listed host crop follow another host of the same pest for that many seasons or more.
- Do not copy "libraryExamples" or "currentRotation"; offer sensible different ideas that fit the field's soil, climate, irrigation and history.
- "history" source: "cdl"/"lpis" = official crop map, "estimate" = satellite guess (less reliable), "agronomist" = entered by the agronomist (most reliable).
- For each proposal give a short name and a rationale of at most 2 sentences, in English ("en") and natural, fluent Ukrainian ("uk"). In the rationale and the name write NO digits or numbers at all and name no pesticide, product or dose. Explain the agronomic reason only (soil water, disease break, nitrogen, workload, risk).
- Do not state yields, prices, margins or any figure: the app computes them.`;

function schema() {
  const text = {
    type: Type.OBJECT,
    properties: { en: { type: Type.STRING }, uk: { type: Type.STRING } },
    required: ["en", "uk"],
  };
  return {
    type: Type.ARRAY,
    minItems: String(MIN_PROPOSALS),
    maxItems: String(MAX_PROPOSALS),
    items: {
      type: Type.OBJECT,
      properties: {
        name: text,
        sequence: {
          type: Type.ARRAY,
          items: { type: Type.STRING },
          minItems: String(SEASONS),
          maxItems: String(SEASONS),
        },
        rationale: text,
      },
      required: ["name", "sequence", "rationale"],
      propertyOrdering: ["name", "sequence", "rationale"],
    },
  };
}

/** The compact, factual user message (no field name, no coordinates). */
export function buildPrompt(ctx: ProposalContext): string {
  const seasons = Array.from({ length: SEASONS }, (_, k) => ctx.firstSeason + k);
  return JSON.stringify({
    seasons,
    region: { id: ctx.regionId, name: ctx.regionName.en },
    countries: ctx.countries,
    dataTier: ctx.tier,
    irrigated: ctx.irrigated,
    southernHemisphere: ctx.southern,
    soil: ctx.soil,
    climate: ctx.climate,
    history: ctx.history,
    currentRotation: { basis: ctx.currentRotation.basis, sequence: ctx.currentRotation.sequence.map(cropLabel) },
    allowedCrops: ctx.allowed,
    doubleCrops: ctx.doubleCrops,
    hostRepeatLimits: ctx.pestModels.map((m) => ({ hosts: m.hosts, seasonsInARow: m.repeatSeasons })),
    libraryExamples: ctx.libraryExamples.map((e) => ({ name: e.name, sequence: e.sequence.map(cropLabel) })),
  });
}
const cropLabel = (s: Rotation["sequence"][number]) => (typeof s === "string" ? s : `${s.main}+${s.second}`);

interface CacheEntry {
  at: number;
  proposals: Proposal[];
}

/** Asks Gemini for rotation ideas (structured JSON), validates them, caches them per field inputs + engine + model. */
@Injectable()
export class AiRotationsService {
  private readonly log = new Logger(AiRotationsService.name);
  private readonly safety: SafetyFilter;
  /** Replaceable in tests; null when there is no API key. */
  client: Pick<GoogleGenAI, "models"> | null;
  private thinking = true;
  private readonly cache = new Map<string, CacheEntry>();
  private readonly inflight = new Map<string, Promise<Proposal[]>>();

  constructor(@Inject(ENV) private readonly env: Env) {
    this.client = env.GEMINI_API_KEY ? new GoogleGenAI({ apiKey: env.GEMINI_API_KEY }) : null;
    let actives: string[] = [];
    try {
      actives = parseActives(readFileSync(join(env.DATA_DIR, "safety", "actives.txt"), "utf8"));
    } catch {
      this.log.warn("data/safety/actives.txt missing: only dose patterns are filtered");
    }
    this.safety = createSafetyFilter(actives);
  }

  /** On when AI_ROTATIONS=1, or by default when a Gemini key is set (AI_ROTATIONS=0 turns it off). */
  enabled(): boolean {
    return this.env.AI_ROTATIONS ? this.env.AI_ROTATIONS === "1" && !!this.client : !!this.client;
  }

  private key(ctx: ProposalContext): string {
    return createHash("sha256")
      .update(stableStringify({ ctx, engine: ENGINE_VERSION, model: this.env.GEMINI_MODEL }))
      .digest("hex");
  }

  /**
   * mode "cached" never calls Gemini (background recomputes): it reuses earlier proposals if there are any.
   * Failures and timeouts return status "unavailable" with no proposals; the library results are shown alone.
   */
  async propose(
    ctx: ProposalContext,
    mode: "generate" | "cached" = "generate",
  ): Promise<{ status: AiStatus; proposals: Proposal[] }> {
    if (!this.enabled() || ctx.allowed.length < 3) return { status: "skipped", proposals: [] };
    const key = this.key(ctx);
    const hit = this.cache.get(key);
    if (hit && Date.now() - hit.at < CACHE_TTL_MS) return { status: "ok", proposals: hit.proposals };
    if (mode === "cached") return { status: "skipped", proposals: [] };
    try {
      let p = this.inflight.get(key);
      if (!p) {
        p = this.generate(ctx).finally(() => this.inflight.delete(key));
        this.inflight.set(key, p);
      }
      const proposals = await p;
      this.cache.set(key, { at: Date.now(), proposals });
      if (this.cache.size > CACHE_MAX) this.cache.delete(this.cache.keys().next().value!);
      return { status: "ok", proposals };
    } catch (e) {
      this.log.warn(`AI rotation proposals unavailable: ${(e as Error).message}`);
      return { status: "unavailable", proposals: [] };
    }
  }

  private async generate(ctx: ProposalContext): Promise<Proposal[]> {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), PROPOSAL_TIMEOUT_MS);
    try {
      const request = (thinking: boolean) =>
        this.client!.models.generateContent({
          model: this.env.GEMINI_MODEL,
          contents: buildPrompt(ctx),
          config: {
            systemInstruction: SYSTEM,
            temperature: 0.4,
            responseMimeType: "application/json",
            responseSchema: schema(),
            ...(thinking ? { thinkingConfig: { thinkingLevel: ThinkingLevel.LOW } } : {}),
            abortSignal: ac.signal,
          },
        });
      let resp;
      try {
        resp = await request(this.thinking);
      } catch (e) {
        // A model that rejects the thinking level is retried without it, for good (same as the assistant).
        if (!this.thinking || !/think/i.test((e as Error).message)) throw e;
        this.log.warn(`${this.env.GEMINI_MODEL} rejected thinkingConfig; continuing without it`);
        this.thinking = false;
        resp = await request(false);
      }
      const usage = resp.usageMetadata;
      let raw: unknown;
      try {
        raw = JSON.parse(resp.text ?? "");
      } catch {
        throw new Error("response is not valid JSON");
      }
      const { valid, dropped } = validateProposals(raw, ctx, this.safety);
      for (const d of dropped) this.log.warn(`AI proposal dropped (${d.name}): ${d.reason}`);
      this.log.log(
        `AI rotations ${ctx.regionId}: ${valid.length} kept, ${dropped.length} dropped; tokens in ${usage?.promptTokenCount ?? "?"} out ${usage?.candidatesTokenCount ?? "?"} thoughts ${usage?.thoughtsTokenCount ?? 0}`,
      );
      return valid;
    } finally {
      clearTimeout(timer);
    }
  }
}
