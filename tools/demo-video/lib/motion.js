// Injected into every page at record time (addInitScript). Everything visual comes from the
// design tokens (design/tokens.css custom properties, read from the page's computed style).
(() => {
  if (window.__demo) return;
  const root = () => document.documentElement;
  const tok = (n) => getComputedStyle(root()).getPropertyValue(n).trim();
  const ms = (n) => parseFloat(tok(n));
  const bezier = (name) => {
    const m = tok(name).match(/cubic-bezier\(([^)]+)\)/);
    const [x1, y1, x2, y2] = m[1].split(",").map(Number);
    const cx = 3 * x1,
      bx = 3 * (x2 - x1) - cx,
      ax = 1 - cx - bx;
    const cy = 3 * y1,
      by = 3 * (y2 - y1) - cy,
      ay = 1 - cy - by;
    const X = (t) => ((ax * t + bx) * t + cx) * t;
    const Y = (t) => ((ay * t + by) * t + cy) * t;
    return (x) => {
      if (x <= 0) return 0;
      if (x >= 1) return 1;
      let t = x;
      for (let i = 0; i < 14; i++) {
        const e = X(t) - x;
        const d = (3 * ax * t + 2 * bx) * t + cx;
        if (Math.abs(e) < 1e-5 || Math.abs(d) < 1e-6) break;
        t -= e / d;
      }
      return Y(t);
    };
  };
  const frame = () => new Promise((r) => requestAnimationFrame(r));
  async function tween(durMs, ease, fn) {
    const t0 = performance.now();
    for (;;) {
      const k = Math.min(1, (performance.now() - t0) / durMs);
      fn(ease(k), k);
      if (k >= 1) return;
      await frame();
    }
  }
  // the camera owns the viewport: app-driven scrolling is ignored unless the phone take unlocks it
  const nativeScrollTo = window.scrollTo.bind(window);
  const lock = { on: true };
  window.scrollTo = (...a) => (lock.on ? undefined : nativeScrollTo(...a));
  window.scrollBy = () => undefined;
  Element.prototype.scrollIntoView = () => undefined;
  const W = () => window.innerWidth;
  const H = () => window.innerHeight;

  // ---- layer, cursor, hiding noise
  const style = document.createElement("style");
  style.textContent = `
    html{overflow:hidden!important}
    ::-webkit-scrollbar{display:none!important}
    nextjs-portal,[data-nextjs-toast],[data-nextjs-dev-tools-button],#__next-build-watcher{display:none!important}
    #demo-layer{position:fixed;inset:0;pointer-events:none;z-index:2147483000}
    #demo-cursor{position:fixed;left:0;top:0;width:34px;height:34px;pointer-events:none;z-index:2147483600;will-change:transform;opacity:0}
  `;
  const layer = document.createElement("div");
  layer.id = "demo-layer";
  const cursor = document.createElement("div");
  cursor.id = "demo-cursor";
  cursor.innerHTML = `<svg viewBox="0 0 24 24" width="34" height="34"><path d="M4 2l15 9-6.5 1.6L9.6 19z" fill="var(--ts-ink)" stroke="var(--ts-surface)" stroke-width="1.6" stroke-linejoin="round"/></svg>`;
  const mount = () => {
    root().appendChild(style);
    root().appendChild(layer);
    root().appendChild(cursor);
  };
  if (document.documentElement) mount();
  else document.addEventListener("DOMContentLoaded", mount);

  // ---- camera: CSS transform on the page root (body), eased with tokens
  const cam = { s: 1, x: 0, y: 0 };
  const applyCam = () => {
    const b = document.body;
    b.style.transformOrigin = "0 0";
    b.style.transform = `translate(${cam.x}px,${cam.y}px) scale(${cam.s})`;
  };
  function docRect(el) {
    const b = document.body;
    const prev = b.style.transform;
    b.style.transform = "none";
    const r = el.getBoundingClientRect();
    b.style.transform = prev;
    return r;
  }
  async function camTo(sel, o = {}) {
    const el = o.union
      ? document.querySelector(o.union[0])
      : typeof sel === "string"
        ? document.querySelector(sel)
        : null;
    const dur = o.dur ?? ms("--ts-dur-slow") * 3;
    let to;
    if (!el) to = { s: 1, x: 0, y: 0 };
    else {
      let r = docRect(el);
      if (o.union) {
        const b = docRect(document.querySelector(o.union[1]));
        const left = Math.min(r.left, b.left),
          top = Math.min(r.top, b.top);
        r = {
          left,
          top,
          width: Math.max(r.right, b.right) - left,
          height: Math.min(o.maxH ?? 1e9, Math.max(r.bottom, b.bottom) - top),
        };
      }
      const fill = o.fill ?? [0.62, 0.62];
      const s = Math.min(o.maxScale ?? 1.9, (W() * fill[0]) / r.width, (H() * fill[1]) / r.height);
      const ax = (o.anchor?.[0] ?? 0.5) * W();
      const ay = (o.anchor?.[1] ?? 0.5) * H();
      const sY = window.scrollY;
      const sX = window.scrollX;
      to = { s, x: ax + sX - s * (r.left + sX + r.width / 2), y: ay + sY - s * (r.top + sY + r.height / 2) };
    }
    const from = { ...cam };
    await tween(dur, bezier(o.ease ?? "--ts-ease-standard"), (e) => {
      cam.s = from.s + (to.s - from.s) * e;
      cam.x = from.x + (to.x - from.x) * e;
      cam.y = from.y + (to.y - from.y) * e;
      applyCam();
    });
  }
  // slow push-in that fills time so no frame is dead
  const drift = (sel, o = {}) => camTo(sel, { ease: "--ts-ease-enter", ...o });

  // ---- cursor on eased paths
  const cur = { x: -60, y: H() * 0.7 };
  const place = () => {
    cursor.style.transform = `translate(${cur.x}px,${cur.y}px)`;
  };
  async function cursorTo(sel, o = {}) {
    const el = document.querySelector(sel);
    if (!el) throw new Error("cursorTo: no element " + sel);
    cursor.style.opacity = "1";
    const r = el.getBoundingClientRect();
    const tx = r.left + r.width * (o.at?.[0] ?? 0.5);
    const ty = r.top + r.height * (o.at?.[1] ?? 0.5);
    const from = { ...cur };
    const ease = bezier("--ts-ease-standard");
    const bend = (o.bend ?? 0.18) * Math.hypot(tx - from.x, ty - from.y);
    const cx = (from.x + tx) / 2 + bend,
      cy = (from.y + ty) / 2 - bend;
    await tween(o.dur ?? ms("--ts-dur-slow") * 2.5, ease, (e) => {
      const u = 1 - e;
      cur.x = u * u * from.x + 2 * u * e * cx + e * e * tx;
      cur.y = u * u * from.y + 2 * u * e * cy + e * e * ty;
      place();
    });
    return { x: tx, y: ty };
  }
  async function ripple() {
    const d = document.createElement("div");
    d.style.cssText = `position:fixed;left:${cur.x - 8}px;top:${cur.y - 8}px;width:16px;height:16px;border-radius:50%;
      background:var(--ts-signal);border:2px solid var(--ts-ink);pointer-events:none;z-index:2147483500`;
    layer.appendChild(d);
    cursor.animate(
      [
        { transform: `translate(${cur.x}px,${cur.y}px) scale(1)` },
        { transform: `translate(${cur.x}px,${cur.y}px) scale(.86)` },
        { transform: `translate(${cur.x}px,${cur.y}px) scale(1)` },
      ],
      { duration: ms("--ts-dur-fast") * 1.5 },
    );
    await d.animate(
      [
        { transform: "scale(.6)", opacity: 0.9 },
        { transform: "scale(4)", opacity: 0 },
      ],
      { duration: ms("--ts-dur-slow") * 1.6, easing: tok("--ts-ease-enter") },
    ).finished;
    d.remove();
  }

  // ---- kinetic type
  let current = null;
  function block(parts, pos) {
    const el = document.createElement("div");
    // safe margins: 5 % of the frame at the sides and top, bottom 12 % kept clear for captions
    const ex = "96px",
      ey = "58px",
      eb = "132px";
    const p = {
      bl: `left:${ex};bottom:${eb}`,
      tl: `left:${ex};top:${ey}`,
      bc: `left:50%;bottom:${eb};translate:-50% 0`,
      br: `right:${ex};bottom:${eb}`,
      tr: `right:${ex};top:${ey}`,
    }[pos || "bl"];
    el.style.cssText = `position:absolute;${p};display:flex;flex-direction:column;gap:var(--ts-s3);align-items:${pos && pos.endsWith("r") ? "flex-end" : "flex-start"};font-family:var(--ts-font);max-width:78%`;
    for (const part of parts) {
      const row = document.createElement("div");
      row.className = "demo-row";
      const hl = part.accent;
      row.style.cssText = `padding:var(--ts-s3) var(--ts-s6);border-radius:var(--ts-r-card);box-shadow:var(--ts-shadow-hero);
        background:${hl ? "var(--ts-signal)" : "var(--ts-ink)"};color:${hl ? "var(--ts-on-signal)" : "var(--ts-surface)"};
        font-size:calc(${part.size || "40px"});font-weight:${part.weight || 600};letter-spacing:-0.03em;line-height:1.15;
        ${part.mono ? "font-family:var(--ts-mono);" : ""}display:flex;gap:var(--ts-s4);align-items:baseline`;
      for (const seg of part.segs || [{ text: part.text }]) {
        const s = document.createElement("span");
        s.textContent = seg.text ?? "";
        if (seg.mono) s.style.fontFamily = "var(--ts-mono)";
        if (seg.small) s.style.cssText += ";font-size:.5em;font-weight:500;letter-spacing:0;opacity:.85";
        if (seg.id) s.dataset.demoId = seg.id;
        row.appendChild(s);
      }
      el.appendChild(row);
    }
    return el;
  }
  async function say(parts, o = {}) {
    await clear();
    const el = block(parts, o.pos);
    layer.appendChild(el);
    current = el;
    const rows = [...el.children];
    await Promise.all(
      rows.map(
        (r, i) =>
          r.animate(
            [
              { transform: "translateY(28px) scale(.98)", opacity: 0 },
              { transform: "none", opacity: 1 },
            ],
            {
              duration: ms("--ts-dur-base"),
              delay: i * ms("--ts-stagger") * 2,
              easing: tok("--ts-ease-enter"),
              fill: "both",
            },
          ).finished,
      ),
    );
    return el;
  }
  async function clear() {
    if (!current) return;
    const el = current;
    current = null;
    await el.animate([{ opacity: 1 }, { opacity: 0, transform: "translateY(-12px)" }], {
      duration: ms("--ts-dur-fast"),
      easing: tok("--ts-ease-exit"),
      fill: "both",
    }).finished;
    el.remove();
  }
  // Count a number up from 0; always ends on the exact target string (read from the page by the caller).
  async function countUp(spanId, target, dur) {
    const span = layer.querySelector(`[data-demo-id="${spanId}"]`);
    const m = target.match(/^([^0-9-]*)(-?)([\d,]*)(\.\d+)?(.*)$/);
    const [, pre, neg, intPart, dec, post] = m;
    const final = parseFloat(neg + intPart.replace(/,/g, "") + (dec || "") || "0");
    const decimals = dec ? dec.length - 1 : 0;
    const group = intPart.includes(",");
    const fmt = (v) => {
      const a = Math.abs(v).toFixed(decimals);
      let [i, d] = a.split(".");
      if (group) i = i.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
      return pre + (v < 0 ? "-" : "") + i + (d ? "." + d : "") + post;
    };
    await tween(dur ?? ms("--ts-dur-slow") * 3, bezier("--ts-ease-standard"), (e, k) => {
      span.textContent = k >= 1 ? target : fmt(final * e);
    });
    span.textContent = target;
  }
  async function pulse(sel, o = {}) {
    const el = document.querySelector(sel);
    const r = el.getBoundingClientRect();
    const ring = document.createElement("div");
    const g = 8;
    ring.style.cssText = `position:fixed;left:${r.left - g}px;top:${r.top - g}px;width:${r.width + 2 * g}px;height:${r.height + 2 * g}px;
      border-radius:var(--ts-r-chip);border:3px solid var(--ts-signal);box-shadow:0 0 0 3px var(--ts-ink);pointer-events:none`;
    layer.appendChild(ring);
    await ring.animate(
      [
        { transform: "scale(1)", opacity: 1 },
        { transform: "scale(1.12)", opacity: 0.9, offset: 0.5 },
        { transform: "scale(1.2)", opacity: 0 },
      ],
      { duration: ms("--ts-dur-slow") * 2.2, easing: tok("--ts-ease-emphasis") },
    ).finished;
    ring.remove();
  }
  // Act title: same place and animation every time (top left), in 240 ms, held, out 160 ms. Does not wait.
  function title(text, holdMs = 800, sub) {
    const el = document.createElement("div");
    el.style.cssText = `position:absolute;left:96px;top:58px;display:flex;gap:var(--ts-s4);align-items:center;font-family:var(--ts-font);
      padding:var(--ts-s3) var(--ts-s6);border-radius:var(--ts-r-card);box-shadow:var(--ts-shadow-hero);background:var(--ts-signal);color:var(--ts-on-signal);
      font-size:44px;font-weight:700;letter-spacing:-0.03em;line-height:1.15`;
    el.textContent = text;
    layer.appendChild(el);
    const a = el.animate(
      [
        { transform: "translateY(24px)", opacity: 0 },
        { transform: "none", opacity: 1 },
      ],
      { duration: ms("--ts-dur-base"), easing: tok("--ts-ease-enter"), fill: "both" },
    );
    a.finished.then(() =>
      setTimeout(() => {
        el.animate([{ opacity: 1 }, { opacity: 0 }], {
          duration: ms("--ts-dur-fast"),
          easing: tok("--ts-ease-exit"),
          fill: "both",
        }).finished.then(() => el.remove());
      }, holdMs),
    );
  }
  async function smoothScroll(top, durMs) {
    const from = window.scrollY;
    await tween(durMs, bezier("--ts-ease-standard"), (e) => nativeScrollTo(0, from + (top - from) * e));
  }
  window.__demo = {
    tok,
    ms,
    camTo,
    drift,
    cursorTo,
    ripple,
    say,
    clear,
    countUp,
    pulse,
    smoothScroll,
    title,
    cam,
    place,
    lock,
  };
})();
