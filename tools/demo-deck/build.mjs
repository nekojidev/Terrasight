// pnpm demo:deck  ->  demo/terrasight-deck.pdf (7 pages, 1920x1080) + tools/demo-deck/out/slide-N.png
// Flags: --no-capture (reuse out/shots and out/pages.json)
import fs from "node:fs";
import path from "node:path";
import { chromium } from "../demo-video/node_modules/playwright/index.mjs";
import { capture } from "./capture.mjs";

const HERE = import.meta.dirname;
const ROOT = path.resolve(HERE, "..", "..");
const OUT = path.join(HERE, "out");
const BASE = process.env.DEMO_BASE_URL || "http://localhost:3000";
const SEED =
  process.env.DEMO_SEED_FILE ||
  "/private/tmp/claude-501/-Users-oleksandr-Documents-Terrasight/92eaf903-7543-4919-a2e3-408d3f438e69/scratchpad/presentation.json";
fs.mkdirSync(OUT, { recursive: true });

// ---- team
const team = JSON.parse(fs.readFileSync(path.join(HERE, "team.json"), "utf8"));
const PLACEHOLDER = /TEAM NAME|Member One|Member Two|Member Three|PLACEHOLDER/i;
const bad = [team.teamName, team.localEvent, ...(team.members || [])].filter((v) => !v || PLACEHOLDER.test(v));
if (bad.length) {
  console.warn("\n" + "!".repeat(72));
  console.warn("WARNING: team.json still has placeholders: " + JSON.stringify(bad));
  console.warn("Fill tools/demo-deck/team.json before submitting.");
  console.warn("!".repeat(72) + "\n");
}

