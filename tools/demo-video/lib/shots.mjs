// Shots: each records one take on the real app and returns the segments to keep.
// Every number in an overlay is read from the DOM at record time and asserted: nothing is typed in here.
import fs from "node:fs";
import path from "node:path";
import { OUT, ROOT } from "./env.mjs";
import { settle } from "./take.mjs";
import { openGraph, sources, tiles } from "./graphics.mjs";
import * as G2 from "./graphics2.mjs";
import * as G3 from "./graphics3.mjs";

const must = (v, what) => {
  if (v == null || (Array.isArray(v) && !v.length)) throw new Error("Could not read from the page: " + what);
  return v;
};
const px = (n) => `${n}px`;
const BIG = px(60);
const MID = px(44);

// Fill the remaining scene time with a slow push so there is never a dead frame.
async function holdUntil(take, tEnd, sel, fill = [0.7, 0.7]) {
  const left = tEnd - take.now();
  if (left > 0.25) await take.cam(sel, { dur: left * 1000, ease: "--ts-ease-enter", fill });
}

// ---------------------------------------------------------------- hook
async function hook(take, cfg, L) {
  const { page } = take;
  await page.goto(cfg.base + "/explore");
  const chip = page.locator("button.maplibregl-marker", { hasText: "Pivot 14" });
  await chip.waitFor();
  await page.locator("canvas").first().waitFor();
  // Years of NASA weather: from the page's own copy ("since 1981") and the (fixed) clock year.
  const intro = await page
    .getByText(/since \d{4}, from NASA POWER/)
    .first()
    .innerText();
  const since = Number(must(intro.match(/since (\d{4})/), "explore intro")[1]);
  const year = await page.evaluate(() => new Date().getFullYear());
  const years = year - since;
  if (years !== 45) throw new Error("expected 45 years of NASA weather, got " + years);
  await settle(page, 2500); // satellite tiles
  const map = await take.tag(page.locator("canvas").first().locator("xpath=ancestor::div[2]"), "map");
  await take.d("tok", "--ts-ink").then((v) => must(v, "design tokens in page"));

  const t0 = take.mark("ready");
  const say1 = take.d(
    "say",
    [
      { segs: [{ id: "y", text: String(years), mono: true }, { text: "years of NASA weather." }], size: BIG },
      { text: "One field.", accent: true, size: BIG },
    ],
    { pos: "bl" },
  );
  const camP = take.cam(map, { dur: 1800, fill: [0.55, 0.9], maxScale: 1.25 });
  await say1;
  await take.d("countUp", "y", String(years), 900);
  await take.cursorClick(chip, "chip", { dur: 900 });
  await chip.click();
  const tClick = take.mark("click");
  await camP;
  // wait for the real result
  const headline = page.getByText(/first autumn frost comes \d+ days? later/i).first();
  await headline.waitFor({ timeout: 60000 });
  await settle(page, 400);
  const tResult = take.mark("result");
  const text = await headline.innerText();
  const days = must(text.match(/first autumn frost comes (\d+) days? later/i), "headline")[1];
  const panel = await take.card(headline, "panel", 200);
  const camP2 = take.cam(null, {
    union: [map, panel],
    maxH: 560,
    dur: 1300,
    fill: [0.9, 0.82],
    anchor: [0.5, 0.46],
    maxScale: 1.7,
  });
  await take.d(
    "say",
    [
      {
        segs: [
          { text: "First autumn frost" },
          { id: "d", text: days, mono: true },
          { text: `day${days === "1" ? "" : "s"} later` },
        ],
        accent: true,
        size: BIG,
      },
    ],
    { pos: "bl" },
  );
  await take.d("countUp", "d", days, 900);
  await camP2;
  const left = tResult + (L - (tClick + 0.3 - t0)) + 0.5 - take.now();
  if (left > 0.25)
    await take.cam(null, {
      union: [map, panel],
      maxH: 560,
      dur: left * 1000,
      ease: "--ts-ease-enter",
      fill: [0.95, 0.86],
      anchor: [0.5, 0.46],
      maxScale: 1.8,
    });
  return {
    segs: [
      { from: t0, to: tClick + 0.3 },
      { from: tResult, to: tResult + 4 },
    ],
    facts: { years, days },
  };
}

// ---------------------------------------------------------------- brief: home
async function briefHome(take, cfg, L) {
  const { page } = take;
  await page.goto(cfg.base + "/");
  const line = page.getByText(/puts \$[\d,]+ less at risk/).first();
  await line.waitFor({ timeout: 30000 });
  await page
    .getByText(/good morning/i)
    .first()
    .waitFor();
  await settle(page, 700);
  const amount = must((await line.innerText()).match(/puts \$([\d,]+) less at risk/), "stress line")[1];
  const kicker = await page
    .getByText(/stress test/i)
    .first()
    .innerText();
  const card = await take.card(line, "card", 200);
  const t0 = take.mark("ready");
  const camP = take.cam(card, { dur: 1500, fill: [0.7, 0.8], anchor: [0.5, 0.5] });
  await take.d(
    "say",
    [
      {
        segs: [{ id: "a", text: "$" + amount, mono: true }, { text: "less at risk" }],
        accent: true,
        size: BIG,
      },
      {
        text: kicker
          .replace(/\s+/g, " ")
          .toLowerCase()
          .replace(/^./, (c) => c.toUpperCase()),
        size: px(30),
        weight: 500,
      },
    ],
    { pos: "bl" },
  );
  await take.d("countUp", "a", "$" + amount, 1000);
  await camP;
  await holdUntil(take, t0 + L + 0.4, card, [0.78, 0.88]);
  return { segs: [{ from: t0, to: t0 + L + 0.4 }], facts: { amount } };
}

