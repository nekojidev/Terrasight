#!/usr/bin/env node
// Presentation database: a persona company with REAL field outlines and REAL pipeline results.
//   node apps/api/scripts/seed-presentation.mjs --base http://localhost:4000 --out <file> [--suffix x] [--lang en|uk]
// The script never touches the database. It drives the product's own HTTP API as a user would (sign up, add fields,
// wait for the data gather, analyse, open rotations, accept, ask the owner, answer, scout). People are a persona;
// every number on the screens comes from the real pipelines. The few human inputs (notes, answers, a sowing date taken
// from the product's own sowing suggestion, scouting counts) are typed in as the persona and kept plain and modest.
// Credentials go ONLY to the --out file (mode 600), never to stdout.
import { randomBytes, randomUUID } from "node:crypto";
import { readFileSync, readdirSync, writeFileSync, chmodSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "../../..");

// ---------- arguments ----------
const args = Object.fromEntries(
  process.argv
    .slice(2)
    .map((a, i, all) => (a.startsWith("--") ? [a.slice(2), all[i + 1]?.startsWith("--") ? "true" : (all[i + 1] ?? "true")] : null))
    .filter(Boolean),
);
const BASE = (args.base ?? "http://localhost:4000").replace(/\/$/, "");
const OUT = args.out;
const SUFFIX = args.suffix ?? "";
const LANG = args.lang === "uk" ? "uk" : "en";
if (!OUT) {
  console.error("Usage: node apps/api/scripts/seed-presentation.mjs --base <api> --out <file> [--suffix x] [--lang en|uk]");
  process.exit(2);
}
const pw = () => randomBytes(18).toString("base64url");
const OWNER_PW = process.env.SEED_OWNER_PASSWORD || pw();
const AGRO_PW = process.env.SEED_AGRONOMIST_PASSWORD || pw();
const COMPANY = `Prairie Field Co.${SUFFIX ? ` ${SUFFIX}` : ""}`;
const OWNER_EMAIL = `olena.owner${SUFFIX}@example.com`.toLowerCase();
const AGRO_EMAIL = `marko.agronomist${SUFFIX}@example.com`.toLowerCase();

// ---------- plumbing ----------
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const t0 = Date.now();
const stages = [];
let stageStart = Date.now();
const log = (m) => console.log(`[${String(Math.round((Date.now() - t0) / 1000)).padStart(4)}s] ${m}`);
function stage(name) {
  endStage();
  stages.push({ name, seconds: 0, _t: Date.now() });
  log(`== ${name}`);
}
function endStage() {
  const s = stages.at(-1);
  if (s && s._t) {
    s.seconds = Math.round((Date.now() - s._t) / 1000);
    delete s._t;
  }
}
const problems = []; // things that failed or looked wrong
const note = (m) => {
  problems.push(m);
  log(`! ${m}`);
};

class Client {
  constructor(label) {
    this.label = label;
    this.jar = new Map();
  }
  cookieHeader() {
    return [...this.jar].map(([k, v]) => `${k}=${v}`).join("; ");
  }
  async call(method, path, body, { retries = 6 } = {}) {
    for (let attempt = 0; ; attempt++) {
      let res;
      try {
        res = await fetch(`${BASE}${path}`, {
          method,
          headers: {
            "X-Requested-With": "XMLHttpRequest",
            "User-Agent": "terrasight-seed/1.0",
            ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
            ...(this.jar.size ? { Cookie: this.cookieHeader() } : {}),
          },
          body: body !== undefined ? JSON.stringify(body) : undefined,
        });
      } catch (e) {
        if (attempt < retries) {
          await sleep(3000);
          continue;
        }
        throw e;
      }
      for (const c of res.headers.getSetCookie?.() ?? []) {
        const [pair, ...attrs] = c.split(";");
        const eq = pair.indexOf("=");
        const k = pair.slice(0, eq).trim();
        const v = pair.slice(eq + 1).trim();
        if (v === "" || attrs.some((a) => /max-age=0/i.test(a))) this.jar.delete(k);
        else this.jar.set(k, v);
      }
      const text = await res.text();
      let json = null;
      try {
        json = text ? JSON.parse(text) : null;
      } catch {
        /* not JSON */
      }
      if (res.status === 429 && attempt < retries) {
        const wait = Math.min(60, Number(res.headers.get("retry-after")) || 5);
        log(`rate limited on ${method} ${path.replace(/[0-9a-f-]{36}/g, ":id")}; waiting ${wait}s`);
        await sleep(wait * 1000 + 500);
        continue;
      }
      if (res.status === 503 && attempt < 2) {
        await sleep(5000);
        continue;
      }
      return { status: res.status, ok: res.ok, body: json, type: json?.type ?? null, text };
    }
  }
}

