#!/usr/bin/env node
// Builds next-intl messages from the design handoff (design/i18n/*.json → apps/web/messages/{uk,en}.json).
//   node tools/i18n-build.mjs           write the message files
//   node tools/i18n-build.mjs --check   fail if a key is missing in one language or the files are stale
// Namespace = screen name without its number: "04-Main.json" → "Main". Values may be strings or nested objects.
import { readdirSync, readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const src = join(root, "design/i18n");
const out = join(root, "apps/web/messages");
const LANGS = ["uk", "en"];
const check = process.argv.includes("--check");

function keys(obj, prefix = "") {
  return Object.entries(obj).flatMap(([k, v]) =>
    v && typeof v === "object" ? keys(v, `${prefix}${k}.`) : [`${prefix}${k}`],
  );
}

const messages = Object.fromEntries(LANGS.map((l) => [l, {}]));
const problems = [];

for (const file of readdirSync(src)
  .filter((f) => f.endsWith(".json"))
  .sort()) {
  const ns = file.replace(/^\d+-/, "").replace(/\.json$/, "");
  const data = JSON.parse(readFileSync(join(src, file), "utf8"));
  for (const lang of LANGS) {
    if (!data[lang]) problems.push(`${file}: no "${lang}" section`);
  }
  const [a, b] = LANGS.map((l) => new Set(keys(data[l] ?? {})));
  for (const k of a) if (!b.has(k)) problems.push(`${file}: "${k}" missing in ${LANGS[1]}`);
  for (const k of b) if (!a.has(k)) problems.push(`${file}: "${k}" missing in ${LANGS[0]}`);
  for (const lang of LANGS) messages[lang][ns] = data[lang] ?? {};
}

if (problems.length) {
  console.error(`i18n: ${problems.length} problem(s):\n  - ${problems.join("\n  - ")}`);
  process.exit(1);
}

mkdirSync(out, { recursive: true });
let stale = false;
for (const lang of LANGS) {
  const path = join(out, `${lang}.json`);
  const text = JSON.stringify(messages[lang], null, 2) + "\n";
  if (check) {
    if (!existsSync(path) || readFileSync(path, "utf8") !== text) {
      console.error(`i18n: ${path} is stale; run pnpm i18n:build`);
      stale = true;
    }
  } else {
    writeFileSync(path, text);
  }
}
if (stale) process.exit(1);
const count = keys(messages.en).length;
console.log(
  `i18n: ${count} keys per language, ${Object.keys(messages.en).length} namespaces${check ? " — up to date" : " — written"}`,
);