// ---------------------------------------------------------------- brief: field headline
async function briefField(take, cfg, L) {
  const { page } = take;
  await page.goto(`${cfg.base}/fields/${cfg.fieldId}`);
  const kick = page.getByText(/the main thing on this field/i).first();
  await kick.waitFor({ timeout: 30000 });
  await settle(page, 700);
  const hero = await take.card(kick, "hero", 200);
  const lines = (await page.locator(hero).innerText())
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);
  const idx = must(
    lines.findIndex((l) => /^\+\$[\d,]+$/.test(l)),
    "headline money number",
  );
  const money = lines[idx];
  const label = lines[idx + 1];
  const title = lines.find((l) => /^Rotation for/i.test(l));
  await take.cam(hero, { dur: 1, fill: [0.8, 0.55], anchor: [0.5, 0.36] }); // start already framed on the card
  const t0 = take.mark("ready");
  const camP = take.cam(hero, { dur: 1100, fill: [0.94, 0.62], anchor: [0.5, 0.36] });
  await take.d(
    "say",
    [
      {
        segs: [
          { id: "m", text: money, mono: true },
          { text: label, small: true },
        ],
        accent: true,
        size: BIG,
      },
      { text: title, size: px(32), weight: 500 },
    ],
    { pos: "bl" },
  );
  await take.d("countUp", "m", money, 1000);
  await camP;
  const left = t0 + L + 0.4 - take.now();
  if (left > 0.25)
    await take.cam(hero, {
      dur: left * 1000,
      ease: "--ts-ease-enter",
      fill: [0.97, 0.66],
      anchor: [0.5, 0.36],
    });
  return { segs: [{ from: t0, to: t0 + L + 0.4 }], facts: { money, label } };
}

// ---------------------------------------------------------------- rotation
async function rotation(take, cfg, L) {
  const { page } = take;
  await page.goto(`${cfg.base}/fields/${cfg.fieldId}/rotation`);
  const tested = page.getByText(/Tested on \d+ weather paths and \d+ price scenarios/).first();
  await tested.waitFor({ timeout: 45000 });
  await page
    .getByText(/We compared \d+ options over \d+ seasons/)
    .first()
    .waitFor();
  await page.locator("svg").filter({ hasText: /2030/ }).first().waitFor({ timeout: 30000 });
  await settle(page, 900);
  const m = must(
    (await tested.innerText()).match(/Tested on (\d+) weather paths and (\d+) price scenarios/),
    "tested line",
  );
  const [paths, prices] = [m[1], m[2]];
  const optsText = await page
    .getByText(/We compared \d+ options over \d+ seasons/)
    .first()
    .innerText();
  const nSeasons = must(optsText.match(/over (\d+) seasons/), "options heading")[1];
  const rec = await take.card(tested, "rec", 200);
  // options block: heading down to the first row of option buttons
  const optsHead = await take.tag(page.getByText(/We compared \d+ options/).first(), "optshead");
  const optsBtn = await take.tag(
    page.getByRole("button", { name: /Choose this option|Chosen/ }).first(),
    "optsbtn",
  );
  const chartHead = page.getByText(/What the field earns over/).first();
  const chart = await take.card(chartHead, "chart", 250);
  const range = must(
    (
      await page
        .getByText(/Cumulative margin.*\d{4}.\d{4}/)
        .first()
        .innerText()
    ).match(/(\d{4})\D(\d{4})/),
    "chart range",
  );
  await take.cam(rec, { dur: 1, fill: [0.8, 0.55], anchor: [0.5, 0.38] });
  const t0 = take.mark("ready");
  const q = L / 3;
  // 1. recommended + how it was tested
  const c1 = take.cam(rec, { dur: 1000, fill: [0.9, 0.66], anchor: [0.5, 0.38] });
  await take.d(
    "say",
    [
      { segs: [{ id: "p", text: paths, mono: true }, { text: "weather runs" }], size: BIG },
      { segs: [{ id: "s", text: prices, mono: true }, { text: "price scenarios" }], accent: true, size: BIG },
    ],
    { pos: "bl" },
  );
  await Promise.all([take.d("countUp", "p", paths, 900), take.d("countUp", "s", prices, 900)]);
  await c1;
  const l1 = t0 + q - take.now();
  if (l1 > 0.25)
    await take.cam(rec, { dur: l1 * 1000, ease: "--ts-ease-enter", fill: [0.94, 0.68], anchor: [0.5, 0.38] });
  // 2. the options
  await take.d("clear");
  await take.cam(null, {
    union: [optsHead, optsBtn],
    dur: 1000,
    fill: [0.92, 0.82],
    anchor: [0.5, 0.42],
    maxScale: 1.4,
  });
  await take.d("say", [{ text: `${nSeasons} options, ${nSeasons} seasons`, size: BIG }], { pos: "bl" });
  const l2 = t0 + 2 * q - take.now();
  if (l2 > 0.25)
    await take.cam(null, {
      union: [optsHead, optsBtn],
      dur: l2 * 1000,
      ease: "--ts-ease-enter",
      fill: [0.95, 0.85],
      anchor: [0.5, 0.42],
      maxScale: 1.5,
    });
  // 3. cumulative chart
  await take.d("clear");
  await take.cam(chart, { dur: 1000, fill: [0.74, 0.84] });
  await take.d(
    "say",
    [
      {
        segs: [{ text: `${nSeasons} seasons` }, { text: `${range[1]}–${range[2]}`, mono: true }],
        accent: true,
        size: BIG,
      },
    ],
    { pos: "bl" },
  );
  await holdUntil(take, t0 + L + 0.4, chart, [0.8, 0.9]);
  return {
    segs: [{ from: t0, to: t0 + L + 0.4 }],
    facts: { paths, prices, nSeasons, range: range.slice(1) },
  };
}

