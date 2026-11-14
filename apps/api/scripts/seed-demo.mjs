#!/usr/bin/env node
// Demo template company (S-09.03): "Prairie Field Co." with the demo fields, their gathered history, season records,
// an owner Viewer with one open question. "Explore the demo company" copies it (EP-01, S-01.06).
//
// Usage (API running with its .env, against the target database):
//   node --env-file=../../.env scripts/seed-demo.mjs        → seeds once; prints the demo accounts' passwords
//   DEMO_API=http://localhost:4000 DEMO_PASSWORD=… node scripts/seed-demo.mjs
// Re-running is refused while a template exists (delete it first to re-seed).
import { randomBytes } from "node:crypto";
import pg from "pg";

const API = process.env.DEMO_API ?? "http://localhost:4000";
const PASSWORD = process.env.DEMO_PASSWORD ?? `demo-${randomBytes(9).toString("base64url")}`;
const SLUG = "demo-template";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Demo fields (RFC §11.4): pivots near Garden City KS, a dryland field in Chase County NE and one in Logan County CO. */
const circle = (lon, lat, r) => {
  const k = Math.cos((lat * Math.PI) / 180);
  const ring = Array.from({ length: 49 }, (_, i) => {
    const a = (i / 48) * 2 * Math.PI;
    return [
      Number((lon + (r / (111_320 * k)) * Math.cos(a)).toFixed(6)),
      Number((lat + (r / 110_540) * Math.sin(a)).toFixed(6)),
    ];
  });
  ring[48] = ring[0];
  return { type: "Polygon", coordinates: [ring] };
};
const square = (lon, lat, side) => {
  const k = Math.cos((lat * Math.PI) / 180);
  const dx = side / 2 / (111_320 * k);
  const dy = side / 2 / 110_540;
  return {
    type: "Polygon",
    coordinates: [
      [
        [lon - dx, lat - dy],
        [lon + dx, lat - dy],
        [lon + dx, lat + dy],
        [lon - dx, lat + dy],
        [lon - dx, lat - dy],
      ].map(([x, y]) => [Number(x.toFixed(6)), Number(y.toFixed(6))]),
    ],
  };
};
export const DEMO_FIELDS = [
  { name: "Pivot 12", geometry: circle(-101.05474, 38.09913, 390), irrigated: "yes" },
  {
    name: "Pivot 14",
    geometry: circle(-100.97, 37.99, 390),
    irrigated: "yes",
    season: { crop: "winter_wheat", sowingDate: "2026-09-05", emergenceDate: "2026-09-15" },
  },
  { name: "Chase 7", geometry: square(-101.64, 40.52, 800), irrigated: "no" },
  {
    name: "Logan dryland 5",
    geometry: square(-103.25, 40.65, 800),
    irrigated: "no",
    season: { crop: "winter_wheat", sowingDate: "2026-09-08", emergenceDate: "2026-09-20" },
  },
];

function client() {
  const jar = new Map();
  return async function call(path, init = {}) {
    const res = await fetch(API + path, {
      ...init,
      headers: {
        "X-Requested-With": "seed",
        ...(init.body ? { "Content-Type": "application/json" } : {}),
        cookie: [...jar].map(([k, v]) => `${k}=${v}`).join("; "),
      },
      body: init.body ? JSON.stringify(init.body) : undefined,
    });
    for (const c of res.headers.getSetCookie?.() ?? []) {
      const [kv] = c.split(";");
      const [k, ...v] = kv.split("=");
      jar.set(k, v.join("="));
    }
    const text = await res.text();
    if (!res.ok) throw new Error(`${init.method ?? "GET"} ${path} → ${res.status} ${text}`);
    return text ? JSON.parse(text) : null;
  };
}

const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
await db.connect();
if ((await db.query("SELECT 1 FROM workspaces WHERE slug = $1", [SLUG])).rowCount) {
  console.log("The demo template already exists; delete it to re-seed.");
  process.exit(0);
}
const run = Date.now().toString(36);
const agronomist = { email: `olena.koval+${run}@demo.terrasight.app`, name: "Olena Koval" };
const owner = { email: `john.miller+${run}@demo.terrasight.app`, name: "John Miller" };