const short = (path) => path.replace(/[0-9a-f]{8}-[0-9a-f-]{27}/g, ":id");
/** A call that must succeed; otherwise it throws with the status and problem type (never a body with secrets). */
async function must(client, method, path, body) {
  const r = await client.call(method, path, body);
  if (!r.ok) throw new Error(`${method} ${short(path)} -> ${r.status} ${r.type ?? ""} ${r.body?.detail ?? r.body?.title ?? ""}`.trim());
  return r.body;
}
/** A call that may fail: the failure is recorded as a finding and null is returned. */
async function may(client, method, path, body, what) {
  const r = await client.call(method, path, body);
  if (!r.ok) {
    note(`${what ?? `${method} ${short(path)}`}: ${method} ${short(path)} -> ${r.status} ${r.type ?? ""} ${r.body?.detail ?? ""}`.trim());
    return null;
  }
  return r.body;
}
async function until(what, fn, { timeoutMs, everyMs = 4000, quiet = false }) {
  const end = Date.now() + timeoutMs;
  let last;
  while (Date.now() < end) {
    last = await fn();
    if (last) return last;
    await sleep(everyMs);
  }
  if (!quiet) note(`timed out waiting for ${what}`);
  return null;
}

// ---------- the persona's fields (real outlines) ----------
const FIELD_DIR = join(root, "data/presentation/fields");
const ORDER = ["pivot-12", "pivot-14", "north-quarter", "kearny-dryland", "cherkasy", "mykolaiv"];
const files = readdirSync(FIELD_DIR).filter((f) => f.endsWith(".geojson"));
const outlines = ORDER.filter((k) => files.includes(`${k}.geojson`)).map((k) => {
  const f = JSON.parse(readFileSync(join(FIELD_DIR, `${k}.geojson`), "utf8"));
  return { key: k, name: f.properties.name, irrigation: f.properties.irrigation === "irrigated" ? "irrigated" : "dryland", props: f.properties, geometry: f.geometry };
});

const owner = new Client("owner");
const agro = new Client("agronomist");
const out = {
  generatedAt: new Date().toISOString(),
  base: BASE,
  language: LANG,
  credentials: {
    owner: { name: "Olena Kovalenko", email: OWNER_EMAIL, password: OWNER_PW },
    agronomist: { name: "Marko Shevchenko", email: AGRO_EMAIL, password: AGRO_PW },
  },
  workspace: { id: null, name: COMPANY },
  fields: {},
  decisions: [],
  numbers: { fields: {}, farmStress: null },
  stages,
  findings: problems,
};
const save = () => {
  writeFileSync(OUT, JSON.stringify(out, null, 2), { mode: 0o600 });
  chmodSync(OUT, 0o600);
};
const F = {}; // key -> state