// ---------------------------------------------------------------- proof: assistant (one live Gemini call)
async function assistant(take, cfg, L) {
  const { page } = take;
  await page.goto(`${cfg.base}/fields/${cfg.fieldId}`);
  const why = page.getByRole("button", { name: "Why?" }).first();
  await why.waitFor({ timeout: 30000 });
  await settle(page, 700);
  await page
    .getByRole("button", { name: "New chat" })
    .click()
    .catch(() => {});
  await page.waitForTimeout(500);
  const hero = await take.card(page.getByText(/the main thing on this field/i).first(), "hero", 200);
  const panel = await take.card(page.getByText(/^Context: /).first(), "panel", 300);
  const frame = { union: [panel, panel], maxH: 470, fill: [0.9, 0.8], anchor: [0.5, 0.45], maxScale: 1.6 };
  await take.cam(hero, { dur: 1, fill: [0.8, 0.55], anchor: [0.5, 0.36] });
  const t0 = take.mark("ready");
  await take.cam(hero, { dur: 600, fill: [0.9, 0.62], anchor: [0.5, 0.36] });
  await take.cursorClick(why, "why", { dur: 700 });
  await why.click();
  const tClick = take.mark("click");
  // the camera travels to the assistant while the real answer is being written (that wait is sped up in the cut)
  const camP = take.cam(null, { ...frame, dur: 1100 });
  const badge = page.getByText(/\d+ numbers? checked against the models/).first();
  await badge.waitFor({ timeout: 120000 });
  await camP;
  await page.waitForTimeout(300);
  const tAnswer = take.mark("answered");
  const badgeText = (await badge.innerText()).trim();
  const bm = must(badgeText.match(/^(\d+)\s+(.*)$/), "badge text");
  const badgeSel = await take.tag(badge, "badge");
  const post0 = take.now();
  const pulseP = take.d("pulse", badgeSel);
  await take.d(
    "say",
    [{ segs: [{ id: "n", text: bm[1], mono: true }, { text: bm[2] }], accent: true, size: MID }],
    { pos: "bl" },
  );
  await take.d("countUp", "n", bm[1], 700);
  await pulseP;
  const keepPre = tClick + 0.4 - t0;
  const l = post0 + Math.max(0.5, L - keepPre - 0.5) + 0.4 - take.now();
  if (l > 0.25)
    await take.cam(null, {
      ...frame,
      dur: l * 1000,
      ease: "--ts-ease-enter",
      fill: [0.94, 0.84],
      maxScale: 1.7,
    });
  return {
    segs: [
      { from: t0, to: tClick + 0.4 },
      { from: tClick + 0.4, to: tAnswer - 0.05, ramp: 0.5 },
      { from: post0, to: post0 + 5 },
    ],
    facts: { badge: badgeText },
  };
}

// ---------------------------------------------------------------- proof: trust
async function trust(take, cfg, L) {
  const { page } = take;
  await page.goto(`${cfg.base}/fields/${cfg.fieldId}/trust`);
  const head = page.getByText(/How closely the model follows what happened/).first();
  await head.waitFor({ timeout: 45000 });
  await page
    .getByText(/r = -?[\d.]+, mean error/)
    .first()
    .waitFor();
  await settle(page, 900);
  const card = await take.card(head, "card", 150);
  const txt = (await page.locator(card).innerText())
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);
  const rows = [];
  txt.forEach((l, i) => {
    const m = l.match(/^r = (-?[\d.]+), mean error ([\d.]+) points, (\d+) years/);
    if (m) rows.push({ label: txt[i - 1], r: m[1], years: m[3] });
  });
  must(rows.length >= 2 ? rows : null, "two r values");
  const t0 = take.mark("ready");
  const chartCard = await take.card(
    page.getByText(/Model, official yield and field greenness by year/).first(),
    "chartcard",
    200,
  );
  await page.locator("svg").filter({ hasText: /2022/ }).first().waitFor();
  const c = take.cam(chartCard, { dur: 1200, fill: [0.8, 0.8], anchor: [0.36, 0.5], maxScale: 1.7 });
  const parts = rows.slice(0, 2).map((r, i) => ({
    segs: [
      { text: "r", small: true },
      { id: "r" + i, text: r.r, mono: true },
      { text: r.label.replace(/^Model vs /, "vs "), small: true },
    ],
    accent: i === 0,
    size: px(46),
  }));
  await take.d("say", parts, { pos: "tr" });
  await Promise.all(rows.slice(0, 2).map((r, i) => take.d("countUp", "r" + i, r.r, 900)));
  await c;
  const l3 = t0 + L + 0.4 - take.now();
  if (l3 > 0.25)
    await take.cam(chartCard, {
      dur: l3 * 1000,
      ease: "--ts-ease-enter",
      fill: [0.86, 0.86],
      anchor: [0.36, 0.5],
      maxScale: 1.8,
    });
  return { segs: [{ from: t0, to: t0 + L + 0.4 }], facts: { rows: rows.slice(0, 2) } };
}

