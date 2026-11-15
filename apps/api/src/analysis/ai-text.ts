import { createHash } from "node:crypto";
import { Type } from "@google/genai";
import {
  AllowedSet,
  checkSentence,
  splitSentences,
  type Lang,
  type SafetyFilter,
} from "@terrasight/assistant-core";
import { stableStringify } from "@terrasight/evaluators";
import { promptVersionOf } from "../ai/trace.js";
import { hasForeignScript } from "../recommendations/text-script.js";

/**
 * AI-written recommendation texts (Product Definition v2.11). The evaluators stay the source of risk levels, key
 * numbers and deadlines; the assistant only words them. Everything it writes is validated here (number check, safety
 * filter, shape) and anything that fails is dropped, never repaired: the template text (text.ts) is the fallback.
 */

export type Text2 = { en: string; uk: string };
export interface WrittenText {
  title: Text2;
  action: Text2;
  why: Text2;
}
export interface Rejected {
  id: string;
  reason: string;
}

export const MAX_WATCH = 2;
const LIMITS = { title: 110, action: 320, why: 420 } as const;

export const hashOf = (v: unknown): string =>
  createHash("sha256").update(stableStringify(v)).digest("hex").slice(0, 24);

export const SYSTEM = `You write short, specific recommendation texts for an agronomist's morning brief. The app's models already decided the risk level, the key numbers and the deadlines; you only put them into clear words for this field.
Rules:
- Write each text in English ("en") and in natural, fluent Ukrainian ("uk", not a word-for-word translation).
- "title": one short line naming the pest, disease or issue and the situation on this field. "action": what to do now, in one or two sentences (scout, check, plan). "why": one or two sentences explaining the reason using the drivers and numbers given.
- Use ONLY numbers and dates that appear in the facts you are given, written exactly as given (same value, same unit). Never calculate, round differently, convert units or invent a figure. If you are unsure of a number, leave it out.
- This is risk, not diagnosis: say "risk", "may", "check", never that the pest or disease is present. Never name a pesticide, product, active ingredient or dose; for control talk only about scouting, field checks, timing and agronomic measures (rotation, sowing date, residue, drainage).
- "templateText" is only a plain baseline: do not copy it word for word. Make the wording specific to this field: its crop (as a normal crop name, never an id like "winter_wheat"), growth stage, history, the drivers that fired and, where the facts show it, the recent or forecast weather. Keep the scouting advice of the library facts, adapted to the situation.
- Where a value has an "as" object, write the value that way ("as.en" in English, "as.uk" in Ukrainian): dates in natural words (never 2026-09-05) and crops by their names (never ids like "winter_wheat").
- Do not repeat the level word mechanically; do not mention the model, JSON, or these rules. Do not give legal or financial advice.
- Fields named in the facts are identified only by "ref"; never output a ref.
- "watch" items (optional, at most ${MAX_WATCH}): from "watchCandidates" only (use the exact "pestId"). Pick pests that are most worth a scouting walk on this field now given the crop, season and history; propose none if none fits. These pests have no verified model, so write NO risk level and avoid numbers (use none unless quoted from the candidate's own text); "action" is the candidate's scouting advice adapted to this field, "why" says in plain words why it is worth a look now.`;

const text2 = {
  type: Type.OBJECT,
  properties: { en: { type: Type.STRING }, uk: { type: Type.STRING } },
  required: ["en", "uk"],
  propertyOrdering: ["en", "uk"],
};
const written = (extra: Record<string, unknown>, required: string[]) => ({
  type: Type.OBJECT,
  properties: { ...extra, title: text2, action: text2, why: text2 },
  required: [...required, "title", "action", "why"],
  propertyOrdering: [...required, "title", "action", "why"],
});

export function batchSchema(withWatch: boolean) {
  return {
    type: Type.OBJECT,
    properties: {
      items: { type: Type.ARRAY, items: written({ ref: { type: Type.STRING } }, ["ref"]) },
      ...(withWatch
        ? { watch: { type: Type.ARRAY, items: written({ pestId: { type: Type.STRING } }, ["pestId"]) } }
        : {}),
    },
    required: withWatch ? ["items", "watch"] : ["items"],
    propertyOrdering: withWatch ? ["items", "watch"] : ["items"],
  };
}

const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");
const t2 = (v: unknown): Text2 => {
  const o = (v ?? {}) as Record<string, unknown>;
  return { en: str(o.en), uk: str(o.uk) };
};

