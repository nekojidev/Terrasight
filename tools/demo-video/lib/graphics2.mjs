// v7 shots: facts read from the pages (asserted), larger framings, no count-ups on statistics.
import { settle } from "./take.mjs";
import { loadFrostSeries } from "./series.mjs";

const must = (v, what) => {
  if (v == null || (Array.isArray(v) && !v.length)) throw new Error("Could not read from the page: " + what);
  return v;
};
const px = (n) => `${n}px`;
const NUM = px(72);
const LAB = px(30);
const lines = async (page, sel) =>
  (await page.locator(sel).innerText())
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);

const ONES = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen"];
const TENS = ["", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"];
export const words = (n) => {
  n = Number(n);
  if (!Number.isInteger(n) || n < 0 || n > 99) throw new Error("number out of range for words: " + n);
  if (n < 20) return ONES[n];
  return TENS[Math.floor(n / 10)] + (n % 10 ? "-" + ONES[n % 10] : "");
};

/** The numbers the voice and the overlays use, read from the pages and asserted. */
export async function readFacts(browser, cfg, stateFile) {
  const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 }, locale: "en-US", storageState: stateFile });
  await ctx.addCookies([{ name: "ts_locale", value: "en", url: cfg.base }]);
  const page = await ctx.newPage();
  await page.goto(`${cfg.base}/fields/${cfg.fieldId}`);
  const row = page.getByText(/How this field's climate has changed/).first();
  await row.waitFor({ timeout: 45000 });
  await settle(page, 500);
  await row.click();
  await page.waitForTimeout(500);
  const txt = await row.evaluate((el) => {
    let n = el;
    for (let i = 0; i < 8 && n.parentElement; i++) {
      n = n.parentElement;
      if (n.innerText.includes("All metrics")) break;
    }
    return n.innerText;
  });
  const days = must(txt.match(/The first autumn frost comes (\d+) days? later/), "frost days")[1];
  await page.goto(`${cfg.base}/fields/${cfg.fieldId}/rotation`);
  const g = page.getByText(/\$\d+\s+per\s+ac\s+a\s+year\s+more\s+than\s+today/).first();
  await g.waitFor({ timeout: 45000 });
  const gain = must((await g.innerText()).replace(/\s+/g, " ").match(/\$(\d+) per ac a year more than today/), "gain")[1];
  const plan = (await page.getByText(/Plan for \d{4}.\d{4}:/).first().innerText()).trim();
  const pr = must(plan.match(/(\d{4}).(\d{4})/), "plan range");
  const seasons = String(Number(pr[2]) - Number(pr[1]) + 1);
  await page.goto(`${cfg.base}/fields/${cfg.fieldId}/trust`);
  await page.getByText(/r = -?[\d.]+ · mean error/).first().waitFor({ timeout: 45000 });
  const body = await page.locator("main").innerText();
  const seasonsChecked = must(body.match(/r = -?[\d.]+ · mean error [\d.]+ points · (\d+) years/), "years checked")[1];
  const missed = must((body.match(/the model missed this year \(([\d, ]+)\)/) || [])[1], "missed years").split(",").map((s) => s.trim());
  await ctx.close();
  const S = await loadFrostSeries();
  if (S.years.length !== 45) throw new Error("expected 45 years of NASA weather");
  return { days, gain, seasons, seasonsChecked, missed, years: String(S.years.length) };
}

