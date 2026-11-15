// Orbit bookends: the app's real add-field map (Sentinel-2 cloudless basemap), driven with wheel events.
// A dry run (warmTiles) fetches every tile of the flight once; the recorded takes are served from that store, so no
// frame of the flight shows an unloaded tile.
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { ROOT, OUT as OUTDIR } from "./env.mjs";
import { settle } from "./take.mjs";

const px = (n) => `${n}px`;
const store = new Map();
const OUT_STEPS = 55; // wheel steps from the default view (zoom 12) out to the continental view
const IN_STEPS = 73; // and back in, ending 18 steps closer than the default view (about zoom 14.5)
const CX = 962; // the field sits at this screen point of the default view's zoomed-out state (cursor trick: it stays there)
const CY = 538;

async function routeTiles(ctx) {
  await ctx.route(/tiles\.maps\.eox\.at/, async (route) => {
    const url = route.request().url();
    const hit = store.get(url);
    if (hit) return route.fulfill(hit);
    try {
      const resp = await route.fetch();
      const body = await resp.body();
      const rec = { status: resp.status(), headers: resp.headers(), body };
      if (resp.status() === 200) store.set(url, rec);
      return route.fulfill(rec);
    } catch {
      return route.continue();
    }
  });
}

async function openMap(page, cfg) {
  await page.goto(cfg.base + "/fields/new");
  await settle(page, 1000);
  await page.getByText("Draw on the map", { exact: true }).first().click();
  await page.locator("canvas").first().waitFor({ timeout: 20000 });
  await page.waitForTimeout(1200);
  await page.evaluate(() => {
    const map = document.querySelector("canvas").closest(".maplibregl-map");
    map.style.cssText += ";position:fixed;left:0;top:0;width:1920px;height:1080px;z-index:50;border-radius:0";
    window.dispatchEvent(new Event("resize"));
  });
  await page.waitForTimeout(1500);
}

const wheelSteps = (page, n, dir, x, y, waitMs) =>
  page.evaluate(
    async ({ n, dir, x, y, waitMs }) => {
      const c = document.querySelector("canvas");
      for (let i = 0; i < n; i++) {
        c.dispatchEvent(new WheelEvent("wheel", { deltaY: dir * 120, clientX: x, clientY: y, bubbles: true, cancelable: true }));
        await new Promise((r) => setTimeout(r, waitMs));
      }
    },
    { n, dir, x, y, waitMs },
  );

/** One continuous eased flight in the page: `n` wheel steps over `ms`, accelerating then easing. */
const flight = (page, n, dir, ms, x, y) =>
  page.evaluate(
    ({ n, dir, ms, x, y }) =>
      new Promise((resolve) => {
        const c = document.querySelector("canvas");
        const ease = (u) => 6 * u ** 5 - 15 * u ** 4 + 10 * u ** 3;
        const t0 = performance.now();
        let fired = 0;
        const tick = (now) => {
          const u = Math.min(1, (now - t0) / ms);
          const target = Math.round(n * ease(u));
          while (fired < target) {
            c.dispatchEvent(new WheelEvent("wheel", { deltaY: dir * 120, clientX: x, clientY: y, bubbles: true, cancelable: true }));
            fired++;
          }
          if (u < 1) requestAnimationFrame(tick);
          else resolve();
        };
        requestAnimationFrame(tick);
      }),
    { n, dir, ms, x, y },
  );

/** Dry run: loads every tile of the descent (and so of the ascent) once. */
export async function warmTiles(browser, cfg, stateFile) {
  const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 }, locale: "en-US", storageState: stateFile, colorScheme: "light" });
  await ctx.addCookies([{ name: "ts_locale", value: "en", url: cfg.base }]);
  await routeTiles(ctx);
  const page = await ctx.newPage();
  await openMap(page, cfg);
  await wheelSteps(page, OUT_STEPS, +1, 960, 540, 140);
  await page.waitForTimeout(2500);
  // the way in, slowly: every integer zoom level is requested and loaded
  await wheelSteps(page, IN_STEPS, -1, CX, CY, 260);
  await page.waitForTimeout(3000);
  await ctx.close();
  return store.size;
}

const attribution = (page) =>
  page.evaluate(() => (document.querySelector(".maplibregl-ctrl-attrib-inner")?.textContent ?? "").replace(/\s+/g, " ").trim());

