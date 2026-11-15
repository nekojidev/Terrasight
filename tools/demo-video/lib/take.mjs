// One Playwright take = one recorded browser context with the motion layer injected.
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";
import { OUT } from "./env.mjs";

const MOTION = fs.readFileSync(path.join(import.meta.dirname, "motion.js"), "utf8");
const TZ = "America/Chicago";
// Fixed morning on the seed date so "Good morning" and dates are stable.
const CLOCK = "2026-11-15T07:40:00-06:00";

export async function launch() {
  return chromium.launch({ args: ["--hide-scrollbars", "--force-color-profile=srgb"] });
}

export async function signIn(browser, cfg, role) {
  const dir = path.join(OUT, "state");
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${role}.json`);
  const ctx = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    locale: "en-US",
    timezoneId: TZ,
  });
  await ctx.addCookies([{ name: "ts_locale", value: "en", url: cfg.base }]);
  const p = await ctx.newPage();
  await p.goto(cfg.base + "/login");
  await p.getByLabel(/e-?mail/i).fill(cfg[role].email);
  await p
    .getByLabel(/password/i)
    .first()
    .fill(cfg[role].password);
  await p.getByRole("button", { name: "Sign in", exact: true }).click();
  await p.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 30000 });
  await ctx.storageState({ path: file });
  await ctx.close();
  return file;
}

export class Take {
  constructor(page, ctx, name, base) {
    this.page = page;
    this.ctx = ctx;
    this.name = name;
    this.base = base;
    this.t0 = Date.now();
    this.marks = {};
  }
  now() {
    return (Date.now() - this.t0) / 1000;
  }
  mark(k) {
    this.marks[k] = this.now();
    return this.marks[k];
  }
  // run a function of window.__demo inside the page
  d(fn, ...args) {
    return this.page.evaluate(([f, a]) => window.__demo[f](...a), [fn, args]);
  }
  async tag(locator, id) {
    await locator.first().evaluate((el, i) => {
      document
        .querySelectorAll(`[data-demo-target="${i}"]`)
        .forEach((e) => e.removeAttribute("data-demo-target"));
      el.setAttribute("data-demo-target", i);
    }, id);
    return `[data-demo-target="${id}"]`;
  }
  // nearest ancestor that looks like a card (border or shadow) and is at least minH tall
  async card(locator, id, minH = 0) {
    await locator.first().evaluate(
      (el, [i, h]) => {
        let n = el;
        for (let k = 0; k < 12 && n.parentElement; k++) {
          n = n.parentElement;
          const cs = getComputedStyle(n);
          const boxed = parseFloat(cs.borderTopWidth) > 0 || cs.boxShadow !== "none";
          if (boxed && n.getBoundingClientRect().height >= h) break;
        }
        document
          .querySelectorAll(`[data-demo-target="${i}"]`)
          .forEach((e) => e.removeAttribute("data-demo-target"));
        n.setAttribute("data-demo-target", i);
      },
      [id, minH],
    );
    return `[data-demo-target="${id}"]`;
  }
  cam(sel, o = {}) {
    return this.d("camTo", sel, o);
  }
  async cursorClick(locator, id, o = {}) {
    const sel = await this.tag(locator, id);
    await this.d("cursorTo", sel, o);
    await this.d("ripple").catch(() => {});
  }
  async finish() {
    const video = this.page.video();
    await this.ctx.close();
    return { file: await video.path(), marks: this.marks };
  }
}

export async function newTake(browser, cfg, name, { role, phone = false, stateFile }) {
  const viewport = phone ? { width: 390, height: 844 } : { width: 1920, height: 1080 };
  const size = viewport;
  const dir = path.join(OUT, "raw", name);
  fs.rmSync(dir, { recursive: true, force: true });
  const ctx = await browser.newContext({
    viewport,
    deviceScaleFactor: 2,
    locale: "en-US",
    timezoneId: TZ,
    colorScheme: "light",
    storageState: stateFile,
    recordVideo: { dir, size },
    isMobile: phone,
    hasTouch: phone,
  });
  await ctx.addCookies([{ name: "ts_locale", value: "en", url: cfg.base }]);
  await ctx.addInitScript(MOTION);
  const page = await ctx.newPage();
  const take = new Take(page, ctx, name, cfg.base);
  await page.clock.setFixedTime(CLOCK);
  return take;
}

// real content is on screen: network quiet and no busy/skeleton markers
export async function settle(page, extraMs = 600) {
  await page.waitForLoadState("networkidle", { timeout: 30000 }).catch(() => {});
  await page
    .waitForFunction(
      () => !document.querySelector('[aria-busy="true"],[class*="skeleton" i],[data-skeleton]'),
      null,
      { timeout: 30000 },
    )
    .catch(() => {});
  await page.waitForTimeout(extraMs);
}
