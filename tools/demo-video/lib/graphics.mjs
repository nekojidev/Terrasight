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
  const heading = page.getByText(/The first autumn frost comes \d+ days? later/).first();
  await heading.waitFor({ timeout: 45000 });
  await settle(page, 600);
  const card = await take.card(heading, "shift", 300);
  const txt = await fieldLines(page, card);
  const i = must(
    txt.findIndex((l) => l === "First autumn frost"),
    "first frost row",
  );
  const app = { base: txt[i + 3], recent: txt[i + 5], value: txt[i + 7], trend: txt[i + 9] };
  const kicker = (await page.getByText(/FIELD SHIFT/i).first().innerText()).replace(/\s+/g, " ");
  const yr = must(kicker.match(/NASA POWER (\d{4})\D+(\d{4})/), "kicker");
  // 2. the real annual series of the field's grid cell, computed with the project's own code
  const S = await loadFrostSeries();
  const date = (doy) =>
    new Date(Date.UTC(2025, 0, Math.round(doy))).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
  const delta = Math.round(S.recent - S.baseline);
  const checks = {
    baseline: [date(S.baseline), app.base],
    recent: [date(S.recent), app.recent],
    value: [`${delta} days later`, app.value],
    trend: [S.metric.trend.significant ? "clear trend" : "no clear trend", app.trend],
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
          <div style="background:var(--ts-ink);color:var(--ts-surface);padding:var(--ts-s2) var(--ts-s5);border-radius:var(--ts-r-chip);font-size:34px;font-weight:600">${D.trend}</div>
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
      kicker,
    },
    clicks: [],
  };
}

// ---------------------------------------------------------------- b. "it reads it for you"
export async function sources(take, cfg, L) {
  const { page } = take;
  await page.goto(`${cfg.base}/fields/${cfg.fieldId}`);
  const ctxLine = page.getByText(/^Context: /).first();
  await ctxLine.waitFor({ timeout: 45000 });
  await settle(page, 500);
  const markHtml = await ctxLine.evaluate((el) => el.parentElement.parentElement.firstElementChild.outerHTML);
  const body = await page.locator("body").innerText();
  for (const need of [/NASA POWER/, /USDA/]) if (!need.test(body)) throw new Error("source name not on the field page: " + need);
  const kicker = (await page.getByText(/FIELD SHIFT/i).first().innerText()).replace(/\s+/g, " ");
  const years = must(kicker.match(/NASA POWER (\d{4}).(\d{4})/), "kicker");
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
        { text: `NASA POWER ${years[1]}–${years[2]}`, accent: true },
        { text: "MODIS NDVI" },
        { text: "ESA Copernicus" },
        { text: "USDA" },
      ],
    },
  );
  await page.waitForTimeout((L + 0.4) * 1000);
  return { segs: [{ from: t0, to: t0 + L + 0.4 }], facts: { years: years.slice(1, 3) }, clicks: [] };
}