// The MapLibre instance of the add-field map, found through the React fiber of its container.
async function getMap(page) {
  const ok = await page.evaluate(() => {
    const el = document.querySelector(".maplibregl-map");
    const key = Object.keys(el).find((k) => k.startsWith("__reactFiber$"));
    let f = el[key];
    let found = null;
    let hops = 0;
    while (f && !found && hops < 40) {
      let st = f.memoizedState;
      let n = 0;
      while (st && n < 30) {
        const c = st.memoizedState && st.memoizedState.current;
        if (c && typeof c.flyTo === "function" && typeof c.getZoom === "function") {
          found = c;
          break;
        }
        st = st.next;
        n++;
      }
      f = f.return;
      hops++;
    }
    window.__map = found;
    return !!found;
  });
  if (!ok) throw new Error("map instance not reachable");
}

const FIELD = JSON.parse(fs.readFileSync(path.join(ROOT, "data/presentation/fields/north-quarter.geojson"), "utf8"));
const RING = FIELD.geometry.coordinates[0][0];
const CENTRE = (() => {
  const xs = RING.map((c) => c[0]);
  const ys = RING.map((c) => c[1]);
  return [(Math.min(...xs) + Math.max(...xs)) / 2, (Math.min(...ys) + Math.max(...ys)) / 2];
})();
const ZOOM_FAR = 3.0;
const ZOOM_NEAR = 13.5;
const START = [-97.5, 39.5];
const ease = (u) => (u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2); // accelerate, then ease
const lerp = (a, b, u) => a + (b - a) * u;

async function frameAt(page, state, file) {
  await page.evaluate(
    (st) =>
      new Promise((resolve) => {
        const map = window.__map;
        const done = () => resolve();
        const to = setTimeout(done, 3000);
        map.once("idle", () => {
          clearTimeout(to);
          done();
        });
        map.jumpTo({ center: st.center, zoom: st.zoom });
        if (st.ring) {
          const k = st.ring;
          const coords = window.__ring;
          const feats =
            k >= coords.length
              ? [{ type: "Feature", properties: {}, geometry: { type: "Polygon", coordinates: [coords] } }]
              : [
                  { type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: coords.slice(0, Math.max(2, k)) } },
                ];
          map.getSource("field")?.setData({ type: "FeatureCollection", features: feats });
        } else map.getSource("field")?.setData({ type: "FeatureCollection", features: [] });
        for (const [id, o] of Object.entries(st.overlay || {})) {
          const e = document.getElementById(id);
          if (e) {
            e.style.opacity = o.opacity;
            e.style.transform = o.transform || "none";
          }
        }
        map.triggerRepaint();
      }),
    state,
  );
  await page.waitForTimeout(40);
  await page.screenshot({ path: file, type: "png", scale: "css" });
}

function encode(dir, out, fps = 30) {
  execFileSync("/opt/homebrew/bin/ffmpeg", ["-y", "-v", "error", "-framerate", String(fps), "-i", path.join(dir, "%04d.png"), "-c:v", "libx264", "-crf", "14", "-pix_fmt", "yuv420p", out]);
}

const TITLE_HTML = (team) => `<div id="ot1" style="padding:var(--ts-s2) var(--ts-s8);border-radius:var(--ts-r-card);background:var(--ts-ink);color:var(--ts-surface);box-shadow:var(--ts-shadow-hero);font-size:120px;font-weight:700;letter-spacing:-0.045em;line-height:1.08;opacity:0">Terrasight</div>
  <div id="ot2" style="padding:var(--ts-s3) var(--ts-s6);border-radius:var(--ts-r-card);background:var(--ts-signal);color:var(--ts-on-signal);box-shadow:var(--ts-shadow-hero);font-size:56px;font-weight:700;letter-spacing:-0.03em;opacity:0">The AI assistant for your farm</div>
  <div id="ot3" style="padding:var(--ts-s2) var(--ts-s5);border-radius:var(--ts-r-chip);background:var(--ts-surface);color:var(--ts-ink);box-shadow:var(--ts-shadow-hero);font-family:var(--ts-mono);font-size:28px;font-weight:600;opacity:0">${team}</div>`;

