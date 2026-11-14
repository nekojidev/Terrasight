#!/usr/bin/env node
// Golden questions for the assistant (S-05.07, RFC §12.7, Tech Design §12.5).
//
//   node tools/golden/run.mjs              replay recordings (CI): every shown sentence must pass the number check and
//                                          the safety filter against the recorded tool results; prints the report
//   node tools/golden/run.mjs --live       ask a running API (GOLDEN_API; GOLDEN_EMAIL + GOLDEN_PASSWORD or GOLDEN_COOKIE_JAR),
//                                          record answers + tool results to tools/golden/recordings/<lang>.json
//   options: --lang en|uk  --limit N  --min 0.9 (share of answers shown without fallback; default 0.9)
//
// Recordings hold the demo company's derived data only (aliases F<n>, tool results); no customer data (RFC §12.7).
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "../..");
const require = createRequire(join(root, "packages/assistant-core/package.json"));
const YAML = await import(require.resolve("yaml", { paths: [root] })).catch(() => import("yaml"));
const core = await import(join(root, "packages/assistant-core/dist/index.js"));

const args = process.argv.slice(2);
const opt = (name, def) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? (args[i + 1] ?? true) : def;
};
const live = args.includes("--live");
const langs = opt("lang", null) ? [opt("lang")] : ["en", "uk"];
const limit = Number(opt("limit", 999));
const minShown = Number(opt("min", 0.9));

