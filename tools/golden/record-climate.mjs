#!/usr/bin/env node
// Records the EP-10 golden questions (climate shift, year-set ranking) without a running API (S-10.16).
//
//   node --env-file=.env tools/golden/record-climate.mjs [--only en-34,uk-36]
//
// Asks Gemini with the assistant's real system prompt and tool declarations (packages/assistant-core/dist) and answers
// each tool call from a FIXED tool result: get_climate_shift = the Garden City, KS field numbers (season temperature
// 21.51 -> 22.22 degC, GDD 2133 -> 2247, first autumn frost 8 days later, season rainfall 375 -> 363 mm, longest dry spell
// 17.6 -> 18.0 days), built by the real result mapper (apps/api/dist/assistant/climate-tools.js, run `pnpm build` first);
// get_year_set_ranking = "not available" (no provider is bound yet). The answer then goes through the same number check,
// safety filter and horizon fix as AssistantService.turn, and the entry replaces the one with the same id in
// recordings/<lang>.json. Costs a few Gemini calls: run it once per change of these questions.
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "../..");
const core = await import(join(root, "packages/assistant-core/dist/index.js"));
const { climateShiftResult } = await import(join(root, "apps/api/dist/assistant/climate-tools.js"));
const req = createRequire(join(root, "apps/api/package.json"));
const { GoogleGenAI, ThinkingLevel } = req("@google/genai");
const YAML = req("yaml");

const only = process.argv.includes("--only") ? process.argv[process.argv.indexOf("--only") + 1].split(",") : null;
if (!process.env.GEMINI_API_KEY) throw new Error("GEMINI_API_KEY missing (use node --env-file=<path to .env>)");
const model = process.env.GEMINI_MODEL;
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

const metric = (id, unit, baseline, recent, delta, significant) => ({
  id,
  unit,
  baseline,
  recent,
  delta,
  trend: { slopePerDecade: null, pValue: null, significant, years: 45 },
});
const GARDEN_CITY = {
  status: "ready",
  periods: { baseline: { from: 1981, to: 2000 }, recent: { from: 2006, to: 2025 } },
  hemisphere: "north",
  season: { from: "04-15", to: "10-15" },
  crop: null,
  flowering: { from: "06-01", to: "08-31", thresholdC: 35, verified: false, fallback: true, source: null },
  metrics: [
    metric("seasonTemp", "degC", 21.51, 22.22, 0.71, true),
    metric("gdd", "degDays", 2133, 2247, 114, true),
    metric("firstAutumnFrost", "dayOfYear", null, null, 8, true),
    metric("seasonPrecip", "mm", 375, 363, -12, false),
    metric("longestDrySpell", "days", 17.6, 18.0, 0.4, false),
  ],
  alpha: 0.05,
  skippedYears: [],
  source: {
    dataset: "NASA POWER",
    from: "1981-01-01",
    lastDate: "2026-11-12",
    cell: { lat: 37.97, lon: -100.87 },
    resolutionKm: 55,
  },
  gpm: null,
};

const results = (lang) => ({
  get_climate_shift: () => climateShiftResult("F1", GARDEN_CITY, lang),
  get_year_set_ranking: () => ({
    field: "F1",
    status: "not_available",
    note: "The comparison across weather years is not available for this field yet; say so and do not estimate it.",
  }),
});

const actives = (() => {
  try {
    return core.parseActives(readFileSync(join(root, "data/safety/actives.txt"), "utf8"));
  } catch {
    return [];
  }
})();
const safety = core.createSafetyFilter(actives);

async function generate(contents, lang, withTools, thinking) {
  return ai.models.generateContent({
    model,
    contents,
    config: {
      systemInstruction: core.systemPrompt(lang, "2026-11-15"),
      temperature: 0.2,
      ...(thinking ? { thinkingConfig: { thinkingLevel: ThinkingLevel.LOW } } : {}),
      ...(withTools ? { tools: [{ functionDeclarations: core.functionDeclarations() }] } : {}),
    },
  });
}

async function ask(q, lang) {
  const text = q.question.replace(/Pivot 12/g, "F1");
  const contents = [{ role: "user", parts: [{ text }] }];
  const runs = [];
  let answer = "";
  for (let step = 0; step < 6; step++) {
    let resp;
    try {
      resp = await generate(contents, lang, true, true);
    } catch (e) {
      if (!/think/i.test(e.message)) throw e;
      resp = await generate(contents, lang, true, false);
    }
    const calls = resp.functionCalls ?? [];
    if (!calls.length) {
      answer = resp.text ?? "";
      break;
    }
    contents.push(resp.candidates[0].content);
    const parts = [];
    for (const call of calls) {
      const fn = results(lang)[call.name];
      const result = fn ? fn() : { error: `no recorded result for ${call.name} in this question` };
      runs.push({ tool: call.name, args: call.args ?? {}, result });
      parts.push({ functionResponse: { name: call.name, ...(call.id ? { id: call.id } : {}), response: { result } } });
    }
    contents.push({ role: "user", parts });
  }
  // Same post-processing as AssistantService.turn.
  const allowed = new core.AllowedSet();
  for (const r of runs) allowed.addResult(r.result);
  allowed.addText("5 seasons 2026 2027 2028 2029 2030", "en");
  const shown = [];
  let numbers = 0;
  let failed = false;
  for (const raw of core.splitSentences(answer, lang)) {
    const check = core.checkSentence(raw, allowed, lang);
    if (!check.ok) {
      failed = true;
      break;
    }
    numbers += check.numbers;
    shown.push(core.fixHorizon(safety.sentence(raw.trim(), lang).text, lang).text);
  }
  const showing = lang === "uk" ? "Показуємо дані напряму." : "Showing the data directly.";
  const card = runs.filter((r) => !r.result.error).map((r) => ({ tool: r.tool, result: r.result }));
  return {
    id: q.id,
    category: q.category,
    question: text,
    expect: q.expect ?? {},
    answer: failed ? [...shown, showing].join(" ") : shown.join(" "),
    error: failed || shown.length ? null : "empty answer",
    checked: !failed && shown.length > 0,
    fallback: failed,
    numbersChecked: numbers,
    ...(failed ? { card } : {}),
    tools: runs,
    ms: 0,
  };
}

for (const lang of ["en", "uk"]) {
  const qs = YAML.parse(readFileSync(join(here, `${lang}.yaml`), "utf8")).questions.filter(
    (q) => q.category === "climate_shift" && (!only || only.includes(q.id)),
  );
  const file = join(here, "recordings", `${lang}.json`);
  const rec = JSON.parse(readFileSync(file, "utf8"));
  for (const q of qs) {
    const row = await ask(q, lang);
    console.log(`${row.id} ${row.fallback ? "fallback" : row.error ? "ERROR" : "ok"} tools=[${row.tools.map((t) => t.tool)}]`);
    console.log(`   ${row.answer}`);
    const i = rec.answers.findIndex((a) => a.id === q.id);
    if (i >= 0) rec.answers[i] = row;
    else rec.answers.push(row);
  }
  rec.recordedAt = new Date().toISOString();
  writeFileSync(file, JSON.stringify(rec, null, 2) + "\n");
}