// ---------------------------------------------------------------- the descent: orbit to the field (stop-motion: every frame fully loaded)
export async function orbitDown(take, cfg, L, ctx) {
  const { page } = take;
  await routeTiles(take.ctx);
  await openMap(page, cfg);
  await getMap(page);
  const credit = await attribution(page);
  if (!/Sentinel-2/.test(credit)) throw new Error("basemap attribution not found: " + credit);
  const areaFact = JSON.parse(fs.readFileSync(path.join(OUTDIR, "takes/addField.json"), "utf8")).facts.area;
  await page.evaluate(
    ({ ring, title, area }) => {
      window.__ring = ring;
      const layer = document.getElementById("demo-layer");
      const el = document.createElement("div");
      el.style.cssText = "position:absolute;left:96px;top:58px;display:flex;flex-direction:column;gap:var(--ts-s3);align-items:flex-start;font-family:var(--ts-font)";
      el.innerHTML = title;
      layer.appendChild(el);
      const ar = document.createElement("div");
      ar.id = "oarea";
      ar.textContent = area;
      ar.style.cssText = "position:absolute;right:96px;bottom:132px;padding:var(--ts-s3) var(--ts-s6);border-radius:var(--ts-r-card);background:var(--ts-signal);color:var(--ts-on-signal);box-shadow:var(--ts-shadow-hero);font-family:var(--ts-mono);font-size:72px;font-weight:700;letter-spacing:-0.03em;opacity:0";
      layer.appendChild(ar);
      document.querySelector(".maplibregl-map").style.cursor = "default";
    },
    { ring: RING, title: TITLE_HTML(ctx.team), area: areaFact },
  );
  const FPS = 30;
  const total = Math.round((L + 0.4) * FPS);
  const flightEnd = Math.round(total * 0.74);
  const drawEnd = Math.round(total * 0.92);
  const dir = path.join(OUTDIR, "orbit-down");
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  const pop = (f, f0, f1) => Math.max(0, Math.min(1, (f - f0) / (f1 - f0)));
  for (let f = 0; f < total; f++) {
    const u = Math.min(1, f / flightEnd);
    const e = ease(u);
    // the point under the field stays on its way in: the centre eases from the continent to the field
    const centre = [lerp(START[0], CENTRE[0], Math.min(1, e * 1.15)), lerp(START[1], CENTRE[1], Math.min(1, e * 1.15))];
    const zoom = lerp(ZOOM_FAR, ZOOM_NEAR, e);
    const ring = f > flightEnd ? Math.round(2 + (RING.length - 2) * pop(f, flightEnd, drawEnd)) + (f >= drawEnd ? 1 : 0) : 0;
    const t = f / FPS;
    const fade = pop(f, flightEnd - 6, flightEnd + 8); // the title lifts away as the camera lands
    const overlay = {
      ot1: { opacity: pop(t, 0.05, 0.3) * (1 - fade), transform: `translateY(${(1 - pop(t, 0.05, 0.3)) * 26 - fade * 60}px)` },
      ot2: { opacity: pop(t, 0.2, 0.45) * (1 - fade), transform: `translateY(${(1 - pop(t, 0.2, 0.45)) * 26 - fade * 60}px)` },
      ot3: { opacity: pop(t, 0.35, 0.6) * (1 - fade), transform: `translateY(${(1 - pop(t, 0.35, 0.6)) * 26 - fade * 60}px)` },
      oarea: { opacity: pop(f, drawEnd, drawEnd + 6), transform: "none" },
    };
    await frameAt(page, { center: centre, zoom, ring, overlay }, path.join(dir, String(f + 1).padStart(4, "0") + ".png"));
  }
  const file = path.join(OUTDIR, "orbit-down.mp4");
  encode(dir, file, FPS);
  return { file, segs: [{ from: 0, to: total / FPS }], facts: { credit, area: areaFact }, clicks: [] };
}