async function main() {
  // ================= 1. people and company =================
  stage("accounts");
  await owner.call("POST", "/api/auth/signup", { email: OWNER_EMAIL, password: OWNER_PW, name: "Olena Kovalenko", uiLanguage: LANG });
  const li = await owner.call("POST", "/api/auth/login", { email: OWNER_EMAIL, password: OWNER_PW });
  if (!li.ok) {
    throw new Error(
      `${OWNER_EMAIL} already exists with another password (sign-in answered ${li.status}). Nothing was created. ` +
        `Use another --suffix, or have the owner wipe that company first.`,
    );
  }
  const me = await must(owner, "GET", "/api/me");
  if ((me.workspaces ?? []).length) {
    throw new Error(`${OWNER_EMAIL} already has a company ("${me.workspaces[0].name ?? me.workspaces[0].id}"). Nothing was created; use another --suffix.`);
  }
  const ws = await must(owner, "POST", "/api/workspaces", {
    name: COMPANY,
    timeZone: "America/Chicago",
    units: "imperial",
    reportLanguage: LANG,
    currency: "USD",
  });
  const WS = ws.id;
  out.workspace.id = WS;
  const member = await must(owner, "POST", `/api/w/${WS}/members`, { name: "Marko Shevchenko", email: AGRO_EMAIL, role: "agronomist" });
  const token = String(member.setupUrl).split("/").pop();
  await must(agro, "POST", `/api/auth/setup/${token}`, { password: AGRO_PW });
  const members = await must(owner, "GET", `/api/w/${WS}/members`);
  out.workspace.ownerId = members.find?.((m) => m.role === "owner")?.id ?? null;
  out.workspace.agronomistId = members.find?.((m) => m.role === "agronomist")?.id ?? null;
  log(`company created; owner and agronomist signed in`);
  save();

  // ================= 2. fields =================
  stage("add fields");
  for (const o of outlines) {
    const f = await may(agro, "POST", `/api/w/${WS}/fields`, { name: o.name, geometry: o.geometry, irrigated: o.irrigation === "irrigated" ? "yes" : "no" }, `add field ${o.name}`);
    if (!f) continue;
    F[o.key] = { key: o.key, id: f.id, name: o.name, irrigation: o.irrigation, tier: f.tier ?? null, sourceFailures: [] };
    await may(agro, "PATCH", `/api/w/${WS}/fields/${f.id}`, { irrigation: o.irrigation }, `confirm irrigation of ${o.name}`);
    out.fields[o.key] = { id: f.id, name: o.name, irrigation: o.irrigation };
    log(`added ${o.name} (${o.irrigation})`);
  }
  save();

  stage("data gather and history");
  const live = Object.values(F);
  const waits = live.map(async (f) => {
    const started = Date.now();
    let lastLine = "";
    let jobDoneAt = null;
    const built = await until(
      `history of ${f.name}`,
      async () => {
        const [g, h] = await Promise.all([
          agro.call("GET", `/api/w/${WS}/fields/${f.id}/gather`),
          agro.call("GET", `/api/w/${WS}/fields/${f.id}/history`),
        ]);
        const line = g.body ? `${g.body.status}: ${g.body.sources.map((s) => `${s.source}=${s.status}`).join(" ")}` : "no gather";
        if (line !== lastLine) {
          lastLine = line;
          log(`${f.name}: ${line}`);
        }
        if (h.body?.built) return { g: g.body, h: h.body };
        if (g.body && g.body.status !== "running") {
          jobDoneAt ??= Date.now();
          if (Date.now() - jobDoneAt > 180_000) return { g: g.body, h: h.body, noHistory: true };
        }
        return null;
      },
      { timeoutMs: 25 * 60_000, everyMs: 5000 },
    );
    f.historySeconds = Math.round((Date.now() - started) / 1000);
    if (!built) {
      f.history = false;
      f.sourceFailures.push("gather timed out");
      return;
    }
    f.history = !built.noHistory;
    for (const s of built.g?.sources ?? []) {
      if (s.status === "failed" || s.status === "partial") f.sourceFailures.push(`${s.source}: ${s.status}${s.reason ? ` (${s.reason})` : ""}`);
    }
    if (built.noHistory) note(`${f.name}: gather finished but the history was not built`);
    f.historyView = built.h;
  });
  await Promise.all(waits);
  for (const f of live) {
    if (f.sourceFailures.length) note(`${f.name}: source problems: ${f.sourceFailures.join("; ")}`);
    const r = await agro.call("GET", `/api/w/${WS}/fields/${f.id}`);
    if (r.ok) {
      f.tier = r.body.tier ?? f.tier;
      f.irrigationAfter = r.body.irrigation;
    }
  }
  const ready = live.filter((f) => f.history);
  save();

  // ================= 3. analyze fields =================
  stage("analyze fields");
  let run = await may(agro, "POST", `/api/w/${WS}/analysis-runs`, {}, "analyze fields");
  if (run) {
    const done = await until(
      "the analysis run",
      async () => {
        const r = await agro.call("GET", `/api/w/${WS}/analysis-runs/${run.id}`);
        if (r.body && r.body.status !== "running") return r.body;
        return null;
      },
      { timeoutMs: 15 * 60_000, everyMs: 5000 },
    );
    if (done) {
      log(`analysis ${done.status}: ${done.fields.map((x) => `${x.name}=${x.status}(${x.newRecommendations ?? 0})`).join(", ")}`);
      for (const x of done.fields) if (x.status !== "ok") note(`analysis of ${x.name}: ${x.status}${x.error ? ` (${x.error})` : ""}`);
    }
  }

  // ================= 4. rotations, year sets, climate shift, trust (warms caches) =================
  stage("rotations, year sets, climate shift, trust");
  for (const f of ready) {
    const t = Date.now();
    const rot = await may(agro, "POST", `/api/w/${WS}/fields/${f.id}/scenario-runs`, { overrides: {} }, `rotation run ${f.name}`);
    f.rotation = rot;
    log(`${f.name}: rotation run ${rot?.pending ? `pending (${rot.pending})` : rot?.landUnsuitable ? "land unsuitable" : rot?.noLibrary ? "no library" : rot?.id ? "ok" : "none"} (${Math.round((Date.now() - t) / 1000)}s)`);
    const t1 = Date.now();
    f.yearSets = await may(agro, "POST", `/api/w/${WS}/fields/${f.id}/scenario-runs/year-sets`, { overrides: {} }, `year-set comparison ${f.name}`);
    log(`${f.name}: year sets ${f.yearSets?.sets ? "ok" : "none"} (${Math.round((Date.now() - t1) / 1000)}s)`);
    f.climate = await until(`climate shift ${f.name}`, async () => {
      const r = await agro.call("GET", `/api/w/${WS}/fields/${f.id}/climate-shift`);
      if (!r.ok) return r.status === 404 ? { status: "unavailable", reason: "404" } : null;
      return r.body.status === "pending" ? null : r.body;
    }, { timeoutMs: 5 * 60_000, everyMs: 5000 });
    f.trust = await until(`trust report ${f.name}`, async () => {
      const r = await agro.call("GET", `/api/w/${WS}/fields/${f.id}/trust`);
      if (!r.ok) return null;
      return r.body.status === "pending" ? null : r.body;
    }, { timeoutMs: 5 * 60_000, everyMs: 5000 });
    log(`${f.name}: climate ${f.climate?.status}, trust ${f.trust?.status}`);
  }

  // ================= 5. the agronomist's work =================
  stage("agronomist work");
  // recommendations per field
  for (const f of ready) {
    const r = await agro.call("GET", `/api/w/${WS}/fields/${f.id}/recommendations`);
    f.recs = r.ok ? r.body : [];
    log(`${f.name}: ${f.recs.length} recommendations (${[...new Set(f.recs.map((x) => `${x.type}:${x.subject}`))].join(", ") || "none"})`);
  }

  // current-season record: crop from the real history, sowing date from the product's own suggestion
  for (const f of ready) {
    const cur = await may(agro, "GET", `/api/w/${WS}/fields/${f.id}/season-records/current`, undefined, `season record ${f.name}`);
    if (!cur) continue;
    const seasons = (f.historyView?.seasons ?? []).filter((s) => s.mainCrop && !s.mainCrop.startsWith("other:") && s.mainCrop !== "fallow");
    const regionCrops = new Set(f.historyView?.regionCrops ?? []);
    const pick = [...seasons].reverse().find((s) => regionCrops.has(s.mainCrop));
    if (!pick) {
      log(`${f.name}: no history crop in the region list; no current-season record`);
      continue;
    }
    // winter crops sown last autumn are the plausible "current" crop for wheat; otherwise repeat the crop the history shows
    const sug = await may(agro, "GET", `/api/w/${WS}/fields/${f.id}/season-records/${cur.season}/suggest?crop=${pick.mainCrop}`, undefined, `sowing suggestion ${f.name}`);
    const body = { crop: pick.mainCrop };
    if (sug?.sowing?.best) body.sowingDate = sug.sowing.best;
    if (sug?.tillage?.value && ["conventional", "reduced", "no_till"].includes(sug.tillage.value)) body.tillage = sug.tillage.value;
    const saved = await may(agro, "PUT", `/api/w/${WS}/fields/${f.id}/season-records/${cur.season}`, body, `save season record ${f.name}`);
    if (saved) {
      f.seasonRecord = { season: cur.season, crop: pick.mainCrop, sowingDate: body.sowingDate ?? null };
      log(`${f.name}: ${cur.season} record: ${pick.mainCrop}${body.sowingDate ? ` sown ${body.sowingDate}` : ""}`);
    }
  }

  // save the 2026 plan on two fields with an open rotation recommendation
  // A rotation item is only worth the owner's time when the best option differs from the current rotation.
  const changesRotation = (f) => !!f.rotation?.result?.bestFit && f.rotation.result.bestFit !== f.rotation.result.current?.id;
  const withRotation = ready.filter((f) => changesRotation(f) && f.recs.some((r) => r.type === "rotation"));
  let planned = 0;
  for (const f of withRotation) {
    if (planned >= 2) break;
    const res = f.rotation.result;
    const best = [res.current, ...res.alternatives].find((s) => s.id === res.bestFit);
    const crop = best?.plan?.[0]?.crops?.[0];
    if (!crop || crop === "fallow") continue;
    let r = await agro.call("PUT", `/api/w/${WS}/fields/${f.id}/plans/2026`, { crop, rotationId: res.bestFit, scenarioRunId: f.rotation.id });
    if (!r.ok) r = await agro.call("PUT", `/api/w/${WS}/fields/${f.id}/plans/2026`, { crop });
    if (r.ok) {
      planned++;
      f.plan2026 = { crop, rotationId: res.bestFit };
      log(`${f.name}: saved ${crop} to the 2026 plan`);
    } else note(`save 2026 plan ${f.name}: PUT plans/2026 -> ${r.status} ${r.type ?? ""}`);
  }

  // choose the items
  const all = ready.flatMap((f) => f.recs.map((r) => ({ ...r, _f: f })));
  const used = new Set();
  const take = (pred) => {
    const x = all.find((r) => !used.has(r.id) && pred(r));
    if (x) used.add(x.id);
    return x;
  };
  const scoutItem = take((r) => (r.type === "pest" || r.type === "disease") && r.status === "open");
  const acceptItem = take((r) => r.status === "open" && r.type !== "rotation" && r.level !== "none") ?? take((r) => r.status === "open");
  // Items that plausibly need money or a rotation change: rotation items first, then irreversible/planning ones.
  const askItems = [];
  const seenFields = new Set();
  for (const pred of [(r) => r.type === "rotation" && changesRotation(r._f), (r) => r.irreversible || r.planning, (r) => r.type === "irrigation" || r.type === "sowing"]) {
    for (const r of all) {
      if (askItems.length >= 3) break;
      if (used.has(r.id) || r.status !== "open" || seenFields.has(r._f.id)) continue;
      if (r.type === "rotation" && !changesRotation(r._f)) continue;
      if (!pred(r)) continue;
      used.add(r.id);
      seenFields.add(r._f.id);
      askItems.push(r);
    }
  }
  if (acceptItem) {
    const r = await may(agro, "POST", `/api/w/${WS}/recommendations/${acceptItem.id}/accept`, {}, "accept recommendation");
    if (r) {
      out.accepted = { id: acceptItem.id, field: acceptItem._f.name, type: acceptItem.type, subject: acceptItem.subject };
      log(`accepted ${acceptItem._f.name}: ${acceptItem.type}/${acceptItem.subject}`);
    }
  } else log("nothing to accept");

  const NOTES = {
    rotation: "The analysis proposes a different rotation for next season. Please confirm before we order seed.",
    irrigation: "This may mean extra water cost on this field. OK to go ahead?",
    sowing: "Sowing window is coming up. OK to book the machinery for it?",
    default: "Please look at this one and tell me if we should act on it.",
  };
  const asked = [];
  for (const r of askItems) {
    const res = await may(agro, "POST", `/api/w/${WS}/recommendations/${r.id}/ask-owner`, { note: NOTES[r.type] ?? NOTES.default }, `ask the owner about ${r._f.name}`);
    if (res) {
      asked.push(r);
      log(`asked the owner: ${r._f.name}: ${r.type}/${r.subject}`);
    }
  }

  // scouting: five points, low counts (20 plants per point)
  if (scoutItem) {
    const task = await may(agro, "POST", `/api/w/${WS}/recommendations/${scoutItem.id}/scouting-tasks`, {}, "start a scouting check");
    if (task) {
      const counts = [0, 1, 0, 0, 1].slice(0, task.points?.length ?? 5);
      const sent = await may(agro, "POST", `/api/w/${WS}/scouting-tasks/${task.id}/send`, { clientId: randomUUID(), counts }, "send the scouting check");
      if (sent) {
        out.scouting = { taskId: task.id, field: scoutItem._f.name, pest: scoutItem.subject, counts, resultPct: sent.resultPct ?? null };
        log(`scouting sent on ${scoutItem._f.name} (${scoutItem.subject}): result ${sent.resultPct ?? "?"}%`);
      }
    }
  } else log("no pest or disease item to scout");

  // ================= 6. the owner decides =================
  stage("owner decisions");
  let list = null;
  if (asked.length) {
    // "Ask the owner" has an 8 s undo window before it becomes a decision.
    list = await until("asked items to reach the Decisions screen", async () => {
      const r = await owner.call("GET", `/api/w/${WS}/decisions?state=all`);
      return r.ok && r.body.items.length >= asked.length ? r.body : null;
    }, { timeoutMs: 90_000, everyMs: 3000 });
  }
  const items = list?.items ?? [];
  if (items.length) {
    const [a, b] = items;
    const ra = await may(owner, "POST", `/api/w/${WS}/decisions/${a.id}/answer`, { answer: "approve", text: "Approved. Go ahead." }, "owner approves");
    if (ra) out.decisions.push({ id: a.id, field: a.fieldName, answer: "approve" });
    if (b) {
      const q = await may(owner, "POST", `/api/w/${WS}/decisions/${b.id}/answer`, { answer: "question", text: "What does this cost per hectare, and can it wait a week?" }, "owner asks a question");
      if (q) {
        out.decisions.push({ id: b.id, field: b.fieldName, answer: "question" });
        await may(agro, "POST", `/api/w/${WS}/decisions/${b.id}/replies`, { text: "Costs are in the margin figure on the item; it can wait a week, the deadline is not tight." }, "agronomist replies");
      }
    }
    for (const c of items.slice(2)) out.decisions.push({ id: c.id, field: c.fieldName, answer: null });
  } else if (asked.length) note("asked items never reached the Decisions screen");
  const dl = await owner.call("GET", `/api/w/${WS}/decisions?state=all`);
  if (dl.ok) {
    out.decisionCounts = dl.body.counts;
    if (dl.body.counts.waiting < 1) note(`no item is waiting for the owner (counts ${JSON.stringify(dl.body.counts)})`);
  }

  // ================= 7. assistant (one conversation) =================
  stage("assistant");
  const nq = F["north-quarter"];
  if (nq?.history) {
    try {
      const conv = await agro.call("POST", `/api/w/${WS}/conversations`, { fieldId: nq.id });
      if (conv.ok) {
        const q = await agro.call("POST", `/api/w/${WS}/conversations/${conv.body.id}/messages`, {
          text: "Has the climate of this field changed?",
          lang: LANG,
          context: { fieldId: nq.id },
        });
        if (q.ok) {
          const got = await until("assistant answer", async () => {
            const c = await agro.call("GET", `/api/w/${WS}/conversations/${conv.body.id}`);
            const m = c.body?.messages?.filter((x) => x.role === "assistant") ?? [];
            return m.length ? c.body : null;
          }, { timeoutMs: 90_000, everyMs: 4000, quiet: true });
          if (got) out.assistant = { conversationId: conv.body.id, field: nq.name };
          else log("assistant gave no answer in time (skipped)");
        } else log(`assistant unavailable (${q.status} ${q.type ?? ""}); skipped`);
      } else log(`assistant unavailable (${conv.status}); skipped`);
    } catch {
      log("assistant unavailable; skipped");
    }
  }

  // ================= 8. numbers =================
  stage("numbers");
  const stress = await may(agro, "GET", `/api/w/${WS}/farm-stress`, undefined, "farm stress");
  out.numbers.farmStress = stress;
  const pick = (o, keys) => Object.fromEntries(keys.map((k) => [k, o?.[k] ?? null]));
  for (const f of live) {
    const row = (y) => (y ? pick(y, ["year", "crop", "model", "county", "ndvi", "countyYield", "practice", "miss", "reason"]) : null);
    const yearRow = (years, yr) => row((years ?? []).find((y) => y.year === yr));
    const res = f.rotation?.result;
    const cur = res?.current;
    const rec = res ? [cur, ...res.alternatives].find((s) => s.id === res.bestFit) : null;
    const t = f.trust;
    out.numbers.fields[f.key] = {
      name: f.name,
      irrigation: f.irrigation,
      tier: f.tier,
      historySeconds: f.historySeconds ?? null,
      sourceFailures: f.sourceFailures,
      history: f.history,
      climateShift: f.climate
        ? {
            status: f.climate.status,
            reason: f.climate.reason ?? null,
            periods: f.climate.periods ?? null,
            crop: f.climate.crop ?? null,
            metrics: (f.climate.metrics ?? []).map((m) => ({
              id: m.id,
              unit: m.unit,
              baseline: m.baseline,
              recent: m.recent,
              delta: m.delta,
              significant: m.trend?.significant ?? false,
              slopePerDecade: m.trend?.slopePerDecade ?? null,
              pValue: m.trend?.pValue ?? null,
            })),
          }
        : null,
      yearSets: f.yearSets?.sets
        ? {
            mode: f.yearSets.mode,
            currency: f.yearSets.currency,
            bestChanges: f.yearSets.bestChanges,
            sets: f.yearSets.sets.map((s) => ({
              id: s.id,
              years: s.years,
              shift: s.shift,
              best: s.best,
              options: s.options.map((o) => ({ id: o.id, name: f.yearSets.names?.[o.id]?.en ?? null, rank: o.rank, margin: o.margin, drought: o.drought })),
            })),
          }
        : null,
      trust: t
        ? {
            status: t.status,
            reason: t.reason ?? null,
            modelFlat: t.modelFlat,
            vsCounty: t.vsCounty,
            vsNdvi: t.vsNdvi,
            actual: t.actual,
            dryland: t.dryland ? { area: t.dryland.area, fit: t.dryland.fit, case2022: row(t.dryland.case2022), y2012: yearRow(t.dryland.years, 2012), y2022: yearRow(t.dryland.years, 2022) } : null,
            case2022: row(t.case2022),
            y2012: yearRow(t.years, 2012),
            y2022: yearRow(t.years, 2022),
            missedYears: (t.years ?? []).filter((y) => y.miss).map((y) => ({ year: y.year, reason: y.reason })),
          }
        : null,
      rotation: res
        ? {
            id: f.rotation.id,
            mode: res.mode,
            currency: f.rotation.currency ?? null,
            weather: res.weather,
            current: cur && { id: cur.id, name: f.rotation.names?.[cur.id]?.en ?? null, margin: cur.margin, drought: cur.drought, droughtYield: cur.droughtYield, if2022: cur.if2022 },
            recommended: rec && { id: rec.id, name: f.rotation.names?.[rec.id]?.en ?? null, source: rec.source ?? "library", margin: rec.margin, drought: rec.drought, droughtYield: rec.droughtYield, if2022: rec.if2022, delta: rec.delta ?? null },
            bestFit: res.bestFit,
          }
        : f.rotation
          ? { pending: f.rotation.pending ?? null, landUnsuitable: !!f.rotation.landUnsuitable, noLibrary: !!f.rotation.noLibrary }
          : null,
      recommendations: (f.recs ?? []).map((r) => ({ id: r.id, type: r.type, subject: r.subject, level: r.level, status: r.status })),
      seasonRecord: f.seasonRecord ?? null,
      plan2026: f.plan2026 ?? null,
    };
    out.fields[f.key] = { ...out.fields[f.key], id: f.id };
  }
  endStage();
  save();
}

