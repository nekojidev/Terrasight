// Level 2: a kinetic number (large type on a lime marker, small label under it) as a transparent PNG sequence,
// rendered frame by frame from design/tokens.css in the app's own page. It pops in final form (no counting).
import fs from "node:fs";
import path from "node:path";

export const KFRAMES = 42; // 1.4 s at 30 fps

export async function renderKinetic(browser, cfg, spec, dir) {
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 }, locale: "en-US" });
  const page = await ctx.newPage();
  await page.goto(cfg.base + "/explore");
  await page.locator("header > span").first().waitFor();
  await page.evaluate(({ big, label }) => {
    document.documentElement.style.background = "transparent";
    document.body.style.background = "transparent";
    [...document.body.children].forEach((c) => (c.style.display = "none"));
    const k = document.createElement("div");
    k.id = "k";
    k.style.cssText = `position:fixed;left:96px;bottom:132px;padding:var(--ts-s4) var(--ts-s8) var(--ts-s4);border-radius:var(--ts-r-card);background:color-mix(in srgb, var(--ts-surface) 93%, transparent);box-shadow:var(--ts-shadow-hero);font-family:var(--ts-font);display:flex;flex-direction:column;gap:var(--ts-s2);transform-origin:0 100%;opacity:0`;
    k.innerHTML = `<div style="position:relative;display:inline-block;align-self:flex-start"><i id="mk" style="position:absolute;left:-10px;right:-10px;bottom:14px;height:44%;background:var(--ts-signal);border-radius:8px;transform-origin:0 50%"></i><span style="position:relative;font-family:var(--ts-mono);font-size:120px;font-weight:700;letter-spacing:-0.05em;line-height:1.08;color:var(--ts-ink);white-space:nowrap">${big}</span></div>
      <div style="font-size:32px;font-weight:600;letter-spacing:-0.01em;color:var(--ts-ink-2)">${label}</div>`;
    document.body.appendChild(k);
  }, spec);
  await page.waitForTimeout(300);
  const ease = (u) => 1 - Math.pow(1 - u, 3);
  for (let f = 0; f < KFRAMES; f++) {
    const tin = Math.min(1, f / 9);
    const tout = Math.max(0, (f - (KFRAMES - 7)) / 6);
    // pop with a small overshoot
    const s = f < 9 ? 0.72 + 0.34 * ease(tin) : f < 13 ? 1.06 - 0.06 * ((f - 9) / 4) : 1;
    const o = Math.min(1, f / 4) * (1 - tout);
    const mk = Math.min(1, Math.max(0, (f - 2) / 8));
    await page.evaluate(
      ({ s, o, mk, ty }) => {
        const k = document.getElementById("k");
        k.style.opacity = o;
        k.style.transform = `translateY(${ty}px) scale(${s})`;
        document.getElementById("mk").style.transform = `scaleX(${mk})`;
      },
      { s, o, mk, ty: tout * 14 },
    );
    await page.screenshot({ path: path.join(dir, String(f + 1).padStart(3, "0") + ".png"), omitBackground: true, type: "png" });
  }
  await ctx.close();
}
