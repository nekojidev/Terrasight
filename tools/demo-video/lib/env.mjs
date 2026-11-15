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

// Reads only ELEVENLABS_* keys from the repo .env (this checkout, or the main checkout of the worktree).
export function elevenLabsEnv() {
  const out = { key: process.env.ELEVENLABS_API_KEY, voice: process.env.ELEVENLABS_VOICE_ID };
  if (out.key) return out;
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
      const m = line.match(/^\s*(ELEVENLABS_API_KEY|ELEVENLABS_VOICE_ID)\s*=\s*(.*)\s*$/);
      if (!m) continue;
      const v = m[2].replace(/^['"]|['"]$/g, "");
      if (!v) continue;
      if (m[1] === "ELEVENLABS_API_KEY") out.key ||= v;
      else out.voice ||= v;
    }
  }
  return out;
}
