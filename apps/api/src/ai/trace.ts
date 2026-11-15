import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Env } from "../config/config.js";

/**
 * AI traceability: every AI text or proposal is stored with the model, the prompt version and the version of the safety
 * list that filtered it. Both versions are content hashes, so editing a prompt, its schema or data/safety/actives.txt
 * changes them by itself; they are part of the facts hash, so old texts are regenerated.
 */
export interface AiMeta {
  model: string;
  promptVersion: string;
  safetyListVersion: string;
}

const sha = (text: string) => createHash("sha256").update(text).digest("hex").slice(0, 12);

/** Version of a prompt: hash of its system text and response schema(s). */
export const promptVersionOf = (...parts: unknown[]): string => sha(parts.map((p) => (typeof p === "string" ? p : JSON.stringify(p))).join("\u0000"));

/** Version of the safety list: hash of data/safety/actives.txt ("missing" when the file cannot be read). */
export function safetyListVersion(env: Pick<Env, "DATA_DIR">): string {
  try {
    return sha(readFileSync(join(env.DATA_DIR, "safety", "actives.txt"), "utf8"));
  } catch {
    return "missing";
  }
}

export const aiMeta = (env: Pick<Env, "DATA_DIR" | "GEMINI_MODEL">, promptVersion: string): AiMeta => ({
  model: env.GEMINI_MODEL,
  promptVersion,
  safetyListVersion: safetyListVersion(env),
});
