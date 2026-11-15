// Motion-graphics shots: small pages built from design/tokens.css and fed with numbers read from the real app or computed
// from the real NASA POWER series. Each is recorded by Playwright like any other take (on top of the app's /explore page,
// which only provides the tokens and the fonts).
import fs from "node:fs";
import path from "node:path";
import { ROOT } from "./env.mjs";
import { settle } from "./take.mjs";
import { loadFrostSeries } from "./series.mjs";

const must = (v, what) => {
  if (v == null || (Array.isArray(v) && !v.length)) throw new Error("Could not read from the page: " + what);
  return v;
};
const px = (n) => `${n}px`;

async function stage(take, cfg) {
  const { page } = take;
  await page.goto(cfg.base + "/explore");
  const logo = page.locator("header > span").first();
  await logo.waitFor();
  const logoHtml = await logo.evaluate((el) => el.outerHTML);
  await page.evaluate(() => {
    const s = document.createElement("div");
    s.id = "stage";
    s.style.cssText =
      "position:fixed;inset:0;z-index:2147482000;background:var(--ts-bg);color:var(--ts-ink);font-family:var(--ts-font);overflow:hidden";
    document.documentElement.appendChild(s);
  });
  await page.waitForTimeout(250);
  return logoHtml;
}

const fieldLines = async (page, sel) =>
  (await page.locator(sel).innerText())
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);