const a = client();
await a("/api/auth/signup", {
  method: "POST",
  body: { ...agronomist, password: PASSWORD, uiLanguage: "en" },
});
const ws = await a("/api/workspaces", {
  method: "POST",
  body: { name: "Prairie Field Co.", timeZone: "America/Chicago", units: "imperial", reportLanguage: "en" },
});
await db.query("UPDATE workspaces SET slug = $1, is_demo = true WHERE id = $2", [SLUG, ws.id]);
console.log(`workspace ${ws.id} (${SLUG})`);

const fields = [];
for (const f of DEMO_FIELDS) {
  const created = await a(`/api/w/${ws.id}/fields`, {
    method: "POST",
    body: { name: f.name, geometry: f.geometry, irrigated: f.irrigated },
  });
  fields.push({ ...f, id: created.id });
  console.log(`field ${f.name}: ${created.id}`);
}

// Wait for every gather to finish (sources are slow: MODIS ~2 min per field).
for (const f of fields) {
  for (let i = 0; i < 120; i++) {
    const g = await a(`/api/w/${ws.id}/fields/${f.id}/gather`);
    if (g && g.status !== "running") {
      console.log(
        `gather ${f.name}: ${g.status} (${g.sources.map((s) => `${s.source}:${s.status}`).join(" ")})`,
      );
      break;
    }
    await sleep(10_000);
  }
}
await sleep(5_000); // history build

for (const f of fields.filter((x) => x.season)) {
  const rec = await a(`/api/w/${ws.id}/fields/${f.id}/season-records/current`);
  await a(`/api/w/${ws.id}/fields/${f.id}/season-records/${rec.season}`, { method: "PUT", body: f.season });
  console.log(`season record ${f.name} ${rec.season}: ${f.season.crop} sown ${f.season.sowingDate}`);
}

// The 06:00-equivalent run.
const runView = await a(`/api/w/${ws.id}/analysis-runs`, { method: "POST", body: {} });
for (let i = 0; i < 60; i++) {
  const r = await a(`/api/w/${ws.id}/analysis-runs/${runView.id}`);
  if (r.status === "done") break;
  await sleep(2_000);
}

// Owner as Viewer, with one open question on an item in the report.
const inv = await a(`/api/w/${ws.id}/invitations`, {
  method: "POST",
  body: { email: owner.email, role: "viewer" },
});
const o = client();
await o("/api/auth/signup", { method: "POST", body: { ...owner, password: PASSWORD, uiLanguage: "en" } });
await o(`/api/invitations/${inv.token}/accept`, { method: "POST" });
const brief = await a(`/api/w/${ws.id}/brief`);
const planItem = [brief.hero, ...brief.urgent, ...brief.thisWeek].find((x) => x?.planning) ?? null;
const recs = await db.query(
  "SELECT id FROM recommendations WHERE workspace_id = $1 AND status = 'open' AND planning ORDER BY created_at LIMIT 1",
  [ws.id],
);
const toAccept = planItem?.id ?? recs.rows[0]?.id;
if (toAccept) {
  await a(`/api/w/${ws.id}/recommendations/${toAccept}/accept`, {
    method: "POST",
    body: { note: "Let's decide together before seed is ordered." },
  });
  await sleep(10_000); // 8 s Undo window, then the commit
  const report = await o(`/api/w/${ws.id}/report`);
  const item = report.fields.flatMap((f) => f.items)[0];
  if (item)
    await o(`/api/w/${ws.id}/report-items/${item.id}/answers`, {
      method: "POST",
      body: { answer: "question", text: "How much do we lose if we don't plant corn?" },
    });
  console.log(item ? "owner question added" : "no report item yet");
}

const b = await a(`/api/w/${ws.id}/brief`);
console.log(`brief: ${JSON.stringify(b.counts)}; hero: ${b.hero?.text.title.en ?? "—"}`);
console.log(
  `\nDemo accounts (keep private):\n  agronomist ${agronomist.email}\n  owner      ${owner.email}\n  password   ${PASSWORD}`,
);
await db.end();