// ---------------------------------------------------------------- owner (phone)
async function owner(take, cfg, L) {
  const { page } = take;
  await page.goto(cfg.base + "/decisions");
  const approve = page.getByRole("button", { name: "Approve", exact: true });
  try {
    await approve.first().waitFor({ timeout: 20000 });
  } catch {
    const err = new Error("NO_WAITING_ITEMS");
    err.code = "NO_WAITING_ITEMS";
    throw err;
  }
  await settle(page, 800);
  const before = await approve.count();
  const t0 = take.mark("ready");
  await page.evaluate(() => (window.__demo.lock.on = false));
  const y = await approve.first().evaluate((el) => el.getBoundingClientRect().top + window.scrollY);
  const vh = 844;
  await take.d("smoothScroll", Math.max(0, y - vh * 0.5), 1000);
  await take.cursorClick(approve.first(), "approve", { dur: 800 });
  await approve.first().click();
  const tClick = take.mark("click");
  await page
    .waitForFunction(
      (n) =>
        [...document.querySelectorAll("button")].filter((b) => b.textContent.trim() === "Approve").length < n,
      before,
      { timeout: 20000 },
    )
    .catch(() => {});
  await page.waitForTimeout(900);
  const end = Math.max(take.now(), t0 + L + 0.4);
  await take
    .d("smoothScroll", Math.max(0, y - vh * 0.62), Math.max(400, (end - take.now()) * 1000))
    .catch(() => {});
  return { segs: [{ from: t0, to: Math.min(end, take.now()) }], facts: { before } };
}

// ---------------------------------------------------------------- end card
async function endCard(take, cfg, L) {
  const { page } = take;
  await page.goto(cfg.base + "/explore");
  const logo = page.locator("header > span").first();
  await logo.waitFor();
  const logoHtml = await logo.evaluate((el) => el.outerHTML);
  let team = "";
  try {
    const t = JSON.parse(fs.readFileSync(path.join(ROOT, "tools/demo-deck/team.json"), "utf8")).teamName;
    if (t && !/TEAM NAME|PLACEHOLDER/i.test(t)) team = t;
  } catch {
    // no team file: the card shows the event line only
  }
  const footer = "NASA Space Apps 2026 · Field Shift" + (team ? " · Team " + team : "");
  await settle(page, 500);
  const t0 = take.mark("ready");
  await page.evaluate(({ html, footer }) => {
    const card = document.createElement("div");
    card.id = "endcard";
    card.style.cssText = `position:fixed;inset:0;z-index:2147482000;background:var(--ts-bg);color:var(--ts-ink);display:flex;flex-direction:column;
      align-items:center;justify-content:center;gap:var(--ts-s8);font-family:var(--ts-font);text-align:center`;
    const row = (inner, css = "") => `<div class="er" style="${css}">${inner}</div>`;
    card.innerHTML =
      row(
        `<div style="transform:scale(2.4);transform-origin:center;pointer-events:none">${html}</div>`,
        "margin-bottom:var(--ts-s6)",
      ) +
      row(
        "The AI assistant for your farm",
        "font-size:84px;line-height:1.05;font-weight:700;letter-spacing:-0.035em;max-width:1700px;white-space:nowrap",
      ) +
      row('<div id="ul" style="height:10px;width:820px;border-radius:6px;background:var(--ts-signal);box-shadow:0 0 0 2px var(--ts-ink);transform-origin:0 50%"></div>', "margin-top:calc(var(--ts-s3) * -1)") +
      row(
        "NASA POWER · MODIS NDVI",
        "font-family:var(--ts-mono);font-size:36px;font-weight:600;letter-spacing:.02em;background:var(--ts-signal);color:var(--ts-on-signal);padding:var(--ts-s3) var(--ts-s6);border-radius:var(--ts-r-chip)",
      ) +
      row("github.com/nekojidev/Terrasight", "font-family:var(--ts-mono);font-size:34px;font-weight:600;color:var(--ts-ink)") +
      row("ESA Copernicus Sentinel-2 · USDA", "font-family:var(--ts-mono);font-size:22px;color:var(--ts-ink-2)") +
      row(
        footer,
        "font-family:var(--ts-mono);font-size:34px;font-weight:600;letter-spacing:.03em;color:var(--ts-ink);margin-top:var(--ts-s4)",
      ) +
      row(
        "Narration: AI-generated voices",
        "font-family:var(--ts-mono);font-size:22px;letter-spacing:.04em;color:var(--ts-ink-2)",
      );
    document.documentElement.appendChild(card);
    const d = window.__demo;
    // the wordmark draws in (left to right) and the mark pops; then the rows rise one after another
    const lg = card.children[0].firstElementChild;
    lg.animate([{ clipPath: "inset(0 100% 0 0)" }, { clipPath: "inset(0 0 0 0)" }], {
      duration: 300,
      easing: d.tok("--ts-ease-standard"),
      fill: "both",
    });
    card.animate([{ transform: "scale(1)" }, { transform: "scale(1.035)" }], { duration: 2650, easing: "linear", fill: "both" });
    document.getElementById("ul").animate([{ transform: "scaleX(0)" }, { transform: "scaleX(1)" }], { duration: 1300, delay: 650, easing: d.tok("--ts-ease-standard"), fill: "both" });
    [...card.children].slice(1).forEach((r, i) =>
      r.animate(
        [
          { transform: "translateY(30px)", opacity: 0 },
          { transform: "none", opacity: 1 },
        ],
        {
          duration: d.ms("--ts-dur-base"),
          delay: 250 + i * 90,
          easing: d.tok("--ts-ease-enter"),
          fill: "both",
        },
      ),
    );
  }, { html: logoHtml, footer });
  await page.waitForTimeout((L + 0.4) * 1000);
  return { segs: [{ from: t0, to: take.now() }] };
}