async function stageTitle(page, logoHtml, teamLine) {
  await page.evaluate(
    ({ logo, team }) => {
      const layer = document.getElementById("demo-layer");
      const tok = (n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
      const veil = document.createElement("div");
      veil.style.cssText =
        "position:fixed;inset:0;backdrop-filter:blur(9px);background:color-mix(in srgb, var(--ts-bg) 52%, transparent);display:flex;flex-direction:column;align-items:center;justify-content:center;gap:var(--ts-s8);font-family:var(--ts-font)";
      veil.innerHTML = `<div id="vlogo" style="transform-origin:center;pointer-events:none;margin-bottom:var(--ts-s6)">${logo}</div>
        <div id="vtag" style="padding:var(--ts-s3) var(--ts-s8);border-radius:var(--ts-r-card);background:var(--ts-signal);color:var(--ts-on-signal);box-shadow:var(--ts-shadow-hero);font-size:64px;font-weight:700;letter-spacing:-0.03em">The AI assistant for your farm</div>
        <div id="vteam" style="font-family:var(--ts-mono);font-size:30px;font-weight:600;letter-spacing:.04em;color:var(--ts-ink)">${team}</div>`;
      layer.appendChild(veil);
      document.getElementById("vlogo").animate([{ transform: "scale(1)" }, { transform: "scale(1.08)" }], { duration: 2000, easing: "linear", fill: "both" });
      document.getElementById("vtag").animate([{ transform: "translateY(18px)", opacity: 0 }, { transform: "none", opacity: 1 }], { duration: 260, delay: 80, easing: tok("--ts-ease-enter"), fill: "both" });
      document.getElementById("vteam").animate([{ opacity: 0 }, { opacity: 1 }], { duration: 260, delay: 160, easing: tok("--ts-ease-enter"), fill: "both" });
      setTimeout(() => {
        document.getElementById("vtag").animate([{ opacity: 1, transform: "none" }, { opacity: 0, transform: "translateY(-70px)" }], { duration: 300, easing: tok("--ts-ease-exit"), fill: "both" });
        document.getElementById("vteam").animate([{ opacity: 1 }, { opacity: 0 }], { duration: 300, easing: tok("--ts-ease-exit"), fill: "both" });
        veil.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 320, easing: tok("--ts-ease-exit"), fill: "both" }).finished.then(() => veil.remove());
      }, 1700);
    },
    { logo: logoHtml, team: teamLine },
  );
}

// ---------------------------------------------------------------- opening: title over the softened product, then the Today card
export async function today(take, cfg, L, ctx) {
  const { page } = take;
  await page.goto(cfg.base + "/");
  const startWith = page.getByText("Start with this", { exact: true }).first();
  await startWith.waitFor({ timeout: 45000 });
  await settle(page, 900);
  const cardSel = await take.card(startWith, "tcard", 300);
  const lns = await lines(page, cardSel);
  const action = must(lns.find((l) => /^Scout the field/.test(l)), "action sentence");
  const am = must(action.match(/^(\w+) the field[^.]*?before (\w+ \d+)/), "action parse");
  const sow = `${am[1]} the field before ${am[2]}`;
  const titleEl = await take.tag(page.getByText(/^Wheat streak mosaic virus risk/).first(), "ttitle");
  const actionEl = await take.tag(page.getByText(/^Scout the field/).first(), "taction");
  const accept = await take.tag(page.locator(cardSel).getByRole("button", { name: "Accept" }).first(), "accept");
  const chip = await take.tag(page.getByText("What should I do first today?").first(), "tchip");
  const logoHtml = await page.evaluate(() => {
    const t = [...document.querySelectorAll("*")].find((e) => e.children.length === 0 && e.textContent.trim() === "Terrasight" && e.getBoundingClientRect().width > 0);
    let n = t;
    let svg = null;
    for (let i = 0; i < 5 && n && !svg; i++, n = n.parentElement) svg = n.querySelector("svg, img");
    const mark = svg ? svg.outerHTML.replace(/<svg /, '<svg style="width:150px;height:150px" ').replace(/<img /, '<img style="width:150px;height:150px" ') : "";
    return `<div style="display:flex;align-items:center;gap:28px">${mark}<span style="font-size:150px;font-weight:700;letter-spacing:-0.05em;line-height:1;color:var(--ts-ink)">Terrasight</span></div>`;
  });
  await take.cam(cardSel, { dur: 1, fill: [0.7, 0.76], anchor: [0.5, 0.45], maxScale: 1.6 });
  await stageTitle(page, logoHtml, ctx.team);
  const t0 = take.mark("ready");
  const wait = async (t) => {
    const d = t0 + t - take.now();
    if (d > 0.02) await page.waitForTimeout(d * 1000);
  };
  take.cam(cardSel, { dur: 1900, ease: "--ts-ease-enter", fill: [0.78, 0.84], anchor: [0.5, 0.45], maxScale: 1.8 });
  await wait(2.0);
  // shot (b): tight on the card's title and its action, then down to Accept and the suggested question
  await take.cam(null, { union: [titleEl, actionEl], dur: 1, fill: [0.86, 0.3], anchor: [0.5, 0.4], maxScale: 2.1 });
  const camB = take.cam(null, { union: [titleEl, actionEl], dur: 1300, ease: "--ts-ease-enter", fill: [0.9, 0.34], anchor: [0.5, 0.4], maxScale: 2.2 });
  await take.d("say", [{ segs: [{ text: sow }], accent: true, size: NUM }], { pos: "bl" });
  setTimeout(() => void take.d("clear").catch(() => {}), 1600);
  await camB;
  await take.cam(null, { union: [accept, chip], dur: Math.max(400, (L + 0.4 - (take.now() - t0)) * 1000), ease: "--ts-ease-standard", fill: [0.7, 0.4], anchor: [0.5, 0.5], maxScale: 1.9 });
  return { segs: [{ from: t0, to: t0 + L + 0.4 }], facts: { action: sow }, clicks: [] };
}