const load = (lang) => YAML.parse(readFileSync(join(here, `${lang}.yaml`), "utf8")).questions.slice(0, limit);
const recPath = (lang) => join(here, "recordings", `${lang}.json`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- live ----------
// One session for the whole run: a refresh token is single-use, so the jar is shared across languages.
const jar = new Map();
let signedIn = false;

async function runLive(lang) {
  const base = process.env.GOLDEN_API ?? "http://localhost:4000";
  const call = async (path, init = {}) => {
    const headers = {
      "X-Requested-With": "golden",
      ...(init.body ? { "Content-Type": "application/json" } : {}),
      cookie: [...jar].map(([k, v]) => `${k}=${v}`).join("; "),
    };
    const res = await fetch(base + path, {
      ...init,
      headers,
      body: init.body ? JSON.stringify(init.body) : undefined,
    });
    for (const c of res.headers.getSetCookie?.() ?? []) {
      const [kv] = c.split(";");
      const [k, ...v] = kv.split("=");
      jar.set(k, v.join("="));
    }
    if (!res.ok && res.status !== 202)
      throw new Error(`${init.method ?? "GET"} ${path} → ${res.status} ${await res.text()}`);
    return res.status === 204 ? null : res.json();
  };
  if (signedIn) {
    // already signed in for the previous language
  } else if (process.env.GOLDEN_COOKIE_JAR) {
    // A curl / Netscape cookie jar from a signed-in session; the refresh cookie gets a fresh access token.
    for (const line of readFileSync(process.env.GOLDEN_COOKIE_JAR, "utf8").split("\n")) {
      const parts = line.replace(/^#HttpOnly_/, "").split("\t");
      if (parts.length === 7 && !line.startsWith("# ")) jar.set(parts[5], parts[6].trim());
    }
    await call("/api/auth/refresh", { method: "POST" });
  } else if (process.env.GOLDEN_EMAIL && process.env.GOLDEN_PASSWORD) {
    await call("/api/auth/login", {
      method: "POST",
      body: { email: process.env.GOLDEN_EMAIL, password: process.env.GOLDEN_PASSWORD },
    });
  } else
    throw new Error("set GOLDEN_EMAIL and GOLDEN_PASSWORD, or GOLDEN_COOKIE_JAR (a demo-company session)");
  const me = await call("/api/me");
  const ws = process.env.GOLDEN_WORKSPACE ?? me.workspaces[0].id;
  const out = [];
  for (const q of load(lang)) {
    await call("/api/auth/refresh", { method: "POST" });
    const conv = await call(`/api/w/${ws}/conversations`, {
      method: "POST",
      body: { title: `golden ${q.id}` },
    });
    const t0 = Date.now();
    await call(`/api/w/${ws}/conversations/${conv.id}/messages`, {
      method: "POST",
      body: { text: q.question, lang },
    });
    let msg;
    let c;
    for (let i = 0; i < 90; i++) {
      await sleep(1000);
      c = await call(`/api/w/${ws}/conversations/${conv.id}?include=tools`);
      msg = c.messages.at(-1);
      if (msg.role === "assistant" && (msg.text || msg.error)) break;
    }
    const nameToAlias = Object.entries(c.aliases).map(([alias, f]) => [f.name, alias]);
    const scrub = (s) => nameToAlias.reduce((acc, [name, alias]) => acc.split(name).join(alias), s);
    out.push({
      id: q.id,
      category: q.category,
      question: scrub(q.question),
      expect: q.expect ?? {},
      answer: msg.text,
      error: msg.error,
      checked: msg.checked,
      fallback: msg.fallback,
      numbersChecked: msg.numbersChecked,
      tools: msg.tools.map((t) => ({ tool: t.tool, args: t.args, result: t.result })),
      ms: Date.now() - t0,
    });
    process.stdout.write(
      `${q.id} ${msg.error ? "ERROR" : msg.fallback ? "fallback" : "ok"} (${Math.round((Date.now() - t0) / 1000)} s)\n`,
    );
    await call(`/api/w/${ws}/conversations/${conv.id}`, { method: "DELETE" });
    await sleep(6500); // stay under the per-user rate limit
  }
  mkdirSync(dirname(recPath(lang)), { recursive: true });
  writeFileSync(
    recPath(lang),
    JSON.stringify({ lang, recordedAt: new Date().toISOString(), answers: out }, null, 2) + "\n",
  );
  return out;
}

// ---------- evaluation (both modes) ----------
const TREATMENT = Object.values(core.TREATMENT_TEXT);
const REFUSAL_TEXTS = Object.values(core.REFUSALS).flatMap((r) => Object.values(r));
const TEN_YEARS = /\b(10|ten)[\s-]*(years?|seasons?)\b|(10|десять|десяти)\s*(рок|сезон)/i;

function evaluate(lang, answers) {
  const rows = answers.map((a) => {
    const problems = [];
    const allowed = new core.AllowedSet();
    for (const t of a.tools) allowed.addResult(t.result);
    allowed.addText(a.question, lang);
    const refused = REFUSAL_TEXTS.includes(a.answer);
    if (!a.error && !refused) {
      const shown = (a.answer ?? "").replace(/Showing the data directly\.|Показуємо дані напряму\./, "");
      for (const s of core.splitSentences(shown, lang)) {
        if (TREATMENT.includes(s.trim())) continue;
        const r = core.checkSentence(s, allowed, lang);
        if (!r.ok) problems.push(`number check: ${r.failed.map((f) => f.raw).join(", ")} in "${s.trim()}"`);
      }
    }
    if (a.expect.refusal && !refused) problems.push("expected a refusal");
    if (!a.expect.refusal && refused) problems.push("unexpected refusal");
    if (TEN_YEARS.test(a.answer ?? "")) problems.push("says 10 years");
    if (a.error) problems.push(`unavailable: ${a.error}`);
    return { ...a, refused, problems };
  });
  const shownWithoutFallback = rows.filter((r) => !r.fallback && !r.error).length / Math.max(1, rows.length);
  return {
    lang,
    total: rows.length,
    shownWithoutFallback,
    fallback: rows.filter((r) => r.fallback).length,
    errors: rows.filter((r) => r.error).length,
    refusalsOk: rows.filter((r) => r.expect.refusal && r.refused).length,
    refusalsExpected: rows.filter((r) => r.expect.refusal).length,
    horizonOk: rows.filter((r) => r.expect.horizon && !TEN_YEARS.test(r.answer ?? "")).length,
    horizonExpected: rows.filter((r) => r.expect.horizon).length,
    rows,
  };
}

let failed = false;
const report = [];
for (const lang of langs) {
  let answers;
  if (live) answers = await runLive(lang);
  else if (existsSync(recPath(lang))) answers = JSON.parse(readFileSync(recPath(lang), "utf8")).answers;
  else {
    console.log(`[${lang}] no recordings yet (run with --live against the demo company)`);
    continue;
  }
  const r = evaluate(lang, answers);
  report.push(r);
  console.log(
    `[${lang}] ${r.total} questions · shown without fallback ${(r.shownWithoutFallback * 100).toFixed(0)}% · fallback ${r.fallback} · unavailable ${r.errors} · refusals ${r.refusalsOk}/${r.refusalsExpected} · horizon ${r.horizonOk}/${r.horizonExpected}`,
  );
  for (const row of r.rows.filter((x) => x.problems.length))
    console.log(`  ${row.id}: ${row.problems.join("; ")}`);
  // Recordings must stay consistent with the current number check and filters; live runs must meet the demo bar.
  const hard = r.rows.some((x) =>
    x.problems.some(
      (p) => p.startsWith("number check") || p === "expected a refusal" || p === "says 10 years",
    ),
  );
  if (hard || r.shownWithoutFallback < minShown) failed = true;
}
writeFileSync(
  join(here, "report.json"),
  JSON.stringify(
    report.map(({ rows, ...rest }) => ({
      ...rest,
      problems: rows.filter((x) => x.problems.length).map((x) => ({ id: x.id, problems: x.problems })),
    })),
    null,
    2,
  ) + "\n",
);
process.exit(failed ? 1 : 0);
