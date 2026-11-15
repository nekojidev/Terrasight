// Shots: each records one take on the real app and returns the segments to keep.
// Every number in an overlay is read from the DOM at record time and asserted: nothing is typed in here.
import fs from "node:fs";
import path from "node:path";
import { OUT } from "./env.mjs";
import { settle } from "./take.mjs";

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
  await settle(page, 500);
  const t0 = take.mark("ready");
  await page.evaluate((html) => {
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
        "From NASA data to tomorrow’s decision",
        "font-size:80px;line-height:1.05;font-weight:700;letter-spacing:-0.035em;max-width:1800px;white-space:nowrap",
      ) +
      row(
        "NASA POWER · MODIS NDVI",
        "font-family:var(--ts-mono);font-size:36px;font-weight:600;letter-spacing:.02em;background:var(--ts-signal);color:var(--ts-on-signal);padding:var(--ts-s3) var(--ts-s6);border-radius:var(--ts-r-chip)",
      ) +
      row("USDA CDL · USDA NASS", "font-family:var(--ts-mono);font-size:22px;color:var(--ts-ink-2)") +
      row(
        "NASA Space Apps 2026 · Field Shift",
        "font-family:var(--ts-mono);font-size:20px;letter-spacing:.08em;text-transform:uppercase;color:var(--ts-ink-3);margin-top:var(--ts-s6)",
      );
    document.documentElement.appendChild(card);
    // slow push so the held card never freezes
    card.animate([{ transform: "scale(1)" }, { transform: "scale(1.04)" }], {
      duration: 6000,
      easing: window.__demo.tok("--ts-ease-enter"),
      fill: "both",
    });
    const d = window.__demo;
    [...card.children].forEach((r, i) =>
      r.animate(
        [
          { transform: "translateY(30px)", opacity: 0 },
          { transform: "none", opacity: 1 },
        ],
        {
          duration: d.ms("--ts-dur-slow"),
          delay: i * d.ms("--ts-stagger") * 3,
          easing: d.tok("--ts-ease-enter"),
          fill: "both",
        },
      ),
    );
  }, logoHtml);
  await page.waitForTimeout((L + 0.4) * 1000);
  return { segs: [{ from: t0, to: take.now() }] };
}

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

export const SHOTS = { hook, briefHome, briefField, rotation, assistant, trust, owner, endCard };