// ---------------------------------------------------------------- climate: the takeaways fill the frame, no count-up
export async function climate(take, cfg, L, ctx) {
  const { page } = take;
  await page.goto(`${cfg.base}/fields/${cfg.fieldId}`);
  const row = page.getByText(/How this field's climate has changed/).first();
  await row.waitFor({ timeout: 45000 });
  await settle(page, 900);
  const rowSel = await take.card(row, "row", 40);
  await take.cam(rowSel, { dur: 1, fill: [0.9, 0.2], anchor: [0.5, 0.45], maxScale: 2.0 });
  const t0 = take.mark("ready");
  const wait = async (t) => {
    const d = t0 + t - take.now();
    if (d > 0.02) await page.waitForTimeout(d * 1000);
  };
  await take.cursorClick(row, "row", { dur: 450 });
  const clicks = [take.now()];
  await row.click();
  await page.waitForTimeout(200);
  const days = must(
    (await row.evaluate((el) => {
      let n = el;
      for (let i = 0; i < 8 && n.parentElement; i++) {
        n = n.parentElement;
        if (n.innerText.includes("All metrics")) break;
      }
      return n.innerText;
    })).match(/The first autumn frost comes (\d+) days? later/),
    "takeaway",
  )[1];
  if (days !== ctx.facts.days) throw new Error(`frost days ${days} differ from the spoken ${ctx.facts.days}`);
  await take.d("say", [{ segs: [{ text: `First frost: ${days} days later` }], accent: true, size: NUM }], { pos: "bl" });
  await take.cam(rowSel, { dur: 700, fill: [0.92, 0.62], anchor: [0.5, 0.44], maxScale: 2.2 });
  await take.cam(rowSel, { dur: Math.max(300, (t0 + L + 0.4 - take.now()) * 1000), ease: "--ts-ease-enter", fill: [0.96, 0.68], anchor: [0.5, 0.44], maxScale: 2.35 });
  void wait;
  return { segs: [{ from: t0, to: t0 + L + 0.4 }], facts: { days }, clicks };
}

// ---------------------------------------------------------------- rotation: the benefit, large; then a flick across the options
export async function rotation(take, cfg, L, ctx) {
  const { page } = take;
  await page.goto(`${cfg.base}/fields/${cfg.fieldId}/rotation`);
  const dec = page.getByText(/^Sow .+ in \d{4}$/).first();
  await dec.waitFor({ timeout: 45000 });
  await page.getByText(/We compared \d+ options over \d+ seasons/).first().waitFor();
  await settle(page, 900);
  const gain = must((await page.getByText(/\$\d+\s+per\s+ac\s+a\s+year\s+more\s+than\s+today/).first().innerText()).replace(/\s+/g, " ").match(/\$(\d+) per ac a year more than today/), "gain")[1];
  if (gain !== ctx.facts.gain) throw new Error(`gain ${gain} differs from the spoken ${ctx.facts.gain}`);
  const decCard = await take.card(dec, "dec", 200);
  const optsHead = await take.tag(page.getByText(/We compared \d+ options over \d+ seasons/).first(), "optshead");
  const optsBtn = await take.tag(page.getByRole("button", { name: /Choose this option|Chosen/ }).first(), "optsbtn");
  await take.cam(decCard, { dur: 1, fill: [0.9, 0.62], anchor: [0.5, 0.42], maxScale: 2.0 });
  const t0 = take.mark("ready");
  await take.d("say", [{ segs: [{ text: `+$${gain} per acre a year` }], accent: true, size: NUM }], { pos: "bl" });
  const flick = 1100;
  const hold = Math.max(300, (L + 0.4) * 1000 - flick - 150);
  await take.cam(decCard, { dur: hold, ease: "--ts-ease-enter", fill: [0.94, 0.68], anchor: [0.5, 0.42], maxScale: 2.15 });
  await take.cam(null, { union: [optsHead, optsBtn], dur: flick, fill: [0.94, 0.9], anchor: [0.5, 0.5], maxScale: 1.5 });
  return { segs: [{ from: t0, to: t0 + L + 0.4 }], facts: { gain }, clicks: [] };
}

// ---------------------------------------------------------------- the assistant (one live Gemini call)
export async function askLive(take, cfg, L, ctx) {
  const { page } = take;
  const QUESTION = "Has the climate of this field changed?";
  await page.goto(`${cfg.base}/fields/${cfg.fieldId}`);
  const askBar = page.getByText("Ask the assistant about your fields…").first();
  await askBar.waitFor({ timeout: 45000 });
  await settle(page, 900);
  await take.cam(null, { dur: 1 });
  const t0 = take.mark("ready");
  const clicks = [];
  await take.cursorClick(askBar, "askbar", { dur: 650 });
  await askBar.click();
  clicks.push(take.now());
  const dlg = page.getByRole("dialog").first();
  await dlg.waitFor({ timeout: 10000 });
  const dlgSel = await take.tag(dlg, "dlg");
  take.cam(dlgSel, { dur: 900, fill: [0.6, 0.86], anchor: [0.5, 0.5], maxScale: 1.55 });
  await page.waitForTimeout(350);
  await page.keyboard.type(QUESTION, { delay: 32 });
  await page.waitForTimeout(250);
  const tTyped = take.mark("typed");
  await page.keyboard.press("Enter");
  await page.waitForURL(/\/assistant/, { timeout: 20000 });
  const composer = page.getByRole("textbox").first();
  await composer.waitFor({ timeout: 20000 });
  await settle(page, 600);
  const val = async () => (await composer.inputValue().catch(() => "")).trim();
  if ((await val()) !== QUESTION) throw new Error("composer does not hold the question: " + (await val()));
  await page.getByRole("button", { name: "New chat" }).click().catch(() => {});
  await page.waitForTimeout(500);
  if ((await val()) !== QUESTION) {
    await composer.fill("");
    await composer.pressSequentially(QUESTION, { delay: 20 });
  }
  await page.evaluate(() => {
    const nc = [...document.querySelectorAll("button")].find((b) => b.textContent.trim() === "New chat");
    if (!nc) return;
    let col = nc.parentElement;
    while (col && col.parentElement && col.parentElement.getBoundingClientRect().width < 500) col = col.parentElement;
    if (col) col.style.visibility = "hidden";
  });
  const send = page.locator("form button[type=submit], button[aria-label*='Send' i]").last();
  await send.click();
  const tSend = take.mark("sent");
  const badge = page.getByText(/\d+ numbers? checked against the models/).first();
  await badge.waitFor({ timeout: 150000 });
  await page.waitForTimeout(500);
  // tag the answer paragraph and the question bubble
  await page.evaluate((Q) => {
    const dark = (el) => {
      const c = getComputedStyle(el).backgroundColor;
      const m = c.match(/\d+/g) || [];
      return m.length >= 3 && Number(m[0]) + Number(m[1]) + Number(m[2]) < 200 && !/rgba\(0, 0, 0, 0\)/.test(c);
    };
    const bub = [...document.querySelectorAll("*")].filter((e) => e.children.length === 0 && e.textContent.trim() === Q).map((e) => {
      let n = e;
      for (let i = 0; i < 3 && n; i++, n = n.parentElement) if (dark(n)) return n;
      return null;
    }).find(Boolean);
    if (bub) bub.setAttribute("data-demo-target", "bubble");
    const ans = [...document.querySelectorAll("p, div")].filter((e) => /NASA POWER record/.test(e.textContent) && e.textContent.length < 900 && !e.querySelector("p, div > div > div"))[0];
    if (ans) ans.setAttribute("data-demo-target", "answer");
  }, QUESTION);
  const bubble = '[data-demo-target="bubble"]';
  const answerSel = '[data-demo-target="answer"]';
  const badgeSel = await take.tag(badge, "badge");
  const tAnswer = take.mark("answered");
  const badgeText = (await badge.innerText()).trim().split("\n")[0];
  const bm = must(badgeText.match(/^(\d+)\s+(.*)$/), "badge");
  // (b) the question and the answer fill the frame
  await take.cam(null, { union: [bubble, answerSel], dur: 1, fill: [0.9, 0.6], anchor: [0.5, 0.42], maxScale: 2.1 });
  take.cam(null, { union: [bubble, answerSel], dur: 1000, ease: "--ts-ease-enter", fill: [0.92, 0.64], anchor: [0.5, 0.42], maxScale: 2.2 });
  await page.waitForTimeout(950);
  const tHi = take.mark("highlight");
  // (c) the checking: every number in the answer is marked, one after another (the text is not changed)
  const nMarked = await page.evaluate(() => {
    const root = document.querySelector('[data-demo-target="answer"]');
    if (!root) return 0;
    const tok = (n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
    const spans = [];
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);
    for (const node of nodes) {
      const text = node.textContent;
      const re = /\d[\d.,]*\d|\d/g;
      let m;
      let last = 0;
      const frag = document.createDocumentFragment();
      let any = false;
      while ((m = re.exec(text))) {
        any = true;
        frag.appendChild(document.createTextNode(text.slice(last, m.index)));
        const sp = document.createElement("span");
        sp.textContent = m[0];
        sp.style.cssText = "border-radius:6px;padding:0 3px;margin:0 -3px";
        frag.appendChild(sp);
        spans.push(sp);
        last = m.index + m[0].length;
      }
      if (any) {
        frag.appendChild(document.createTextNode(text.slice(last)));
        node.parentNode.replaceChild(frag, node);
      }
    }
    spans.forEach((sp, i) =>
      sp.animate([{ backgroundColor: "transparent" }, { backgroundColor: tok("--ts-signal") }], { duration: 160, delay: i * 130, easing: tok("--ts-ease-enter"), fill: "forwards" }),
    );
    return spans.length;
  });
  if (nMarked < 3) throw new Error("no numbers found to mark in the answer");
  await page.waitForTimeout(nMarked * 130 + 300);
  const pulse = take.d("pulse", badgeSel);
  await take.d("say", [{ segs: [{ text: `${bm[1]} numbers checked against the models` }], accent: true, size: NUM }], { pos: "bl" });
  await take.cam(null, { union: [bubble, badgeSel], dur: 500, fill: [0.9, 0.62], anchor: [0.5, 0.42], maxScale: 2.1 });
  await pulse;
  const tClick = take.mark("chip");
  // (d) the chip opens the data card: zoom on its rows
  const show = page.getByRole("button", { name: /Show the numbers|numbers? checked/ }).first();
  try {
    await take.cursorClick(show, "show", { dur: 450 });
    await show.click({ timeout: 5000 });
  } catch {
    // the answer is on screen anyway
  }
  await page.getByText("Weather grid size").first().waitFor({ timeout: 15000 });
  await page.waitForFunction(() => !/Loading the numbers/.test(document.body.innerText), null, { timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(350);
  // the whole data card (labels and values) in frame
  const cardEl = await page.evaluate(() => {
    const h = [...document.querySelectorAll("*")].find((e) => e.children.length === 0 && /HOW THE CLIMATE HERE CHANGED/i.test(e.textContent));
    let n = h;
    for (let i = 0; i < 6 && n.parentElement; i++) {
      n = n.parentElement;
      if (/All rows/.test(n.innerText)) break;
    }
    n.setAttribute("data-demo-target", "datacard");
    return true;
  });
  void cardEl;
  await take.d("clear");
  await take.cam(null, { union: [badgeSel, '[data-demo-target="datacard"]'], dur: 700, fill: [0.88, 0.8], anchor: [0.5, 0.5], maxScale: 2.0 });
  await page.waitForTimeout(1300);
  const tEnd = take.mark("end");
  void tSend;
  void ctx;
  return {
    segs: [{ from: t0, to: tEnd }],
    marks2: { tTyped, tAnswer, tHi, tClick, tEnd },
    facts: { question: QUESTION, badge: badgeText, marked: nMarked },
    clicks,
  };
}

// ---------------------------------------------------------------- proof: verdict, chart with rings, in words
export async function proof(take, cfg, L, ctx) {
  const { page } = take;
  await page.goto(`${cfg.base}/fields/${cfg.fieldId}/trust`);
  const head = page.getByText("The short answer", { exact: true }).first();
  await head.waitFor({ timeout: 45000 });
  await page.getByText(/r = -?[\d.]+ · mean error/).first().waitFor();
  await settle(page, 900);
  const verdictSel = await take.card(head, "verdict", 100);
  const chartCard = await take.card(page.getByText(/Model, official yield and field greenness by year/).first(), "chartcard", 200);
  await page.locator("svg").filter({ hasText: /2022/ }).first().waitFor();
  const body = await page.locator("main").innerText();
  const nSeasons = must(body.match(/mean error [\d.]+ points · (\d+) years/), "seasons")[1];
  const ringText = must((body.match(/the model missed this year \(([\d, ]+)\)/) || [])[1], "missed years").split(",").map((s) => s.trim());
  if (nSeasons !== ctx.facts.seasonsChecked || ringText.join() !== ctx.facts.missed.join()) throw new Error("trust numbers differ from the spoken ones");
  const rings = await page.evaluate(() => {
    const svg = [...document.querySelectorAll("svg")].find((x) => /2022/.test(x.textContent) && x.querySelector("circle.stroke-urgent"));
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
  await take.cam(verdictSel, { dur: 1, fill: [0.9, 0.62], anchor: [0.5, 0.45], maxScale: 2.3 });
  const t0 = take.mark("ready");
  const wait = async (t) => {
    const d = t0 + t - take.now();
    if (d > 0.02) await page.waitForTimeout(d * 1000);
  };
  take.cam(verdictSel, { dur: 1300, ease: "--ts-ease-enter", fill: [0.94, 0.68], anchor: [0.5, 0.45], maxScale: 2.45 });
  await take.d("say", [{ segs: [{ text: `Checked against ${nSeasons} past seasons` }], accent: true, size: NUM }], { pos: "bl" });
  await wait(1.45);
  await take.cam(chartCard, { dur: 500, fill: [0.94, 0.92], anchor: [0.5, 0.5], maxScale: 2.0 });
  const clicks = [];
  const t1 = take.now() - t0;
  for (let i = 0; i < rings.length; i++) {
    await wait(t1 + 0.15 + i * 0.25);
    clicks.push(take.now());
    await page.evaluate((i) => {
      const c = document.querySelector(`[data-demo-ring="${i}"]`);
      c.style.opacity = 1;
      c.animate([{ transform: "scale(2.6)", opacity: 0 }, { transform: "scale(1)", opacity: 1 }], { duration: 260, easing: window.__demo.tok("--ts-ease-emphasis") });
    }, i);
  }
  await take.d("say", [{ segs: [{ text: `Missed ${ringText.length}: ${ringText.join(" · ")}` }], accent: false, size: NUM }], { pos: "bl" });
  const end = t0 + L + 0.4;
  const left = end - take.now();
  if (left > 0.25) await take.cam(chartCard, { dur: left * 1000, ease: "--ts-ease-enter", fill: [0.96, 0.94], anchor: [0.5, 0.5], maxScale: 2.1 });
  return { segs: [{ from: t0, to: end }], facts: { nSeasons, missed: ringText }, clicks };
}