// ---------------------------------------------------------------- c. split screen of three real screens
export async function tiles(take, cfg, L) {
  const { page } = take;
  const shot = async (sel) => `data:image/png;base64,${(await page.locator(sel).screenshot({ type: "png" })).toString("base64")}`;
  await page.goto(`${cfg.base}/fields/${cfg.fieldId}`);
  const heading = page.getByText(/The first autumn frost comes \d+ days? later/).first();
  await heading.waitFor({ timeout: 45000 });
  await settle(page, 900);
  const shift = await take.card(heading, "t1", 300);
  const risksH = page.getByRole("heading", { name: "Top risks" }).first();
  const risks = await take.card(risksH, "t2", 200);
  const shiftVal = must((await heading.innerText()).match(/comes (\d+ days? later)/), "frost days")[1];
  const nRisks = must((await page.getByText(/^Show all \d+$/).first().innerText()).match(/\d+/), "risks")[0];
  const box1 = await page.evaluate((sel) => {
    const c = document.querySelector(sel).getBoundingClientRect();
    const rows = [...document.querySelectorAll("*")].filter((e) => e.children.length === 0 && /^Trend: .* per (decade|year)$/.test(e.textContent.trim()));
    const last = rows[2].getBoundingClientRect();
    return { x: c.left, y: c.top + window.scrollY, width: c.width, height: last.bottom - c.top + 14 };
  }, shift);
  const img1 = `data:image/png;base64,${(await page.screenshot({ type: "png", clip: box1, fullPage: true })).toString("base64")}`;
  const img2 = await shot(risks);
  await page.goto(`${cfg.base}/fields/${cfg.fieldId}/rotation`);
  const oh = page.getByText(/We compared \d+ options over \d+ seasons/).first();
  await oh.waitFor({ timeout: 45000 });
  await settle(page, 900);
  const om = must((await oh.innerText()).match(/compared (\d+) options over (\d+) seasons/), "options");
  const range = must(
    (await page.getByText(/Cumulative margin.*\d{4}.\d{4}/).first().innerText()).match(/(\d{4})\D(\d{4})/),
    "range",
  );
  // the options grid: from the heading to the end of the first row of option cards
  const optsBox = await page.evaluate(() => {
    const h = [...document.querySelectorAll("*")].find((e) => e.children.length === 0 && /We compared \d+ options/.test(e.textContent));
    const btn = [...document.querySelectorAll("button")].find((b) => /Choose this option|Chosen/.test(b.textContent));
    const a = h.getBoundingClientRect(),
      b = btn.getBoundingClientRect();
    return { x: Math.max(0, a.left - 12), y: a.top + window.scrollY - 8, width: Math.min(1100, 1920 - a.left), height: b.bottom - a.top + 28 };
  });
  const img3 = `data:image/png;base64,${(await page.screenshot({ type: "png", clip: optsBox, fullPage: true })).toString("base64")}`;
  await stage(take, cfg);
  const t0 = take.mark("ready");
  await page.evaluate(
    ({ img1, img2, img3, shiftVal, nRisks, nOpt, nSeasons, range }) => {
      const st = document.getElementById("stage");
      const tok = (n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
      const tile = (img, css, label, from, delay, accent) => {
        const w = document.createElement("div");
        w.style.cssText = `position:absolute;${css};border-radius:var(--ts-r-card);`;
        w.innerHTML = `<div style="overflow:hidden;border-radius:var(--ts-r-card);border:2px solid var(--ts-line);box-shadow:var(--ts-shadow-hero);max-height:inherit"><img src="${img}" style="display:block;width:100%;transform-origin:50% 0"></div>
          <div style="position:absolute;left:0;top:0;padding:var(--ts-s2) var(--ts-s5);border-radius:var(--ts-r-chip);background:${accent ? "var(--ts-signal)" : "var(--ts-ink)"};color:${accent ? "var(--ts-on-signal)" : "var(--ts-surface)"};font-size:32px;font-weight:700;letter-spacing:-0.02em;transform:translateY(-120%)">${label}</div>`;
        st.appendChild(w);
        w.animate(
          [{ transform: `translate(${from[0]}px,${from[1]}px)`, opacity: 0 }, { transform: "none", opacity: 1 }],
          { duration: 420, delay, easing: tok("--ts-ease-enter"), fill: "both" },
        );
        w.firstElementChild.animate([{ transform: "scale(1)" }, { transform: "scale(1.06)" }], {
          duration: 4200, delay, easing: "linear", fill: "both",
        });
      };
      tile(img1, "left:96px;top:128px;width:900px", "What changed", [-700, 0], 200, true);
      tile(img2, "left:1040px;top:128px;width:784px", "What to watch today", [700, 0], 1550, false);
      tile(img3, "left:96px;top:610px;width:900px;max-height:340px", "What to plant", [0, 500], 2750, true);
      const card = document.createElement("div");
      card.style.cssText = "position:absolute;left:1040px;top:470px;width:784px;display:flex;flex-direction:column;gap:var(--ts-s4)";
      const rows = [
        [shiftVal, "first autumn frost", 650],
        [`${nRisks} risks`, "ranked for this field", 2000],
        [`${nSeasons} seasons`, `${range[1]}–${range[2]}, ${nOpt} options`, 3200],
      ];
      rows.forEach(([big, small, delay], i) => {
        const r = document.createElement("div");
        r.style.cssText = `display:flex;align-items:baseline;gap:var(--ts-s5);padding:var(--ts-s3) var(--ts-s6);border-radius:var(--ts-r-card);background:${i === 1 ? "var(--ts-ink)" : "var(--ts-signal)"};color:${i === 1 ? "var(--ts-surface)" : "var(--ts-on-signal)"};box-shadow:var(--ts-shadow-hero);width:fit-content`;
        r.innerHTML = `<span style="font-family:var(--ts-mono);font-size:58px;font-weight:700;letter-spacing:-0.04em">${big}</span><span style="font-size:28px;font-weight:500">${small}</span>`;
        if (i === 2) r.style.cssText += ";margin-top:150px";
        card.appendChild(r);
        r.animate([{ opacity: 0, transform: "translateY(22px)" }, { opacity: 1, transform: "none" }], {
          duration: 240, delay, easing: tok("--ts-ease-enter"), fill: "both",
        });
      });
      st.appendChild(card);
    },
    { img1, img2, img3, shiftVal, nRisks, nOpt: om[1], nSeasons: om[2], range }
  );
  await page.waitForTimeout((L + 0.4) * 1000);
  return { segs: [{ from: t0, to: t0 + L + 0.4 }], facts: { shiftVal, nRisks, options: om[1], seasons: om[2], range: range.slice(1) }, clicks: [] };
}

// ---------------------------------------------------------------- d. proof: the missed years ringed one after another
export async function proof(take, cfg, L) {
  const { page } = take;
  await page.goto(`${cfg.base}/fields/${cfg.fieldId}/trust`);
  const head = page.getByText(/How closely the model follows what happened/).first();
  await head.waitFor({ timeout: 45000 });
  await page.getByText(/r = -?[\d.]+, mean error/).first().waitFor();
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
  const txt = (await fieldLines(page, await take.card(head, "card", 150))).join("\n");
  const m = [...txt.matchAll(/r = (-?[\d.]+), mean error/g)].map((x) => x[1]);
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