// ---- fonts: the app's own Onest / JetBrains Mono files (served by the running app)
async function buildFonts() {
  const html = await (await fetch(BASE + "/explore")).text();
  const cssUrls = [...new Set([...html.matchAll(/\/_next\/static\/[^"']+\.css/g)].map((m) => m[0]))];
  const dir = path.join(OUT, "fonts");
  fs.mkdirSync(dir, { recursive: true });
  let css = "";
  for (const u of cssUrls) {
    const text = await (await fetch(BASE + u)).text();
    for (const m of text.matchAll(/@font-face\s*\{[^}]*\}/g)) {
      let rule = m[0];
      const src = rule.match(/url\(([^)]+)\)/);
      if (!src) continue;
      const rel = src[1].replace(/['"]/g, "");
      const file = path.join(dir, path.basename(rel));
      if (!fs.existsSync(file))
        fs.writeFileSync(file, Buffer.from(await (await fetch(new URL(rel, BASE + u))).arrayBuffer()));
      rule = rule.replace(src[0], `url(fonts/${path.basename(rel)})`);
      css += rule + "\n";
    }
  }
  fs.writeFileSync(path.join(OUT, "fonts.css"), css);
  return css;
}

// ---- numbers copied from the pages (capture.mjs returns the page texts)
const must = (m, what) => {
  if (!m) throw new Error("number not found on the page: " + what);
  return m;
};
function numbersFrom(N) {
  const shift = N.pivot14Shift;
  const exp = N.explorePanel;
  const since = Number(must(N.exploreIntro.match(/since (\d{4})/), "since year")[1]);
  const rain = must(
    exp.match(/Growing-season rainfall\s*\nI\s*\n\s*1981–2000\s*\n([\d.,]+ in)\s*\n2006–2025\s*\n([\d.,]+ in)/),
    "rainfall",
  );
  const rec = N.rec;
  const stress = N.stress;
  const fitRows = [...N.fit.matchAll(/r = (-?[\d.]+), mean error [\d.]+ points, (\d+) years/g)];
  if (fitRows.length < 2) throw new Error("trust r values not found");
  const missed = [...N.missed.matchAll(/^(\d{4}) · /gm)].map((m) => m[1]);
  const brief = N.brief;
  const take = (re, what) => must(brief.match(re), what);
  const assistant = JSON.parse(
    fs.readFileSync(path.join(ROOT, "tools/demo-video/out/takes/assistant.json"), "utf8"),
  ).facts?.badge;
  if (!/150 weather paths and 10 price scenarios/.test(rec)) throw new Error("150/10 line not found");
  const out = {
    years: String(2026 - since),
    temp: must(shift.match(/(\+[\d.]+°F)\s*\nincrease\.\s*\nclear trend/), "temp")[1],
    frost: must(shift.match(/(\d+ days later)\s*\nincrease\.\s*\nclear trend/), "frost")[1],
    gdd: must(shift.match(/(\+[\d,]+ °F·d)\s*\nincrease\.\s*\nclear trend/), "gdd")[1],
    rain: `${rain[1]} → ${rain[2]}`,
    recGain: must(rec.match(/(\$[\d,]+) per ac a year more than today/), "recGain")[1],
    sensitivity: must(rec.match(/The same option is best in every set of weather years[^.]*\./), "sensitivity")[0],
    paths: must(rec.match(/(\d+) weather paths and (\d+) price scenarios/), "paths")[1],
    prices: must(rec.match(/(\d+) weather paths and (\d+) price scenarios/), "prices")[2],
    seasonRange: must(rec.match(/\((\d{4}–\d{4})\)/), "season range")[1],
    stressDiff: must(stress.match(/puts (\$[\d,]+) less at risk/), "stress diff")[1],
    r1: fitRows[0][1],
    n1: fitRows[0][2],
    r2: fitRows[1][1],
    n2: fitRows[1][2],
    missed: missed.join(", "),
    badge: assistant || "numbers checked against the models",
    briefLine: `Frost forecast for ${take(/(Nov \d+)\s*\nforecast frost date/, "frost date")[1]}. A Ukrainian field, in estimate mode: reliability is shown as ${take(/Reliability: (\w+)/, "reliability")[1]}. The agronomist accepts, or asks the owner.`,
  };
  if (!/no clear trend/.test(exp.slice(exp.indexOf("Growing-season rainfall:"), exp.indexOf("Growing-season rainfall:") + 120)))
    throw new Error("rainfall is no longer 'no clear trend' on the page: change slide 2");
  const blocks = [...N.missed.matchAll(/^(\d{4}) · [^\n]*\n+(model [^\n]*?) · (official yield [^\n]*)\n+[^\n]*does not include ([^.\n]+)\./gm)];
  if (blocks.length !== missed.length) throw new Error("could not read the missed-years rows");
  out.missedRowsHtml = blocks
    .map((m) => `<div class="mrow"><b>${m[1]}</b><span>${m[2]} · ${m[3].replace("official yield", "official")}</span><i>${m[4]} not modelled</i></div>`)
    .join("");
  out.planLead = `${out.sensitivity} Tested on 150 weather paths and 10 price scenarios.`;
  return out;
}

let N;
if (process.argv.includes("--no-capture")) N = JSON.parse(fs.readFileSync(path.join(OUT, "pages.json"), "utf8"));
else {
  const seed = JSON.parse(fs.readFileSync(SEED, "utf8"));
  N = await capture({ outDir: OUT, base: BASE, seedFields: seed.fields });
  fs.writeFileSync(path.join(OUT, "pages.json"), JSON.stringify(N, null, 1)); // page texts only, no credentials
}
const D = numbersFrom(N);

// cross-check against the seed summary where it has the same quantity (warn only)
try {
  const seed = JSON.parse(fs.readFileSync(SEED, "utf8"));
  const f = seed.numbers.fields["pivot-14"].climateShift.metrics.find((m) => m.id === "firstAutumnFrost");
  if (`${Math.round(f.delta)} days later` !== D.frost)
    console.warn("note: frost on the page differs from the seed summary", D.frost, f.delta);
  if (String(seed.numbers.farmStress.difference).replace(/\B(?=(\d{3})+$)/g, ",") !== D.stressDiff.slice(1))
    console.warn("note: stress-test difference differs from the seed summary", D.stressDiff, seed.numbers.farmStress.difference);
} catch {
  // seed not available: the page values are the source
}

Object.assign(D, {
  teamName: team.teamName,
  members: team.members.join(", "),
  memberLabel: team.members.length === 1 ? "Team member" : "Team members",
  localEvent: team.localEvent,
  tryLine: team.demoUrl ? `${team.demoUrl}/explore · ${team.repoUrl}` : `/explore · ${team.repoUrl || ""}`,
});
console.log("numbers used:", JSON.stringify({ ...D, sensitivity: undefined }, null, 1));

await buildFonts();
let html = fs.readFileSync(path.join(HERE, "deck.template.html"), "utf8");
html = html.replace(/\{\{(\w+)\}\}/g, (_, k) => {
  if (D[k] === undefined) throw new Error("template placeholder without value: " + k);
  return k.endsWith("Html") ? String(D[k]) : String(D[k]).replace(/&/g, "&amp;").replace(/</g, "&lt;");
});
const deck = path.join(OUT, "deck.html");
fs.writeFileSync(deck, html);

const browser = await chromium.launch({ args: ["--force-color-profile=srgb"] });
try {
  const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  await page.goto("file://" + deck);
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(500);
  const slides = await page.locator(".slide").count();
  if (slides !== 7) throw new Error("expected 7 slides, got " + slides);
  // overflow check: nothing may reach the footer line or the side margins
  const over = await page.evaluate(() => {
    const res = [];
    document.querySelectorAll(".slide").forEach((s, i) => {
      const foot = s.querySelector(".foot").getBoundingClientRect();
      const sr = s.getBoundingClientRect();
      s.querySelectorAll("*").forEach((el) => {
        if (el.closest(".foot") || el.tagName === "IMG") return;
        const r = el.getBoundingClientRect();
        if (r.width && (r.bottom > foot.top - 4 || r.right > sr.right - 100))
          res.push(`slide ${i + 1}: <${el.tagName.toLowerCase()}> bottom ${Math.round(r.bottom)} right ${Math.round(r.right)} "${(el.textContent || "").slice(0, 30)}"`);
      });
    });
    return res.slice(0, 12);
  });
  if (over.length) console.warn("LAYOUT WARNINGS (check the slide PNGs):\n  " + over.join("\n  "));
  for (let i = 0; i < 7; i++)
    await page.locator(".slide").nth(i).screenshot({ path: path.join(OUT, `slide-${i + 1}.png`) });
  fs.mkdirSync(path.join(ROOT, "demo"), { recursive: true });
  const pdf = path.join(ROOT, "demo/terrasight-deck.pdf");
  await page.pdf({ path: pdf, width: "1920px", height: "1080px", printBackground: true, preferCSSPageSize: true });
  const buf = fs.readFileSync(pdf);
  const pages = (buf.toString("latin1").match(/\/Type\s*\/Page[^s]/g) || []).length;
  console.log(`pdf: ${pdf}  ${(buf.length / 1e6).toFixed(2)} MB, ${pages} pages`);
  if (pages !== 7) throw new Error("PDF must have exactly 7 pages, has " + pages);
} finally {
  await browser.close();
}
