import { Inject, Injectable, Logger } from "@nestjs/common";
import { EventKeys } from "@terrasight/shared";
import type { SafetyFilter } from "@terrasight/assistant-core";
import { aiEnabled, GeminiJson, loadSafety } from "../ai/gemini-json.js";
import { ENV, type Env } from "../config/config.js";
import { PrismaService } from "../db/prisma.service.js";
import { eventRow } from "../messaging/outbox.js";
import { OutboxService } from "../messaging/outbox.service.js";
import { aiMeta, type AiMeta } from "../ai/trace.js";
import { hashOf, SUMMARY_PROMPT_VERSION, SUMMARY_SYSTEM, summarySchema, validateSummary, type Text2 } from "./ai-text.js";

const CACHE_TTL_MS = 24 * 3600_000;
const RETRY_AFTER_FAILURE_MS = 10 * 60_000;
const CACHE_MAX = 200;

interface Entry {
  at: number;
  text: Text2 | null;
  /** Model, prompt version and safety-list version that produced (or failed to produce) the text. */
  meta: AiMeta;
}

/**
 * The one-sentence day summary of the brief header (PD v2.11). Never on the request path: the brief returns the
 * template sentence at once; when the AI sentence for these facts is missing, it is generated in the background (one
 * call per workspace and facts hash), number-checked, cached, and the brief is told to refresh.
 */
@Injectable()
export class AiDaySummaryService {
  private readonly log = new Logger(AiDaySummaryService.name);
  private readonly safety: SafetyFilter;
  readonly gemini: GeminiJson;
  private readonly cache = new Map<string, Entry>();
  private readonly inflight = new Set<string>();
  readonly stats = { calls: 0, ok: 0, rejected: 0, failed: 0, tokensIn: 0, tokensOut: 0 };

  constructor(
    @Inject(ENV) private readonly env: Env,
    private readonly prisma: PrismaService,
    private readonly outbox: OutboxService,
  ) {
    this.gemini = new GeminiJson(env, this.log);
    this.safety = loadSafety(env, this.log);
  }

  enabled(): boolean {
    return aiEnabled(this.env.AI_RECOMMENDATIONS, !!this.gemini.client);
  }

  /**
   * The AI sentence for these facts if there is one; otherwise null (and generation starts in the background).
   * `names` maps the refs used in the facts ("F3") to field names for display.
   */
  lookup(workspaceId: string, facts: unknown, names: Map<string, string>): Text2 | null {
    if (!this.enabled()) return null;
    const meta = aiMeta(this.env, SUMMARY_PROMPT_VERSION);
    // The prompt and safety-list versions are part of the key: editing either regenerates the sentence.
    const key = `${workspaceId}:${hashOf({ facts, ...meta })}`;
    const hit = this.cache.get(key);
    const age = hit ? Date.now() - hit.at : Infinity;
    if (hit?.text && age < CACHE_TTL_MS) return hit.text;
    if (hit && !hit.text && age < RETRY_AFTER_FAILURE_MS) return null;
    if (!this.inflight.has(key)) {
      this.inflight.add(key);
      void this.generate(workspaceId, key, facts, names).finally(() => this.inflight.delete(key));
    }
    return null;
  }

  /** Metadata of the cached sentence for these facts (traceability), or null. */
  metaFor(workspaceId: string, facts: unknown): AiMeta | null {
    const meta = aiMeta(this.env, SUMMARY_PROMPT_VERSION);
    return this.cache.get(`${workspaceId}:${hashOf({ facts, ...meta })}`)?.meta ?? null;
  }

  /** Exposed for tests: runs the generation and resolves when it is cached. */
  async generate(workspaceId: string, key: string, facts: unknown, names: Map<string, string>): Promise<void> {
    let text: Text2 | null = null;
    try {
      this.stats.calls += 1;
      const call = await this.gemini.call(SUMMARY_SYSTEM, JSON.stringify(facts), summarySchema);
      this.stats.tokensIn += call.tokens.in ?? 0;
      this.stats.tokensOut += call.tokens.out ?? 0;
      const v = validateSummary(call.json, facts, this.safety, names);
      if ("text" in v) {
        text = v.text;
        this.stats.ok += 1;
      } else {
        this.stats.rejected += 1;
        this.log.warn(`AI day summary rejected: ${v.problem}`);
      }
    } catch (e) {
      this.stats.failed += 1;
      this.log.warn(`AI day summary unavailable: ${(e as Error).message}`);
    }
    this.cache.set(key, { at: Date.now(), text, meta: aiMeta(this.env, SUMMARY_PROMPT_VERSION) });
    if (this.cache.size > CACHE_MAX) this.cache.delete(this.cache.keys().next().value!);
    if (text)
      await this.outbox
        .add(this.prisma.system, [eventRow(EventKeys.brief(workspaceId), "brief.changed", workspaceId, {})])
        .catch((e: Error) => this.log.warn(`brief refresh event failed: ${e.message}`));
  }
}