// ================================================================ the three-act story
const FIELD_FILE = path.join(ROOT, "data/presentation/fields/north-quarter.geojson");
const NEW_FIELD_NAME = "Home quarter";
const lines = async (page, sel) =>
  (await page.locator(sel).innerText())
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);
// rows of the climate block: "...", "Label:", "9 days later", "increase.", "clear trend"
const climateRows = (txt) => {
  const rows = [];
  txt.forEach((l, i) => {
    if (/^(no )?clear trend$/.test(l)) rows.push({ label: txt[i - 3].replace(/:$/, ""), value: txt[i - 2], trend: l });
  });
  return rows;
};

// ---------------------------------------------------------------- cold open: the field from space, "Ask your field."
async function coldOpen(take, cfg, L) {
  const { page } = take;
  await page.goto(`${cfg.base}/fields/${cfg.fieldId}/zones`);
  const canvas = page.locator("canvas").first();
  await canvas.waitFor({ timeout: 30000 });
  await settle(page, 1500);
  // the real map, enlarged to the whole frame for the opening shot
  const map = await take.tag(canvas.locator("xpath=ancestor::*[contains(@class,'maplibregl-map')][1]"), "map");
  await page.evaluate((sel) => {
    const el = document.querySelector(sel);
    el.style.cssText += ";position:fixed;left:0;top:0;width:1920px;height:1080px;z-index:50;border-radius:0";
    window.dispatchEvent(new Event("resize"));
  }, map);
  await settle(page, 2200);
  await take.cam(map, { dur: 1, fill: [1, 1], maxScale: 1 });
  const t0 = take.mark("ready");
  const push = take.cam(map, { dur: (L + 0.4) * 1000, ease: "--ts-ease-enter", fill: [1.2, 1.2], maxScale: 1.25 });
  await take.d("say", [{ text: "Ask your field.", accent: true, size: px(84) }], { pos: "tl" });
  await push;
  return { segs: [{ from: t0, to: t0 + L + 0.4 }], facts: {}, clicks: [] };
}

// ---------------------------------------------------------------- act 1: add a field (real; recorded once)
async function addField(take, cfg, L) {
  const { page } = take;
  await page.goto(cfg.base + "/fields/new");
  const choose = page.getByRole("button", { name: "Choose a file" });
  await settle(page, 1200);
  const modeFile = page.getByText("Upload a file", { exact: true }).first();
  const needMode = !(await choose.isVisible().catch(() => false));
  if (needMode) {
    await modeFile.click();
    await choose.waitFor({ timeout: 10000 });
    await page.waitForTimeout(500);
  }
  const box = await take.card(choose, "upload", 80);
  const form = await take.card(page.getByText("Your field", { exact: true }).first(), "form", 300);
  const nameInput = page.locator('input[name="name"]');
  await take.cam(null, { dur: 1 });
  const t0 = take.mark("ready");
  const clicks = [];
  take.d("title", "Add a field");
  await take.cursorClick(choose, "choose", { dur: 700 });
  clicks.push(take.now());
  await page.locator('input[type="file"]').setInputFiles(FIELD_FILE);
  const tUp = take.mark("uploaded");
  take.cam(null, { union: [box, form], dur: 900, fill: [0.86, 0.92], maxScale: 1.3, anchor: [0.5, 0.5] });
  await page.getByText(/Full data|Basic data|Estimate/).first().waitFor({ timeout: 40000 });
  await settle(page, 1300);
  const tPrev = take.mark("checked");
  const formText = (await page.locator(form).innerText()).replace(/\s+/g, " ");
  const area = must(formText.match(/(\d[\d,.]*)\s*(ac|ha)\b/), "area");
  const tier = must(formText.match(/(Full data|Basic data|Estimate)/), "tier")[1];
  if (tier !== "Full data") throw new Error("expected Full data for the US outline, got " + tier);
  const loc = must(formText.match(/\b([A-Z][a-z]+ County, [A-Z]{2})/), "location")[1];
  const areaStr = `${area[1]} ${area[2]}`;
  await take.d(
    "say",
    [
      { segs: [{ id: "a", text: areaStr, mono: true }], accent: true, size: BIG },
      { text: `${tier} · ${loc}`, size: px(34), weight: 500 },
    ],
    { pos: "bl" },
  );
  await take.d("countUp", "a", areaStr, 800);
  await page.waitForTimeout(500);
  // name it, say it is dryland, add it
  await take.cursorClick(nameInput, "name", { dur: 500 });
  await nameInput.fill("");
  await nameInput.pressSequentially(NEW_FIELD_NAME, { delay: 40 });
  await page.waitForTimeout(250);
  const no = page.getByRole("button", { name: "No", exact: true });
  await take.cursorClick(no, "no", { dur: 450 });
  await no.click();
  clicks.push(take.now());
  await page.waitForTimeout(300);
  const add = page.getByRole("button", { name: "Add the field" });
  await take.cursorClick(add, "add", { dur: 550 });
  await page.waitForTimeout(150);
  await add.click();
  clicks.push(take.now());
  const tEnd = take.now() + 0.35;
  await page.waitForURL(/\/fields\/[0-9a-f-]{36}$/, { timeout: 40000 });
  return {
    segs: [
      { from: t0, to: tUp },
      { from: tUp, to: tPrev, ramp: 0.8 },
      { from: tPrev, to: tEnd },
    ],
    facts: { area: areaStr, tier, loc, name: NEW_FIELD_NAME, fieldId: page.url().split("/").pop() },
    clicks,
  };
}