// ---------------------------------------------------------------- a. "45 years in 3 seconds"
export async function openGraph(take, cfg, L) {
  const { page } = take;
  // 1. read what the app states for this field
  await page.goto(`${cfg.base}/fields/${cfg.fieldId}`);
  const row = page.getByText(/How this field's climate has changed/).first();
  await row.waitFor({ timeout: 45000 });
  await settle(page, 600);
  await row.click();
  await page.waitForTimeout(700);
  const txt = await row.evaluate((el) => {
    let n = el;
    for (let i = 0; i < 8 && n.parentElement; i++) {
      n = n.parentElement;
      if (n.innerText.includes("All metrics")) break;
    }
    return n.innerText;
  });
  const mv = must(txt.match(/The first autumn frost comes (\d+ days? later)/), "first frost takeaway");
  const md = must(txt.match(/(\w{3} \d+) → (\w{3} \d+) · (about [^\n]+)/), "frost dates line");
  const app = { base: md[1], recent: md[2], value: mv[1], trend: md[3] };
  // 2. the real annual series of the field's grid cell, computed with the project's own code
  const S = await loadFrostSeries();
  const date = (doy) =>
    new Date(Date.UTC(2025, 0, Math.round(doy))).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
  const delta = Math.round(S.recent - S.baseline);
  const checks = {
    baseline: [date(S.baseline), app.base],
    recent: [date(S.recent), app.recent],
    value: [`${delta} days later`, app.value],
    trend: [`about ${Math.round(S.metric.trend.slopePerDecade)} days later every 10 years`, app.trend],
  };
  for (const [k, [mine, theirs]] of Object.entries(checks))
    if (mine !== theirs) throw new Error(`series ${k} (${mine}) does not match the app (${theirs})`);
  if (S.years.length !== 45 || S.years[0].year !== 1981) throw new Error("expected 45 annual points from 1981");
  // 3. the stage
  await stage(take, cfg);
  const t0 = take.mark("ready");
  await page.evaluate(
    (D) => {
      const st = document.getElementById("stage");
      const NS = "http://www.w3.org/2000/svg";
      const X = (y) => 200 + ((y - 1981) / 44) * 1500;
      const Y = (d) => 910 - ((d - 262) / (324 - 262)) * 520;
      const label = (doy) =>
        new Date(Date.UTC(2025, 0, Math.round(doy))).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
      st.innerHTML = `
        <div style="position:absolute;left:96px;top:58px;font-family:var(--ts-mono);font-size:24px;letter-spacing:.08em;text-transform:uppercase;color:var(--ts-ink-3)">NASA POWER · first autumn frost, every year</div>
        <div id="yr" style="position:absolute;left:92px;top:96px;font-family:var(--ts-mono);font-size:230px;line-height:1;font-weight:700;letter-spacing:-0.05em">1981</div>
        <svg id="cv" viewBox="0 0 1920 1080" width="1920" height="1080" style="position:absolute;inset:0"></svg>
        <div id="res" style="position:absolute;right:96px;top:110px;display:flex;flex-direction:column;align-items:flex-end;gap:var(--ts-s3);opacity:0">
          <div style="background:var(--ts-signal);color:var(--ts-on-signal);padding:var(--ts-s3) var(--ts-s6);border-radius:var(--ts-r-card);box-shadow:var(--ts-shadow-hero);font-size:76px;font-weight:700;letter-spacing:-0.03em;font-family:var(--ts-mono)">${D.value}</div>
          <div style="background:var(--ts-ink);color:var(--ts-surface);padding:var(--ts-s2) var(--ts-s5);border-radius:var(--ts-r-chip);font-size:30px;font-weight:600">${D.trend}</div>
        </div>`;
      const svg = document.getElementById("cv");
      const el = (n, a) => {
        const e = document.createElementNS(NS, n);
        for (const k in a) e.setAttribute(k, a[k]);
        svg.appendChild(e);
        return e;
      };
      [274, 288, 305, 319].forEach((d) => {
        el("line", { x1: 200, x2: 1700, y1: Y(d), y2: Y(d), stroke: "var(--ts-line)", "stroke-width": 2 });
        const t = el("text", { x: 1730, y: Y(d) + 8, fill: "var(--ts-ink-3)", "font-size": 24, "font-family": "var(--ts-mono)" });
        t.textContent = label(d);
      });
      [1981, 2000, 2006, 2025].forEach((y) => {
        const t = el("text", { x: X(y), y: 975, fill: "var(--ts-ink-3)", "font-size": 24, "font-family": "var(--ts-mono)", "text-anchor": "middle" });
        t.textContent = y;
      });
      const line = el("polyline", { fill: "none", stroke: "var(--ts-ink)", "stroke-width": 4, "stroke-linejoin": "round", points: "" });
      const dots = [];
      const head = el("circle", { r: 11, fill: "var(--ts-signal)", stroke: "var(--ts-ink)", "stroke-width": 4, cx: -50, cy: -50 });
      const seg = (y0, y1, v, lab, dx) => {
        const l = el("line", { x1: X(y0), x2: X(y1), y1: Y(v), y2: Y(v), stroke: "var(--ts-ink)", "stroke-width": 6, "stroke-dasharray": "14 10", opacity: 0 });
        const t = el("text", { x: X(y0) + dx, y: Y(v) - 16, fill: "var(--ts-ink)", "font-size": 34, "font-weight": 700, "font-family": "var(--ts-mono)", opacity: 0 });
        t.textContent = lab;
        return [l, t];
      };
      const b = seg(1981, 2000, D.baseline, label(D.baseline), 0);
      const r = seg(2006, 2025, D.recent, label(D.recent), 0);
      const ts = el("line", {
        x1: X(1981), y1: Y(D.a + D.b * 1981), x2: X(2025), y2: Y(D.a + D.b * 2025),
        stroke: "var(--ts-signal)", "stroke-width": 12, "stroke-linecap": "round", opacity: 0,
      });
      const tsInk = el("line", {
        x1: X(1981), y1: Y(D.a + D.b * 1981), x2: X(2025), y2: Y(D.a + D.b * 2025),
        stroke: "var(--ts-ink)", "stroke-width": 4, "stroke-linecap": "round", opacity: 0,
      });
      const ease = (k) => (k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2);
      const RACE = 2400;
      const start = performance.now();
      const n = D.years.length;
      const yrEl = document.getElementById("yr");
      let shown = 0;
      const tick = (now) => {
        const p = Math.min(1, (now - start) / RACE);
        const idx = Math.max(0, Math.round(ease(p) * (n - 1)));
        for (; shown <= idx; shown++) {
          const pt = D.years[shown];
          const c = el("circle", { r: 5, fill: "var(--ts-ink)", cx: X(pt.year), cy: Y(pt.doy) });
          dots.push(c);
        }
        line.setAttribute("points", D.years.slice(0, idx + 1).map((q) => `${X(q.year)},${Y(q.doy)}`).join(" "));
        head.setAttribute("cx", X(D.years[idx].year));
        head.setAttribute("cy", Y(D.years[idx].doy));
        svg.appendChild(head);
        yrEl.textContent = D.years[idx].year;
        if (p < 1) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
      const tok = (nme) => getComputedStyle(document.documentElement).getPropertyValue(nme).trim();
      const fadeIn = (e, delay, dur = 300) =>
        e.animate([{ opacity: 0 }, { opacity: 1 }], { duration: dur, delay, easing: tok("--ts-ease-enter"), fill: "both" });
      [...b, ...r].forEach((e) => fadeIn(e, RACE + 100));
      const sweep = (e, delay) => {
        const len = Math.hypot(X(2025) - X(1981), Y(D.a + D.b * 2025) - Y(D.a + D.b * 1981));
        e.setAttribute("stroke-dasharray", len);
        e.animate([{ strokeDashoffset: len, opacity: 1 }, { strokeDashoffset: 0, opacity: 1 }], {
          duration: 650, delay, easing: tok("--ts-ease-standard"), fill: "forwards",
        });
      };
      sweep(ts, RACE + 500);
      sweep(tsInk, RACE + 500);
      const res = document.getElementById("res");
      res.animate(
        [
          { opacity: 0, transform: "translateY(26px) scale(.96)" },
          { opacity: 1, transform: "none" },
        ],
        { duration: 260, delay: RACE + 1000, easing: tok("--ts-ease-emphasis"), fill: "both" },
      );
    },
    {
      years: S.years,
      baseline: S.baseline,
      recent: S.recent,
      a: S.ts.intercept,
      b: S.ts.slope,
      value: app.value,
      trend: app.trend,
    },
  );
  await page.waitForTimeout((L + 0.4) * 1000);
  return {
    segs: [{ from: t0, to: t0 + L + 0.4 }],
    facts: {
      source: `NASA POWER daily series of the grid cell lat ${S.cell.lat}, lon ${S.cell.lon} (North quarter), fetched with packages/sources 'power' adapter, data to ${S.dataDate}; annual first autumn frost from packages/climate seasonSeries; Theil-Sen from packages/climate theilSen`,
      years: S.years.length,
      baseline: `${S.baseline} (${app.base})`,
      recent: `${S.recent} (${app.recent})`,
      slopePerDecade: S.metric.trend.slopePerDecade,
      app,
      significant: S.metric.trend.significant,
    },
    clicks: [],
  };
}

// ---------------------------------------------------------------- b. "it reads it for you"
export async function sources(take, cfg, L) {
  const { page } = take;
  await page.goto(`${cfg.base}/fields/${cfg.fieldId}`);
  const askBtn = page.getByText("Ask the assistant about your fields…").first();
  await askBtn.waitFor({ timeout: 45000 });
  await settle(page, 500);
  const svgHtml = await askBtn.evaluate((el) => el.closest("button,div").querySelector("svg").outerHTML);
  const markHtml = `<span style="display:flex;color:var(--ts-surface)">${svgHtml.replace(/<svg /, '<svg style="color:var(--ts-surface);width:24px;height:24px" ').replace(/class="[^"]*"/, "")}</span>`;
  const body = await page.locator("body").innerText();
  for (const need of [/NASA POWER/, /USDA/]) if (!need.test(body)) throw new Error("source name not on the field page: " + need);
  await stage(take, cfg);
  const t0 = take.mark("ready");
  await page.evaluate(
    ({ markHtml, chips }) => {
      const st = document.getElementById("stage");
      const tok = (n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
      st.innerHTML = `<div id="mark" style="position:absolute;left:50%;top:50%;width:230px;height:230px;margin:-115px 0 0 -115px;border-radius:56px;background:var(--ts-ink);color:var(--ts-surface);display:flex;align-items:center;justify-content:center;box-shadow:var(--ts-shadow-hero)"><div style="transform:scale(4.6);display:flex">${markHtml}</div></div>
        <div id="name" style="position:absolute;left:0;right:0;top:calc(50% + 150px);text-align:center;font-size:72px;font-weight:700;letter-spacing:-0.035em;opacity:0">Terrasight reads it for you</div>`;
      const mark = document.getElementById("mark");
      // inner span from the app carries its own background: neutralise so the mark reads as one block
      mark.firstElementChild.firstElementChild.style.cssText += ";background:transparent;width:auto;height:auto";
      const pos = [
        [-0.55, -0.36],
        [0.55, -0.3],
        [-0.5, 0.36],
        [0.52, 0.34],
      ];
      chips.forEach((c, i) => {
        const e = document.createElement("div");
        e.textContent = c.text;
        e.style.cssText = `position:absolute;left:50%;top:50%;padding:var(--ts-s4) var(--ts-s8);border-radius:var(--ts-r-chip);font-family:var(--ts-mono);font-size:44px;font-weight:600;white-space:nowrap;
          background:${c.accent ? "var(--ts-signal)" : "var(--ts-surface)"};color:${c.accent ? "var(--ts-on-signal)" : "var(--ts-ink)"};border:2px solid var(--ts-ink);box-shadow:var(--ts-shadow-hero);translate:-50% -50%`;
        st.appendChild(e);
        const fx = pos[i][0] * 1920,
          fy = pos[i][1] * 1080;
        // fly in from the corner to just beside the mark, then converge into it
        e.animate(
          [
            { transform: `translate(${fx * 1.6}px,${fy * 1.7}px) scale(1)`, opacity: 0 },
            { transform: `translate(${fx}px,${fy}px) scale(1)`, opacity: 1, offset: 0.35 },
            { transform: `translate(${fx * 0.9}px,${fy * 0.9}px) scale(1)`, opacity: 1, offset: 0.55 },
            { transform: `translate(${fx * 0.25}px,${fy * 0.25}px) scale(.6)`, opacity: 0.5, offset: 0.85 },
            { transform: "translate(0,0) scale(.3)", opacity: 0 },
          ],
          { duration: 1700, delay: i * 140, easing: tok("--ts-ease-standard"), fill: "both" },
        );
      });
      // the pulse when the last chip arrives
      const T = 1700 + 3 * 140 - 120;
      mark.animate(
        [{ transform: "scale(1)" }, { transform: "scale(1.16)", offset: 0.4 }, { transform: "scale(1)" }],
        { duration: 420, delay: T, easing: tok("--ts-ease-emphasis"), fill: "both" },
      );
      const ring = document.createElement("div");
      ring.style.cssText = `position:absolute;left:50%;top:50%;width:230px;height:230px;margin:-115px 0 0 -115px;border-radius:56px;border:6px solid var(--ts-signal);box-shadow:0 0 0 4px var(--ts-ink)`;
      st.appendChild(ring);
      ring.animate([{ transform: "scale(1)", opacity: 0 }, { transform: "scale(1)", opacity: 1, offset: 0.01 }, { transform: "scale(2.2)", opacity: 0 }], {
        duration: 640, delay: T, easing: tok("--ts-ease-enter"), fill: "both",
      });
      document.getElementById("name").animate(
        [{ opacity: 0, transform: "translateY(24px)" }, { opacity: 1, transform: "none" }],
        { duration: 300, delay: T + 150, easing: tok("--ts-ease-enter"), fill: "both" },
      );
    },
    {
      markHtml,
      chips: [
        { text: "NASA POWER", accent: true },
        { text: "MODIS NDVI" },
        { text: "ESA Copernicus" },
        { text: "USDA" },
      ],
    },
  );
  await page.waitForTimeout((L + 0.4) * 1000);
  return { segs: [{ from: t0, to: t0 + L + 0.4 }], facts: { chips: ["NASA POWER", "MODIS NDVI", "ESA Copernicus", "USDA"] }, clicks: [] };
}

// ---------------------------------------------------------------- c. three fast full-frame cuts: what changed / what to watch / what to plant
export async function tiles(take, cfg, L) {
  const { page } = take;
  await page.goto(`${cfg.base}/fields/${cfg.fieldId}`);
  const row = page.getByText(/How this field's climate has changed/).first();
  await row.waitFor({ timeout: 45000 });
  const risksH = page.getByRole("heading", { name: "Top risks" }).first();
  await risksH.waitFor({ timeout: 45000 });
  await settle(page, 900);
  const rowSel = await take.card(row, "row", 40);
  const risks = await take.card(risksH, "risks", 200);
  const attention = must((await page.getByText(/^\d+ items? needs? attention$/).first().innerText()).trim(), "attention chip");
  const nDays = must((await page.getByRole("heading", { name: /^Next \d+ days$/ }).first().innerText()).match(/\d+/), "days")[0];
  const q = (L + 0.4) / 3;
  // beat 1: the climate row opens (three plain takeaways)
  await take.cam(rowSel, { dur: 1, fill: [0.7, 0.2], anchor: [0.5, 0.35], maxScale: 1.3 });
  const t0 = take.mark("ready");
  await take.cursorClick(row, "row", { dur: 450 });
  const clicks = [take.now()];
  await row.click();
  await page.waitForTimeout(350);
  const takeaway = must(
    (await row.evaluate((el) => {
      let n = el;
      for (let i = 0; i < 8 && n.parentElement; i++) {
        n = n.parentElement;
        if (n.innerText.includes("All metrics")) break;
      }
      return n.innerText;
    })).match(/The first autumn frost comes (\d+ days? later)/),
    "takeaway",
  )[1];
  const camA = take.cam(rowSel, { dur: 600, fill: [0.86, 0.62], anchor: [0.5, 0.45], maxScale: 1.6 });
  await take.d("say", [{ segs: [{ id: "a", text: takeaway, mono: true }, { text: "first autumn frost", small: true }], accent: true, size: px(52) }], { pos: "bl" });
  await take.d("countUp", "a", takeaway, 600);
  await camA;
  const tB = t0 + q;
  if (tB - take.now() > 0.05) await take.cam(rowSel, { dur: (tB - take.now()) * 1000, ease: "--ts-ease-enter", fill: [0.9, 0.66], anchor: [0.5, 0.45], maxScale: 1.7 });
  // beat 2: top risks and the week
  const camB = take.cam(risks, { dur: 450, fill: [0.86, 0.8], anchor: [0.5, 0.5], maxScale: 1.5 });
  await take.d("say", [{ segs: [{ text: attention }], accent: true, size: px(46) }, { segs: [{ id: "b", text: nDays, mono: true }, { text: "days ahead" }], size: px(40) }], { pos: "bl" });
  await camB;
  const tC = t0 + 2 * q;
  if (tC - take.now() > 0.05) await take.cam(risks, { dur: (tC - take.now()) * 1000, ease: "--ts-ease-enter", fill: [0.9, 0.84], anchor: [0.5, 0.5], maxScale: 1.6 });
  const tEndA = take.now();
  // beat 3: the rotation decision (a page load, cut out)
  await page.goto(`${cfg.base}/fields/${cfg.fieldId}/rotation`);
  const dec = page.getByText(/^Sow .+ in \d{4}$/).first();
  await dec.waitFor({ timeout: 45000 });
  await page.getByText(/We compared \d+ options over \d+ seasons/).first().waitFor();
  await settle(page, 900);
  const title = (await dec.innerText()).trim();
  const gain = must((await page.getByText(/\$\d+\s+per\s+ac\s+a\s+year\s+more\s+than\s+today/).first().innerText()).replace(/\s+/g, " ").match(/\$\d+ per ac a year more than today/), "gain line")[0];
  const plan = (await page.getByText(/Plan for \d{4}.\d{4}:/).first().innerText()).trim();
  const range = must(plan.match(/(\d{4}).(\d{4})/), "plan range");
  const decCard = await take.card(dec, "dec", 200);
  const opts = await take.tag(page.getByRole("button", { name: /Choose this option|Chosen/ }).first(), "optsbtn");
  await take.cam(decCard, { dur: 1, fill: [0.74, 0.6], anchor: [0.5, 0.4], maxScale: 1.3 });
  const tStart = take.mark("rotation");
  take.cam(decCard, { dur: 500, fill: [0.86, 0.66], anchor: [0.5, 0.42], maxScale: 1.55 });
  await take.d("say", [{ segs: [{ text: title }], accent: true, size: px(46) }, { segs: [{ text: gain }], size: px(36) }], { pos: "bl" });
  await page.waitForTimeout(700);
  await take.cam(null, { union: [decCard, opts], dur: Math.max(300, (q + 0.1) * 1000 - 700), ease: "--ts-ease-enter", fill: [0.9, 0.9], anchor: [0.5, 0.5], maxScale: 1.3 });
  void tEndA;
  return {
    segs: [
      { from: t0, to: tEndA },
      { from: tStart, to: tStart + q + 0.1 },
    ],
    facts: { takeaway, attention, nDays, title, gain, plan, range: range.slice(1) },
    clicks,
  };
}

// ---------------------------------------------------------------- d. proof: the missed years ringed one after another
export async function proof(take, cfg, L) {
  const { page } = take;
  await page.goto(`${cfg.base}/fields/${cfg.fieldId}/trust`);
  const head = page.getByText("The short answer", { exact: true }).first();
  await head.waitFor({ timeout: 45000 });
  await page.getByText(/r = -?[\d.]+ · mean error/).first().waitFor();
  await settle(page, 900);
  const chartCard = await take.card(page.getByText(/Model, official yield and field greenness by year/).first(), "chartcard", 200);
  await page.locator("svg").filter({ hasText: /2022/ }).first().waitFor();
  const ringText = must(
    (await page.getByText(/the model missed this year/).first().innerText()).match(/\(([\d, ]+)\)/),
    "missed years",
  )[1]
    .split(",")
    .map((s) => s.trim());
  const rings = await page.evaluate(() => {
    const svg = [...document.querySelectorAll("svg")].find((s) => /2022/.test(s.textContent) && s.querySelector("circle.stroke-urgent"));
    return [...svg.querySelectorAll("circle.stroke-urgent")]
      .sort((a, b) => a.getAttribute("cx") - b.getAttribute("cx"))
      .map((c, i) => {
        c.setAttribute("data-demo-ring", i);
        c.style.opacity = 0;
        c.style.transformBox = "fill-box";
        c.style.transformOrigin = "center";
        return i;
      });
  });
  if (rings.length !== ringText.length) throw new Error(`rings ${rings.length} vs years ${ringText.length}`);
  const body = await page.locator("main").innerText();
  const m = [...body.matchAll(/r = (-?[\d.]+) · mean error/g)].map((x) => x[1]);
  if (m.length < 2) throw new Error("two r values expected");
  await take.cam(chartCard, { dur: 1, fill: [0.74, 0.84], anchor: [0.4, 0.5], maxScale: 1.7 });
  const t0 = take.mark("ready");
  const camP = take.cam(chartCard, { dur: 900, fill: [0.84, 0.88], anchor: [0.4, 0.5], maxScale: 1.8 });
  await take.d(
    "say",
    [
      { segs: [{ text: "r", small: true }, { text: m[0], mono: true }, { text: "vs official yields", small: true }], accent: true, size: px(46) },
    ],
    { pos: "tr" },
  );
  await camP;
  const start = take.now();
  const wait = async (t) => {
    const d = t0 + t - take.now();
    if (d > 0.02) await page.waitForTimeout(d * 1000);
  };
  const clicks = [];
  for (let i = 0; i < rings.length; i++) {
    await wait(1.25 + i * 0.5);
    clicks.push(take.now());
    await page.evaluate((i) => {
      const c = document.querySelector(`[data-demo-ring="${i}"]`);
      c.style.opacity = 1;
      c.animate([{ transform: "scale(2.6)", opacity: 0 }, { transform: "scale(1)", opacity: 1 }], {
        duration: 320, easing: window.__demo.tok("--ts-ease-emphasis"),
      });
    }, i);
    await take.d("say", [{ segs: [{ text: "Missed" }, { text: ringText.slice(0, i + 1).join(" · "), mono: true }], size: px(46) }], { pos: "bl" });
  }
  const end = t0 + L + 0.4;
  const left = end - take.now();
  if (left > 0.25) await take.cam(chartCard, { dur: left * 1000, ease: "--ts-ease-enter", fill: [0.88, 0.9], anchor: [0.4, 0.5], maxScale: 1.9 });
  void start;
  return { segs: [{ from: t0, to: end }], facts: { r: m.slice(0, 2), missed: ringText }, clicks };
}

// ---------------------------------------------------------------- e. ask the assistant (one live Gemini call; recorded once)
export async function askLive(take, cfg, L) {
  const { page } = take;
  const QUESTION = "Has the climate of this field changed?";
  await page.goto(`${cfg.base}/fields/${cfg.fieldId}`);
  const askBar = page.getByText("Ask the assistant about your fields…").first();
  await askBar.waitFor({ timeout: 45000 });
  await settle(page, 900);
  await take.cam(null, { dur: 1 });
  const t0 = take.mark("ready");
  const clicks = [];
  await take.cursorClick(askBar, "askbar", { dur: 700 });
  await askBar.click();
  clicks.push(take.now());
  await page.waitForTimeout(350);
  await page.keyboard.type(QUESTION, { delay: 32 });
  await page.waitForTimeout(250);
  const tTyped = take.mark("typed");
  await page.keyboard.press("Enter");
  await page.waitForURL(/\/assistant/, { timeout: 20000 });
  const composer = page.getByRole("textbox").first();
  await composer.waitFor({ timeout: 20000 });
  await settle(page, 600);
  // a fresh chat, with the question in the composer (the palette hands it over without sending)
  const val = async () => (await composer.inputValue().catch(() => "")).trim();
  if ((await val()) !== QUESTION) throw new Error("composer does not hold the question: " + (await val()));
  const newChat = page.getByRole("button", { name: "New chat" });
  await newChat.click().catch(() => {});
  await page.waitForTimeout(500);
  if ((await val()) !== QUESTION) {
    await composer.fill("");
    await composer.pressSequentially(QUESTION, { delay: 20 });
  }
  const tReady = take.mark("composer");
  const send = page.locator("form button[type=submit], button[aria-label*='Send' i]").last();
  await take.cursorClick(send, "send", { dur: 600 });
  await send.click();
  clicks.push(take.now());
  const tSend = take.mark("sent");
  const badge = page.getByText(/\d+ numbers? checked against the models/).first();
  await badge.waitFor({ timeout: 150000 });
  await page.waitForTimeout(500);
  const tAnswer = take.mark("answered");
  const badgeText = (await badge.innerText()).trim().split("\n")[0];
  const bm = must(badgeText.match(/^(\d+)\s+(.*)$/), "badge");
  const answer = (await page.locator("main").innerText()).replace(/\s+/g, " ");
  // open the data card ("Show the numbers")
  const show = page.getByRole("button", { name: /Show the numbers|numbers? checked/ }).first();
  try {
    await take.cursorClick(show, "show", { dur: 550 });
    await show.click({ timeout: 5000 });
    clicks.push(take.now());
  } catch {
    clicks.push(take.now());
  }
  await page.waitForTimeout(500);
  const tCard = take.mark("card");
  const badgeSel = await take.tag(badge, "badge");
  take.d("pulse", badgeSel);
  await take.d("say", [{ segs: [{ id: "n", text: bm[1], mono: true }, { text: bm[2] }], accent: true, size: px(44) }], { pos: "bl" });
  await take.d("countUp", "n", bm[1], 600);
  await page.waitForTimeout(1600);
  return {
    segs: [
      { from: t0, to: tTyped + 0.3, ramp: 1.4 },
      { from: tTyped + 0.3, to: tSend + 0.15, ramp: 0.8 },
      { from: tSend + 0.15, to: tAnswer - 0.1, ramp: 0.3 },
      { from: tAnswer - 0.1, to: take.now() },
    ],
    facts: { question: QUESTION, badge: badgeText, answer: answer.slice(0, 700) },
    clicks: [clicks[0], clicks[1], clicks[2]],
  };
}
