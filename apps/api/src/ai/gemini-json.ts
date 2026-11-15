import { readFileSync } from "node:fs";
import { join } from "node:path";
import { GoogleGenAI, ThinkingLevel } from "@google/genai";
import { createSafetyFilter, parseActives, type SafetyFilter } from "@terrasight/assistant-core";
import type { Logger } from "@nestjs/common";
import type { Env } from "../config/config.js";

export const AI_TIMEOUT_MS = 15_000;

export interface JsonCall {
  json: unknown;
  tokens: { in: number | null; out: number | null; thoughts: number };
}

/**
 * One structured-output Gemini call with a timeout and the shared thinkingConfig fallback (a model that rejects the
 * thinking level is retried without it, for good). `client` is replaceable in tests; null without an API key.
 */
export class GeminiJson {
  client: Pick<GoogleGenAI, "models"> | null;
  private thinking = true;

  constructor(
    private readonly env: Env,
    private readonly log: Logger,
  ) {
    this.client = env.GEMINI_API_KEY ? new GoogleGenAI({ apiKey: env.GEMINI_API_KEY }) : null;
  }

  async call(system: string, prompt: string, schema: unknown, timeoutMs = AI_TIMEOUT_MS): Promise<JsonCall> {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), timeoutMs);
    try {
      const request = (thinking: boolean) =>
        this.client!.models.generateContent({
          model: this.env.GEMINI_MODEL,
          contents: prompt,
          config: {
            systemInstruction: system,
            temperature: 0.3,
            responseMimeType: "application/json",
            responseSchema: schema as never,
            ...(thinking ? { thinkingConfig: { thinkingLevel: ThinkingLevel.LOW } } : {}),
            abortSignal: ac.signal,
          },
        });
      let resp;
      try {
        resp = await request(this.thinking);
      } catch (e) {
        if (!this.thinking || !/think/i.test((e as Error).message)) throw e;
        this.log.warn(`${this.env.GEMINI_MODEL} rejected thinkingConfig; continuing without it`);
        this.thinking = false;
        resp = await request(false);
      }
      let json: unknown;
      try {
        json = JSON.parse(resp.text ?? "");
      } catch {
        throw new Error("response is not valid JSON");
      }
      const u = resp.usageMetadata;
      return {
        json,
        tokens: {
          in: u?.promptTokenCount ?? null,
          out: u?.candidatesTokenCount ?? null,
          thoughts: u?.thoughtsTokenCount ?? 0,
        },
      };
    } finally {
      clearTimeout(timer);
    }
  }
}

/** The safety filter with the active-ingredient list (dose patterns only when the list is missing). */
export function loadSafety(env: Env, log: Logger): SafetyFilter {
  let actives: string[] = [];
  try {
    actives = parseActives(readFileSync(join(env.DATA_DIR, "safety", "actives.txt"), "utf8"));
  } catch {
    log.warn("data/safety/actives.txt missing: only dose patterns are filtered");
  }
  return createSafetyFilter(actives);
}

/** On when the flag is "1", or by default when a Gemini key is set ("0" turns it off). */
export function aiEnabled(flag: "0" | "1" | undefined, hasClient: boolean): boolean {
  return flag ? flag === "1" && hasClient : hasClient;
}