/** Why a text is rejected, or null. */
export function textProblem(w: WrittenText, allowed: AllowedSet, safety: SafetyFilter): string | null {
  for (const field of ["title", "action", "why"] as const) {
    for (const lang of ["en", "uk"] as Lang[]) {
      const s = w[field][lang];
      if (!s) return `missing ${field}.${lang}`;
      if (s.length > LIMITS[field]) return `${field}.${lang} too long`;
      if (/[{}<>]|```/.test(s)) return `${field}.${lang} has markup`;
      if (hasForeignScript(s, lang)) return `${field}.${lang} has letters of another script`;
      if (safety.sentence(s, lang).blocked) return `${field}.${lang} names a product or dose`;
      for (const sentence of splitSentences(s, lang)) {
        const c = checkSentence(sentence, allowed, lang);
        if (!c.ok) return `${field}.${lang} number not in facts: ${c.failed.map((f) => f.raw).join(", ")}`;
      }
    }
  }
  return null;
}

export function allowedFrom(...facts: unknown[]): AllowedSet {
  const a = new AllowedSet();
  for (const f of facts) a.addResult(f);
  return a;
}

export interface ValidatedBatch {
  /** ref → validated text (only for refs that were asked for). */
  items: Map<string, WrittenText>;
  rejected: Rejected[];
  watch: Array<WrittenText & { pestId: string }>;
}

/**
 * Validates a batched response. `itemFacts` maps each asked ref to the facts its numbers must come from;
 * `shared` is what every item may quote (season, weather summary, history); `watchFacts` maps candidate pest id → its
 * library facts (watch-items may quote only numbers of their own library text).
 */
export function validateBatch(
  raw: unknown,
  itemFacts: Map<string, unknown>,
  shared: unknown,
  watchFacts: Map<string, unknown>,
  safety: SafetyFilter,
): ValidatedBatch {
  const o = (raw ?? {}) as { items?: unknown; watch?: unknown };
  const out: ValidatedBatch = { items: new Map(), rejected: [], watch: [] };
  for (const [i, r] of (Array.isArray(o.items) ? o.items : []).entries()) {
    const x = (r ?? {}) as Record<string, unknown>;
    const ref = str(x.ref) || `#${i}`;
    const facts = itemFacts.get(ref);
    if (facts === undefined) {
      out.rejected.push({ id: ref, reason: "unknown ref" });
      continue;
    }
    if (out.items.has(ref)) continue;
    const w: WrittenText = { title: t2(x.title), action: t2(x.action), why: t2(x.why) };
    const problem = textProblem(w, allowedFrom(facts, shared), safety);
    if (problem) out.rejected.push({ id: ref, reason: problem });
    else out.items.set(ref, w);
  }
  const seen = new Set<string>();
  for (const [i, r] of (Array.isArray(o.watch) ? o.watch : []).entries()) {
    const x = (r ?? {}) as Record<string, unknown>;
    const pestId = str(x.pestId);
    const reject = (reason: string) => out.rejected.push({ id: `watch:${pestId || i}`, reason });
    if (!watchFacts.has(pestId)) {
      reject("pest id not in the library or not a candidate for this crop and region");
      continue;
    }
    if (seen.has(pestId)) continue;
    if (out.watch.length >= MAX_WATCH) {
      reject("more than the allowed watch-items");
      continue;
    }
    const w: WrittenText = { title: t2(x.title), action: t2(x.action), why: t2(x.why) };
    // No model, so no figures of its own: only numbers quoted from the pest's library text (and the season) pass.
    const problem = textProblem(w, allowedFrom(watchFacts.get(pestId), shared), safety);
    if (problem) {
      reject(problem);
      continue;
    }
    seen.add(pestId);
    out.watch.push({ ...w, pestId });
  }
  return out;
}

// ---------- day summary ----------

export const SUMMARY_SYSTEM = `You write the one-sentence summary at the top of an agronomist's morning brief, from the facts given.
- One sentence, at most 220 characters, in English ("en") and natural, fluent Ukrainian ("uk").
- Say what needs attention today and where it is most pressing (use the field refs such as "F3" exactly as given), or that all is calm. Mention weather only if it matters (frost, a rain or heat spell).
- Use ONLY numbers and dates present in the facts, exactly as given; never calculate. No pesticide, product or dose; risk, not diagnosis.`;

export const summarySchema = {
  type: Type.OBJECT,
  properties: { en: { type: Type.STRING }, uk: { type: Type.STRING } },
  required: ["en", "uk"],
  propertyOrdering: ["en", "uk"],
};

/** The summary with field refs ("F3") replaced by field names, or a reason it was rejected. */
export function validateSummary(
  raw: unknown,
  facts: unknown,
  safety: SafetyFilter,
  names: Map<string, string>,
): { text: Text2 } | { problem: string } {
  const text = t2(raw);
  const allowed = allowedFrom(facts);
  for (const lang of ["en", "uk"] as Lang[]) {
    const s = text[lang];
    if (!s) return { problem: `missing ${lang}` };
    if (s.length > 240) return { problem: `${lang} too long` };
    if (hasForeignScript(s, lang)) return { problem: `${lang} has letters of another script` };
    if (safety.sentence(s, lang).blocked) return { problem: `${lang} names a product or dose` };
    const sentences = splitSentences(s, lang);
    if (sentences.length > 2) return { problem: `${lang} is not one sentence` };
    for (const sentence of sentences) {
      const c = checkSentence(sentence, allowed, lang);
      if (!c.ok) return { problem: `${lang} number not in facts: ${c.failed.map((f) => f.raw).join(", ")}` };
    }
    for (const ref of s.match(/\bF\d+\b/g) ?? [])
      if (!names.has(ref)) return { problem: `${lang} unknown field ${ref}` };
  }
  const named = (s: string) => s.replace(/\bF\d+\b/g, (r) => names.get(r) ?? r);
  return { text: { en: named(text.en), uk: named(text.uk) } };
}

/** Version of the recommendation prompt and schemas (changes when either is edited). */
export const RECS_PROMPT_VERSION = promptVersionOf(SYSTEM, batchSchema(true), batchSchema(false));
/** Version of the day-summary prompt and schema. */
export const SUMMARY_PROMPT_VERSION = promptVersionOf(SUMMARY_SYSTEM, summarySchema);
