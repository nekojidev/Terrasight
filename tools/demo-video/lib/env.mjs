// Configuration from env vars or a seed JSON file. Nothing here is ever printed or logged.
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

export const ROOT = path.resolve(import.meta.dirname, "..", "..", "..");
export const OUT = path.join(ROOT, "tools/demo-video/out");
const DEFAULT_SEED =
  "/private/tmp/claude-501/-Users-oleksandr-Documents-Terrasight/92eaf903-7543-4919-a2e3-408d3f438e69/scratchpad/presentation.json";

export function loadConfig() {
  const e = process.env;
  const seedPath = e.DEMO_SEED_FILE || DEFAULT_SEED;
  const seed = fs.existsSync(seedPath) ? JSON.parse(fs.readFileSync(seedPath, "utf8")) : {};
  const c = seed.credentials || {};
  const cfg = {
    base: e.DEMO_BASE_URL || "http://localhost:3000",
    owner: {
      email: e.DEMO_OWNER_EMAIL || c.owner?.email,
      password: e.DEMO_OWNER_PASSWORD || c.owner?.password,
    },
    agronomist: {
      email: e.DEMO_AGRONOMIST_EMAIL || c.agronomist?.email,
      password: e.DEMO_AGRONOMIST_PASSWORD || c.agronomist?.password,
    },
    fieldId: e.DEMO_FIELD_ID || seed.fields?.["north-quarter"]?.id,
    fieldName: "North quarter",
  };
  for (const r of ["owner", "agronomist"])
    if (!cfg[r].email || !cfg[r].password)
      throw new Error(
        `Missing ${r} credentials (env DEMO_${r.toUpperCase()}_EMAIL/PASSWORD or DEMO_SEED_FILE)`,
      );
  if (!cfg.fieldId) throw new Error("Missing field id (DEMO_FIELD_ID or seed file fields.north-quarter.id)");
  return cfg;
}

// Reads only the named keys from the repo .env (this checkout, or the main checkout of a worktree). Never logged.
function readEnvKeys(names) {
  const out = {};
  for (const n of names) if (process.env[n]) out[n] = process.env[n];
  const cands = [path.join(ROOT, ".env")];
  try {
    const common = execFileSync("git", ["-C", ROOT, "rev-parse", "--git-common-dir"], {
      encoding: "utf8",
    }).trim();
    cands.push(path.resolve(ROOT, common, "..", ".env"));
  } catch {
    // not a git checkout: only the local .env is used
  }
  for (const f of cands) {
    if (!fs.existsSync(f)) continue;
    for (const line of fs.readFileSync(f, "utf8").split("\n")) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (!m || !names.includes(m[1])) continue;
      const v = m[2].replace(/^['"]|['"]$/g, "");
      if (v) out[m[1]] ||= v;
    }
  }
  return out;
}

export function elevenLabsEnv() {
  const e = readEnvKeys(["ELEVENLABS_API_KEY", "ELEVENLABS_VOICE_ID"]);
  return { key: e.ELEVENLABS_API_KEY, voice: e.ELEVENLABS_VOICE_ID };
}

/** Gemini TTS: the product's own Gemini key; voice and model can be overridden. */
export function geminiEnv() {
  const e = readEnvKeys(["GEMINI_API_KEY", "DEMO_GEMINI_VOICE", "DEMO_GEMINI_TTS_MODEL"]);
  return {
    key: e.GEMINI_API_KEY,
    voice: e.DEMO_GEMINI_VOICE || "Charon",
    model: e.DEMO_GEMINI_TTS_MODEL || "gemini-3.8-flash-tts",
  };
}
