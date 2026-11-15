// Screenshots + live numbers from the running app (English UI, light theme, DSF 2). Credentials are only used to sign in; never printed.
import fs from "node:fs";
import path from "node:path";
import { chromium } from "../demo-video/node_modules/playwright/index.mjs";
import { loadConfig } from "../demo-video/lib/env.mjs";
import { signIn, settle } from "../demo-video/lib/take.mjs";

const TZ = "America/Chicago";
const CLOCK = "2026-11-15T07:40:00-06:00";

const must = (v, what) => {
  if (v === null || v === undefined || (Array.isArray(v) && !v.length)) throw new Error("not found on the page: " + what);
  return v;
};
const grab = (text, re, what) => must(text.match(re), what);

/** nearest boxed ancestor (border or shadow) at least minH tall, tagged so Playwright can screenshot it */
async function cardOf(page, locator, id, minH = 0) {
  await locator.first().evaluate(
    (el, [i, h]) => {
      let n = el;
      for (let k = 0; k < 14 && n.parentElement; k++) {
        n = n.parentElement;
        const cs = getComputedStyle(n);
        const boxed = parseFloat(cs.borderTopWidth) > 0 || cs.boxShadow !== "none";
        if (boxed && n.getBoundingClientRect().height >= h) break;
      }
      document.querySelectorAll(`[data-deck="${i}"]`).forEach((e) => e.removeAttribute("data-deck"));
      n.setAttribute("data-deck", i);
    },
    [id, minH],
  );
  return page.locator(`[data-deck="${id}"]`);
}