// ---------------------------------------------------------------- the ascent under the end card
export async function endOrbit(take, cfg, L, ctx) {
  const { page } = take;
  await routeTiles(take.ctx);
  await openMap(page, cfg);
  await getMap(page);
  const credit = await attribution(page);
  if (!/Sentinel-2/.test(credit)) throw new Error("basemap attribution not found: " + credit);
  let team = "";
  try {
    const t = JSON.parse(fs.readFileSync(path.join(ROOT, "tools/demo-deck/team.json"), "utf8")).teamName;
    if (t && !/TEAM NAME|PLACEHOLDER/i.test(t)) team = t;
  } catch {
    // no team file
  }
  const footer = "NASA Space Apps 2026 · Field Shift" + (team ? " · Team " + team : "");
  await page.evaluate(
    ({ footer, credit }) => {
      const layer = document.getElementById("demo-layer");
      const scrim = document.createElement("div");
      scrim.id = "escrim";
      scrim.style.cssText = "position:absolute;inset:0;opacity:0;background:radial-gradient(ellipse at center, color-mix(in srgb, var(--ts-bg) 93%, transparent) 30%, color-mix(in srgb, var(--ts-bg) 64%, transparent) 100%)";
      layer.appendChild(scrim);
      const card = document.createElement("div");
      card.style.cssText = "position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:var(--ts-s5);font-family:var(--ts-font);text-align:center;color:var(--ts-ink)";
      const row = (id, html, css = "") => `<div id="${id}" style="opacity:0;${css}">${html}</div>`;
      card.innerHTML =
        row("e1", `<span style="font-size:150px;font-weight:700;letter-spacing:-0.05em;line-height:1">Terrasight</span>`) +
        row("e2", "The AI assistant for your farm", "font-size:72px;line-height:1.05;font-weight:700;letter-spacing:-0.035em") +
        row("e3", "NASA POWER · MODIS NDVI", "font-family:var(--ts-mono);font-size:38px;font-weight:600;background:var(--ts-signal);color:var(--ts-on-signal);padding:var(--ts-s3) var(--ts-s6);border-radius:var(--ts-r-chip)") +
        row("e4", "github.com/nekojidev/Terrasight", "font-family:var(--ts-mono);font-size:34px;font-weight:600") +
        row("e5", "ESA Copernicus Sentinel-2 · USDA", "font-family:var(--ts-mono);font-size:24px;color:var(--ts-ink-2)") +
        row("e6", footer, "font-family:var(--ts-mono);font-size:34px;font-weight:600;letter-spacing:.02em;margin-top:var(--ts-s3)") +
        row("e7", "Narration: AI-generated voices", "font-family:var(--ts-mono);font-size:22px;color:var(--ts-ink-2)") +
        row("e8", "Imagery: " + credit.replace(/^.*?Sentinel-2/, "Sentinel-2"), "font-family:var(--ts-mono);font-size:20px;color:var(--ts-ink-2);max-width:1500px");
      layer.appendChild(card);
      const hide = document.querySelector(".maplibregl-ctrl-attrib");
      if (hide) hide.style.display = "none";
    },
    { footer, credit },
  );
  const FPS = 30;
  const total = Math.round((L + 0.4) * FPS);
  const flightEnd = Math.round(total * 0.8);
  const dir = path.join(OUTDIR, "orbit-up");
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  const pop = (f, f0, f1) => Math.max(0, Math.min(1, (f - f0) / (f1 - f0)));
  for (let f = 0; f < total; f++) {
    const u = Math.min(1, f / flightEnd);
    const e = ease(u * 0.9 + 0.0) * 1; // the reverse of the descent, a little shorter
    const zoom = lerp(ZOOM_NEAR, ZOOM_FAR + 1.2, e);
    const centre = [lerp(CENTRE[0], START[0], Math.min(1, e * 1.1)), lerp(CENTRE[1], START[1], Math.min(1, e * 1.1))];
    const t = f / FPS;
    const overlay = { escrim: { opacity: pop(t, 0.0, 0.6), transform: "none" } };
    for (let i = 1; i <= 8; i++) {
      const o = pop(t, 0.12 + i * 0.07, 0.34 + i * 0.07);
      overlay["e" + i] = { opacity: o, transform: `translateY(${(1 - o) * 26}px)` };
    }
    await frameAt(page, { center: centre, zoom, ring: 0, overlay }, path.join(dir, String(f + 1).padStart(4, "0") + ".png"));
  }
  const file = path.join(OUTDIR, "orbit-up.mp4");
  encode(dir, file, FPS);
  return { file, segs: [{ from: 0, to: total / FPS }], facts: { credit }, clicks: [] };
}