// ---------------------------------------------------------------- act 2: the climate shift of the field
async function climate(take, cfg, L) {
  const { page } = take;
  await page.goto(`${cfg.base}/fields/${cfg.fieldId}`);
  const heading = page.getByText(/The first autumn frost comes \d+ days? later/).first();
  await heading.waitFor({ timeout: 45000 });
  await settle(page, 900);
  const card = await take.card(heading, "shift", 300);
  const kicker = (await page.getByText(/FIELD SHIFT/i).first().innerText()).replace(/\s+/g, " ");
  const yr = must(kicker.match(/(\d{4})\D+(\d{4})/), "field shift years");
  const years = Number(yr[2]) - Number(yr[1]);
  if (years !== 45) throw new Error("expected 45 years of NASA weather, got " + years);
  const rows = climateRows(await lines(page, card));
  const clear = rows.filter((r) => r.trend === "clear trend").slice(0, 3);
  if (clear.length < 3) throw new Error("expected three clear-trend rows");
  const short = { "First autumn frost": "first frost", "Frost-free days": "frost-free", "Growing degree days": "growing degrees" };
  await take.cam(card, { dur: 1, fill: [0.72, 0.8], anchor: [0.5, 0.45], maxScale: 1.25 });
  const t0 = take.mark("ready");
  take.d("title", `${years} years of NASA data`, 900);
  const wait = async (t) => {
    const d = t0 + t - take.now();
    if (d > 0.02) await page.waitForTimeout(d * 1000);
  };
  const camP = take.cam(card, { dur: 900, fill: [0.84, 0.86], anchor: [0.5, 0.45], maxScale: 1.35 });
  await wait(0.35);
  await take.d(
    "say",
    clear.map((r, i) => ({
      segs: [
        { id: "c" + i, text: r.value, mono: true },
        { text: short[r.label] ?? r.label.toLowerCase(), small: true },
      ],
      accent: i === 0,
      size: px(40),
    })),
    { pos: "bl" },
  );
  await Promise.all(clear.map((r, i) => take.d("countUp", "c" + i, r.value, 700)));
  await camP;
  await wait(2.15);
  // honesty: open all metrics and show the rainfall row, which has no clear trend
  const all = page.getByText("All metrics", { exact: true }).first();
  await take.cursorClick(all, "all", { dur: 450 });
  await all.click();
  const clickAt = take.now() - t0;
  await page.waitForTimeout(150);
  const rain = page.getByText("Growing-season rainfall", { exact: true }).first();
  await rain.waitFor();
  const rainRow = await rain.evaluate((el) => {
    let n = el;
    while (n.parentElement && !/no clear trend/.test(n.innerText)) n = n.parentElement;
    n.setAttribute("data-demo-target", "rain");
    return n.innerText;
  });
  const rr = climateRows(
    rainRow
      .split("\n")
      .map((x) => x.trim())
      .filter(Boolean),
  )[0];
  if (!rr || rr.trend !== "no clear trend") throw new Error("rainfall row should say no clear trend");
  const camR = take.cam('[data-demo-target="rain"]', { dur: 700, fill: [0.7, 0.3], anchor: [0.5, 0.42], maxScale: 1.5 });
  await take.d(
    "say",
    [
      { segs: [{ text: "Rainfall" }, { id: "r", text: rr.value, mono: true }], size: px(40) },
      { text: "no clear trend", size: px(34), weight: 500 },
    ],
    { pos: "bl" },
  );
  await camR;
  const tEnd = t0 + L + 0.4;
  const left = tEnd - take.now();
  if (left > 0.1) await page.waitForTimeout(left * 1000);
  return { segs: [{ from: t0, to: tEnd }], facts: { years, clear, rain: rr }, clicks: [t0 + clickAt] };
}