export async function capture({ outDir, base, seedFields }) {
  const cfg = loadConfig();
  const shots = path.join(outDir, "shots");
  fs.mkdirSync(shots, { recursive: true });
  const browser = await chromium.launch({ args: ["--hide-scrollbars", "--force-color-profile=srgb"] });
  const N = {}; // live numbers, copied from the pages
  try {
    const agro = await signIn(browser, cfg, "agronomist");
    const owner = await signIn(browser, cfg, "owner");
    const mk = async (state, viewport, mobile = false) => {
      const ctx = await browser.newContext({
        viewport,
        deviceScaleFactor: 2,
        locale: "en-US",
        timezoneId: TZ,
        colorScheme: "light",
        storageState: state,
        isMobile: mobile,
        hasTouch: mobile,
      });
      await ctx.addCookies([{ name: "ts_locale", value: "en", url: cfg.base }]);
      const page = await ctx.newPage();
      await page.clock.setFixedTime(CLOCK);
      return { ctx, page };
    };
    const shot = async (loc, name, opts = {}) => {
      await loc.scrollIntoViewIfNeeded();
      await loc.screenshot({ path: path.join(shots, name + ".png"), animations: "disabled", ...opts });
    };

    // ---------- /explore: public page, the map with the real field outline + the climate-shift panel
    {
      const { ctx, page } = await mk(undefined, { width: 1500, height: 1000 });
      await page.goto(cfg.base + "/explore");
      const chip = page.locator("button.maplibregl-marker", { hasText: "Pivot 14" });
      await chip.waitFor();
      await page.locator("canvas").first().waitFor();
      await settle(page, 2500);
      await chip.click();
      const headline = page.getByText(/first autumn frost comes \d+ days? later/i).first();
      await headline.waitFor({ timeout: 60000 });
      await settle(page, 3500);
      const mapBox = page.locator("canvas").first().locator("xpath=ancestor::div[2]");
      await shot(mapBox, "explore-map");
      const panel = await cardOf(page, headline, "panel", 200);
      N.explorePanel = await panel.innerText();
      await shot(panel, "explore-panel");
      N.exploreIntro = await page.getByText(/since \d{4}, from NASA POWER/).first().innerText();
      // wordmark exactly as the app renders it
      await ctx.close();
      const big = await browser.newContext({ viewport: { width: 1500, height: 1000 }, deviceScaleFactor: 5, locale: "en-US", colorScheme: "light" });
      await big.addCookies([{ name: "ts_locale", value: "en", url: cfg.base }]);
      const lp = await big.newPage();
      await lp.goto(cfg.base + "/explore");
      const logo = lp.locator("header > span").first();
      await logo.waitFor();
      await settle(lp, 800);
      await shot(logo, "wordmark", {});
      await big.close();
    }

    // ---------- Pivot 14 field page: climate-shift block + the daily headline
    {
      const { ctx, page } = await mk(agro, { width: 1440, height: 1000 });
      await page.goto(cfg.base + "/fields/" + seedFields["pivot-14"].id);
      const kick = page.getByText(/field shift\s*·\s*NASA POWER/i).first();
      await kick.waitFor({ timeout: 60000 });
      await settle(page, 1500);
      const blk = await cardOf(page, kick, "shift", 200);
      N.pivot14Shift = await blk.innerText();
      await shot(blk, "p14-shift");
      const hero = await cardOf(page, page.getByText(/the main thing on this field/i).first(), "hero", 200);
      N.pivot14Hero = await hero.innerText();
      await shot(hero, "p14-hero");
      await ctx.close();
    }

    // ---------- Home: Today with the stress-test card
    {
      const { ctx, page } = await mk(agro, { width: 1440, height: 1000 });
      await page.goto(cfg.base + "/");
      const line = page.getByText(/puts \$[\d,]+ less at risk/).first();
      await line.waitFor({ timeout: 60000 });
      await settle(page, 1500);
      const card = await cardOf(page, line, "stress", 200);
      N.stress = await card.innerText();
      await shot(card, "stress");
      const start = page.getByText(/^Start with this$/i).first();
      if (await start.count()) {
        const c2 = await cardOf(page, start, "brief", 150);
        N.brief = await c2.innerText();
        await shot(c2, "home-brief");
      }
      await ctx.close();
    }

    // ---------- North quarter (dryland): rotation page and trust page
    {
      const { ctx, page } = await mk(agro, { width: 1440, height: 1000 });
      await page.goto(cfg.base + "/fields/" + cfg.fieldId + "/rotation");
      const tested = page.getByText(/Tested on \d+ weather paths and \d+ price scenarios/).first();
      await tested.waitFor({ timeout: 60000 });
      await page.getByText(/What the field earns over/).first().waitFor({ timeout: 60000 });
      await page.locator("svg").filter({ hasText: /2030/ }).first().waitFor({ timeout: 60000 });
      await settle(page, 2000);
      const rec = await cardOf(page, tested, "rec", 150);
      N.rec = await rec.innerText();
      await shot(rec, "nq-rec");
      const chart = await cardOf(page, page.getByText(/What the field earns over/).first(), "chart", 250);
      N.chart = await chart.innerText();
      await shot(chart, "nq-chart");
      const sens = await cardOf(page, page.getByText(/Sensitivity to the weather years/).first(), "sens", 200);
      N.sens = await sens.innerText();
      await shot(sens, "nq-sens");
      N.rotationPage = await page.evaluate(() => document.body.innerText);

      await page.goto(cfg.base + "/fields/" + cfg.fieldId + "/trust");
      const head = page.getByText(/How closely the model follows what happened/).first();
      await head.waitFor({ timeout: 60000 });
      await page.getByText(/Years the model missed/).first().waitFor({ timeout: 60000 });
      await page.locator("svg").filter({ hasText: /2022/ }).first().waitFor({ timeout: 60000 });
      await settle(page, 2000);
      const fit = await cardOf(page, head, "fit", 150);
      N.fit = await fit.innerText();
      await shot(fit, "trust-fit");
      const chartCard = await cardOf(page, page.getByText(/Model, official yield and field greenness by year/).first(), "tchart", 250);
      N.tchart = await chartCard.innerText();
      await shot(chartCard, "trust-chart");
      const missed = await cardOf(page, page.getByText(/^Years the model missed$/).first(), "missed", 150);
      N.missed = await missed.innerText();
      await shot(missed, "trust-missed");
      N.trustPage = await page.evaluate(() => document.body.innerText);
      const c22 = await cardOf(page, page.getByText(/the record drought/).first(), "c22", 150);
      N.case2022 = await c22.innerText();
      await shot(c22, "trust-2022");
      await ctx.close();
    }

    // ---------- Pivot 14 trust page: what it says on an irrigated field
    {
      const { ctx, page } = await mk(agro, { width: 1440, height: 1000 });
      await page.goto(cfg.base + "/fields/" + seedFields["pivot-14"].id + "/trust");
      await page.getByText(/How far can you trust this/).first().waitFor({ timeout: 60000 });
      await settle(page, 2500);
      N.irrigatedTrust = await page.evaluate(() => document.body.innerText);
      await ctx.close();
    }

    // ---------- Owner on a phone: Decisions, one tap (not tapped here)
    {
      const { ctx, page } = await mk(owner, { width: 390, height: 844 }, true);
      await page.goto(cfg.base + "/decisions");
      await page.getByRole("button", { name: "Approve", exact: true }).first().waitFor({ timeout: 30000 });
      await settle(page, 1200);
      await page.screenshot({ path: path.join(shots, "owner-phone.png"), animations: "disabled" });
      N.ownerPage = await page.evaluate(() => document.body.innerText);
      await ctx.close();
    }
  } finally {
    await browser.close();
  }
  void grab;
  return N;
}
