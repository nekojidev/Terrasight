#!/usr/bin/env node
// Reports App message keys (apps/web/src/messages/app.{en,uk}.json) that no source file uses, and keys used in code
// that no file defines. Non-blocking: always exits 0 unless --strict is passed.
//   node tools/i18n-unused.mjs           report
//   node tools/i18n-unused.mjs --strict  exit 1 when anything is reported
//   node tools/i18n-unused.mjs --json    machine-readable output
//
// "Used" means the key appears as a string literal anywhere under apps/web/src (outside the message files), or it
// matches a dynamic pattern such as t(`kn_${id}`) or "rpAnswer_" + x (every key with that prefix counts as used).
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const web = join(root, "apps/web/src");
const strict = process.argv.includes("--strict");
const json = process.argv.includes("--json");
const NS = "App";

const messages = (lang) => JSON.parse(readFileSync(join(web, `messages/app.${lang}.json`), "utf8"))[NS] ?? {};
const en = messages("en");
const uk = messages("uk");

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) {
      if (name !== "messages" && name !== "node_modules") walk(p, out);
    } else if (/\.(tsx?|mjs)$/.test(name) && !/\.test\./.test(name)) out.push(p);
  }
  return out;
}
const files = walk(web);
const sources = files.map((f) => ({ f, text: readFileSync(f, "utf8") }));
const all = sources.map((s) => s.text).join("\n");

// Literals: "key", 'key', `key` (no interpolation).
const literals = new Set();
for (const m of all.matchAll(/(["'`])([A-Za-z][\w.]*)\1/g)) literals.add(m[2]);

// Dynamic prefixes: `prefix_${...}` and "prefix_" + x.
const prefixes = new Set();
for (const m of all.matchAll(/`([A-Za-z][\w.]*)\$\{/g)) prefixes.add(m[1]);
for (const m of all.matchAll(/(["'])([A-Za-z][\w.]*)\1\s*\+/g)) prefixes.add(m[2]);

const used = (key) => literals.has(key) || [...prefixes].some((p) => key.startsWith(p));
const unused = Object.keys(en).filter((k) => !used(k));

// Missing: literal calls on a translator bound to the App namespace.
const missing = [];
for (const { f, text } of sources) {
  const vars = [...text.matchAll(/(?:const|let)\s+(\w+)\s*=\s*(?:await\s+)?(?:useTranslations|getTranslations)\(\s*["']App["']\s*\)/g)].map(
    (m) => m[1],
  );
  for (const v of vars) {
    const re = new RegExp(`\\b${v}(?:\\.has)?\\(\\s*(["'])([A-Za-z][\\w.]*)\\1`, "g");
    for (const m of text.matchAll(re)) {
      if (!(m[2] in en)) missing.push({ key: m[2], file: f.replace(`${root}/`, "") });
    }
  }
}
const onlyOne = [
  ...Object.keys(en).filter((k) => !(k in uk)).map((k) => ({ key: k, lacks: "uk" })),
  ...Object.keys(uk).filter((k) => !(k in en)).map((k) => ({ key: k, lacks: "en" })),
];

if (json) {
  console.log(JSON.stringify({ unused, missing, onlyOne }, null, 2));
} else {
  console.log(`i18n-unused: ${Object.keys(en).length} App keys, ${prefixes.size} dynamic prefixes`);
  console.log(`\nUnused (${unused.length}):${unused.length ? "\n  " + unused.join("\n  ") : " none"}`);
  console.log(
    `\nUsed but not defined (${missing.length}):${missing.length ? "\n  " + missing.map((m) => `${m.key}  (${m.file})`).join("\n  ") : " none"}`,
  );
  console.log(
    `\nIn only one language (${onlyOne.length}):${onlyOne.length ? "\n  " + onlyOne.map((m) => `${m.key} (missing in ${m.lacks})`).join("\n  ") : " none"}`,
  );
}
process.exit(strict && (unused.length || missing.length || onlyOne.length) ? 1 : 0);