// ---------------------------------------------------------------- act 2: risks, week, history (three quick cuts)
async function overview(take, cfg, L) {
  const { page } = take;
  await page.goto(`${cfg.base}/fields/${cfg.fieldId}`);
  const risks = page.getByRole("heading", { name: "Top risks" }).first();
  await risks.waitFor({ timeout: 45000 });
  await settle(page, 900);
  const nRisks = must((await page.getByText(/^Show all \d+$/).first().innerText()).match(/\d+/), "risk count")[0];
  const week = page.getByRole("heading", { name: /^Next \d+ days$/ }).first();
  const nDays = must((await week.innerText()).match(/\d+/), "days")[0];
  const hist = page.getByRole("heading", { name: /^\d+ seasons on this field$/ }).first();
  const nSeasons = must((await hist.innerText()).match(/\d+/), "seasons")[0];
  const c1 = await take.card(risks, "risks", 200);
  const c2 = await take.card(week, "week", 200);
  const c3 = await take.card(hist, "hist", 200);
  const q = L / 3;
  await take.cam(c1, { dur: 1, fill: [0.7, 0.7], maxScale: 1.4 });
  const t0 = take.mark("ready");
  const step = async (sel, parts, until, fill) => {
    await take.d("say", parts, { pos: "bl" });
    await take.cam(sel, { dur: 380, fill, maxScale: 1.8 });
    const left = until - take.now();
    if (left > 0.2) await take.cam(sel, { dur: left * 1000, ease: "--ts-ease-enter", fill: [fill[0] + 0.04, fill[1] + 0.04], maxScale: 1.8 });
  };
  await step(c1, [{ segs: [{ id: "a", text: nRisks, mono: true }, { text: "risks, ranked" }], accent: true, size: px(46) }], t0 + q, [0.76, 0.8]);
  await step(c2, [{ segs: [{ id: "b", text: nDays, mono: true }, { text: "days ahead" }], size: px(46) }], t0 + 2 * q, [0.74, 0.76]);
  await step(c3, [{ segs: [{ id: "c", text: nSeasons, mono: true }, { text: "seasons of history" }], accent: true, size: px(46) }], t0 + L + 0.4, [0.9, 0.6]);
  return { segs: [{ from: t0, to: t0 + L + 0.4 }], facts: { nRisks, nDays, nSeasons }, clicks: [] };
}

// ---------------------------------------------------------------- act 2: five seasons, the plan
async function plan(take, cfg, L) {
  const { page } = take;
  await page.goto(`${cfg.base}/fields/${cfg.fieldId}/rotation`);
  const tested = page.getByText(/Tested on \d+ weather paths and \d+ price scenarios/).first();
  await tested.waitFor({ timeout: 45000 });
  await page.getByText(/We compared \d+ options over \d+ seasons/).first().waitFor();
  await page.locator("svg").filter({ hasText: /2030/ }).first().waitFor({ timeout: 30000 });
  await settle(page, 900);
  const m = must((await tested.innerText()).match(/Tested on (\d+) weather paths and (\d+) price scenarios/), "tested");
  const nOpt = must(
    (await page.getByText(/We compared \d+ options over \d+ seasons/).first().innerText()).match(/compared (\d+) options over (\d+) seasons/),
    "options",
  );
  const optsHead = await take.tag(page.getByText(/We compared \d+ options/).first(), "optshead");
  const optsBtn = await take.tag(page.getByRole("button", { name: /Choose this option|Chosen/ }).first(), "optsbtn");
  const chart = await take.card(page.getByText(/What the field earns over/).first(), "chart", 250);
  const range = must(
    (await page.getByText(/Cumulative margin.*\d{4}.\d{4}/).first().innerText()).match(/(\d{4})\D(\d{4})/),
    "range",
  );
  await take.cam(null, { union: [optsHead, optsBtn], dur: 1, fill: [0.9, 0.8], anchor: [0.5, 0.42], maxScale: 1.3 });
  const t0 = take.mark("ready");
  const half = (L + 0.4) / 2;
  take.d("say", [{ segs: [{ id: "n", text: nOpt[1], mono: true }, { text: `options, ${range[1]}–${range[2]}` }], accent: true, size: px(46) }], { pos: "bl" });
  await take.cam(null, { union: [optsHead, optsBtn], dur: half * 1000 - 100, ease: "--ts-ease-enter", fill: [0.95, 0.85], anchor: [0.5, 0.42], maxScale: 1.4 });
  await take.cam(chart, { dur: 450, fill: [0.7, 0.8] });
  await take.d(
    "say",
    [
      { segs: [{ id: "p", text: m[1], mono: true }, { text: "weather runs" }], size: px(44) },
      { segs: [{ id: "s", text: m[2], mono: true }, { text: "price scenarios" }], accent: true, size: px(44) },
    ],
    { pos: "bl" },
  );
  await holdUntil(take, t0 + L + 0.4, chart, [0.78, 0.86]);
  return { segs: [{ from: t0, to: t0 + L + 0.4 }], facts: { paths: m[1], prices: m[2], options: nOpt[1], range: range.slice(1) }, clicks: [] };
}