function humanSummary() {
  console.log("\n=== Summary (credentials are in the --out file only) ===");
  console.log(`Company: ${COMPANY}; workspace ${out.workspace.id}`);
  for (const s of stages) console.log(`  stage ${s.name}: ${s.seconds}s`);
  for (const [k, n] of Object.entries(out.numbers.fields)) {
    const r = n.rotation;
    const head = r?.current ? `rotation ${r.current.name ?? r.current.id} -> ${r.recommended?.name ?? r.recommended?.id}` : r ? `rotation ${r.pending ?? (r.landUnsuitable ? "land unsuitable" : "n/a")}` : "no rotation";
    console.log(`  ${n.name}: history ${n.history ? "yes" : "NO"}, ${n.recommendations.length} recommendations, ${head}${n.sourceFailures.length ? `, source problems: ${n.sourceFailures.join("; ")}` : ""}`);
  }
  const fs = out.numbers.farmStress;
  if (fs) console.log(`  Farm stress (${fs.stressYear} weather): ${fs.status}${fs.current ? ` current ${fs.current.atRisk} vs recommended ${fs.recommended?.atRisk} ${fs.currency ?? ""}` : ""}`);
  console.log(`  Decisions: ${JSON.stringify(out.decisionCounts ?? null)}; accepted: ${out.accepted ? "yes" : "no"}; scouting: ${out.scouting ? "sent" : "no"}; assistant: ${out.assistant ? "yes" : "skipped"}`);
  if (problems.length) {
    console.log(`  Findings (${problems.length}):`);
    for (const p of problems) console.log(`   - ${p}`);
  }
  console.log(`Details written to ${OUT}`);
}

try {
  await main();
  humanSummary();
} catch (e) {
  endStage();
  console.error(`\nSeed stopped: ${e.message}`);
  try {
    if (out.workspace.id) save();
  } catch {
    /* ignore */
  }
  process.exitCode = 1;
}