// ---------------------------------------------------------------- act 3: ask the assistant a real question (live Gemini call; recorded once)
const askShot = (question, key) =>
  async function (take, cfg, L) {
    const { page } = take;
    await page.goto(`${cfg.base}/fields/${cfg.fieldId}`);
    const input = page.getByPlaceholder(/Ask about any field/);
    await input.waitFor({ timeout: 45000 });
    await settle(page, 700);
    await page.getByRole("button", { name: "New chat" }).click().catch(() => {});
    await page.waitForTimeout(500);
    const panel = await take.card(page.getByText(/^Context: /).first(), "panel", 300);
    const frame = { union: [panel, panel], fill: [0.9, 0.94], anchor: [0.5, 0.5], maxScale: 1.3 };
    await take.cam(panel, { dur: 1, ...frame, union: undefined });
    const t0 = take.mark("ready");
    if (key === "ask1") take.d("title", "Ask anything");
    const camP = take.cam(null, { ...frame, dur: 700 });
    await take.cursorClick(input, "input", { dur: 550 });
    await input.click();
    await camP;
    await input.pressSequentially(question, { delay: 34 });
    await page.waitForTimeout(250);
    const tType = take.mark("typed");
    await input.press("Enter");
    const tSend = take.mark("sent");
    const badge = page.getByText(/\d+ numbers? checked against the models/).first();
    await badge.waitFor({ timeout: 150000 });
    await page.waitForTimeout(500);
    const tAnswer = take.mark("answered");
    const badgeText = (await badge.innerText()).trim();
    const bm = must(badgeText.match(/^(\d+)\s+(.*)$/), "badge");
    const badgeSel = await take.tag(badge, "badge");
    const answerText = (await page.locator(panel).innerText()).replace(/\s+/g, " ");
    const post0 = take.now();
    const pulseP = take.d("pulse", badgeSel);
    await take.d("say", [{ segs: [{ id: "n", text: bm[1], mono: true }, { text: bm[2] }], accent: true, size: px(40) }], { pos: "bl" });
    await take.d("countUp", "n", bm[1], 600);
    await pulseP;
    const keep = Math.max(0.6, L + 0.4 - (tSend + 0.3 - t0) - 0.6);
    const l = post0 + keep - take.now();
    if (l > 0.25) await take.cam(null, { ...frame, dur: l * 1000, ease: "--ts-ease-enter", fill: [0.94, 0.9], maxScale: 1.5 });
    return {
      segs: [
        { from: t0, to: tType },
        { from: tType, to: tSend + 0.3 },
        { from: tSend + 0.3, to: tAnswer - 0.1, ramp: 0.6 },
        { from: post0, to: post0 + 6 },
      ],
      facts: { question, badge: badgeText, answer: answerText.slice(0, 600) },
      clicks: [tSend],
    };
  };
const ask1 = askShot("Has the climate of this field changed?", "ask1");
const ask2 = askShot("What should I plant next season?", "ask2");

// ---------------------------------------------------------------- backdrop for the phone scene (rendered from tokens)
export async function renderPhoneBackdrop(browser, cfg, stateFile, file) {
  const ctx = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
    locale: "en-US",
    storageState: stateFile,
  });
  await ctx.addCookies([{ name: "ts_locale", value: "en", url: cfg.base }]);
  const page = await ctx.newPage();
  await page.goto(cfg.base + "/explore");
  await settle(page, 400);
  const geo = await page.evaluate(() => {
    const vw = 416,
      vh = 900,
      x = 1160,
      y = (1080 - vh) / 2;
    const c = document.createElement("div");
    c.style.cssText =
      "position:fixed;inset:0;z-index:2147483000;background:var(--ts-bg);font-family:var(--ts-font);color:var(--ts-ink)";
    c.innerHTML = `
      <div style="position:absolute;left:200px;top:50%;translate:0 -50%">
        <div style="font-family:var(--ts-mono);font-size:22px;letter-spacing:.08em;text-transform:uppercase;color:var(--ts-ink-3)">Owner · on the phone</div>
        <div style="font-size:96px;line-height:1.02;font-weight:700;letter-spacing:-0.035em;margin-top:var(--ts-s4)">The owner decides<br>in one tap.</div>
      </div>
      <div style="position:absolute;left:${x - 14}px;top:${y - 14}px;width:${vw + 28}px;height:${vh + 28}px;border-radius:64px;border:14px solid var(--ts-ink);box-sizing:border-box;box-shadow:var(--ts-shadow-hero);background:var(--ts-surface)"></div>`;
    document.documentElement.appendChild(c);
    return { x, y, w: vw, h: vh };
  });
  await page.screenshot({ path: file });
  await ctx.close();
  return geo;
}

export const SHOTS = { openGraph, sources, tiles, coldOpen, addField, climate, overview, plan, trust, ask1, ask2, endCard, hook, briefHome, briefField, rotation, assistant, owner };

Object.assign(SHOTS, { orbitDown: G3.orbitDown, endOrbit: G3.endOrbit, title: G2.title, proof: G2.proof, askLive: G2.askLive, today: G2.today, climate: G2.climate, rotation: G2.rotation });

/** A lime pill (design tokens) as a transparent PNG, for overlays that are added in the edit. */
export async function renderPill(browser, cfg, text, file) {
  const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 }, locale: "en-US" });
  const page = await ctx.newPage();
  await page.goto(cfg.base + "/explore");
  await page.locator("header > span").first().waitFor();
  await page.evaluate((t) => {
    document.documentElement.style.background = "transparent";
    document.body.style.background = "transparent";
    [...document.body.children].forEach((c) => (c.style.display = "none"));
    const d = document.createElement("div");
    d.id = "pill";
    d.textContent = t;
    d.style.cssText = `position:fixed;left:60px;top:60px;padding:var(--ts-s3) var(--ts-s6);border-radius:var(--ts-r-card);background:var(--ts-signal);color:var(--ts-on-signal);box-shadow:var(--ts-shadow-hero);font-family:var(--ts-font);font-size:72px;font-weight:600;letter-spacing:-0.03em;line-height:1.15;white-space:nowrap`;
    document.body.appendChild(d);
  }, text);
  await page.waitForTimeout(300);
  await page.locator("#pill").screenshot({ path: file, omitBackground: true });
  await ctx.close();
}
