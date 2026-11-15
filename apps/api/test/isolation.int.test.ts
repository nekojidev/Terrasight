import "reflect-metadata";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { INestApplication } from "@nestjs/common";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import cookieParser from "cookie-parser";
import pg from "pg";
import request from "supertest";
import { GenericContainer } from "testcontainers";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * IDOR suite: two workspaces with data; for EVERY `/api/w/:ws/...` route (enumerated from the live router, so a
 * new route is covered automatically) ids from workspace B used under workspace A's URL must answer 404 and never
 * leak B's data, and B's URL must be closed to A's user. B's rows must be unchanged at the end.
 */
const MIGRATIONS = fileURLToPath(new URL("../../../prisma/migrations/", import.meta.url));
const IMAGE = "terrasight-postgis:17";
const DOCKERFILE_DIR = fileURLToPath(new URL("../../../infra/postgis/", import.meta.url));
const SECRET = "integration-test-secret-0123456789abcdef";

interface Tenant {
  ws: string;
  user: string;
  cookie: string;
  field: string;
  rec: string;
  conv: string;
  run: string;
  scenarioRun: string;
  reportItem: string;
  link: string;
  task: string;
  notif: string;
}

let container: StartedPostgreSqlContainer;
let client: pg.Client;
let app: INestApplication;
let A: Tenant;
let B: Tenant;
const NAME_B = "SECRET-FIELD-OF-B";

async function one(sql: string, args: unknown[] = []): Promise<string> {
  const r = await client.query(sql, args);
  return r.rows[0].id as string;
}

async function tenant(tag: string, fieldName: string, sign: (id: string) => Promise<string>): Promise<Tenant> {
  const ws = await one(
    `INSERT INTO workspaces (id, name, slug, time_zone) VALUES (gen_random_uuid(), $1, $1, 'UTC') RETURNING id`,
    [`co-${tag}`],
  );
  const user = await one(
    `INSERT INTO users (id, email, password_hash, name) VALUES (gen_random_uuid(), $1, 'x', $2) RETURNING id`,
    [`${tag}@example.com`, `User ${tag}`],
  );
  await client.query(`INSERT INTO memberships (workspace_id, user_id, role) VALUES ($1, $2, 'owner')`, [ws, user]);
  const field = await one(
    `INSERT INTO fields (id, workspace_id, name, alias_no, geom, centroid, area_ha, tier, irrigation)
     VALUES (gen_random_uuid(), $1, $2, 1,
       ST_Multi(ST_GeomFromText('POLYGON((-100.9 37.9, -100.89 37.9, -100.89 37.91, -100.9 37.91, -100.9 37.9))', 4326)),
       ST_GeomFromText('POINT(-100.895 37.905)', 4326), 10, 'A', 'irrigated') RETURNING id`,
    [ws, fieldName],
  );
  const rec = await one(
    `INSERT INTO recommendations (id, workspace_id, field_id, type, subject, season, status, level, confidence, tier, updated_at)
     VALUES (gen_random_uuid(), $1, $2, 'pest', 'aphid', 2026, 'open', 'high', 'high', 'A', now()) RETURNING id`,
    [ws, field],
  );
  const conv = await one(
    `INSERT INTO conversations (id, workspace_id, user_id, title, expires_at)
     VALUES (gen_random_uuid(), $1, $2, $3, now() + interval '1 day') RETURNING id`,
    [ws, user, `${fieldName}-chat`],
  );
  const run = await one(
    `INSERT INTO analysis_runs (id, workspace_id, trigger, as_of, status) VALUES (gen_random_uuid(), $1, 'manual', current_date, 'done') RETURNING id`,
    [ws],
  );
  const scenarioRun = await one(
    `INSERT INTO scenario_runs (id, field_id, inputs_hash, library_versions, result, duration_ms)
     VALUES (gen_random_uuid(), $1, 'h', '{}', $2, 1) RETURNING id`,
    [field, JSON.stringify({ marker: fieldName })],
  );
  await client.query(
    `INSERT INTO plans (field_id, season, crop, saved_by) VALUES ($1, 2026, 'wheat', $2)`,
    [field, user],
  );
  const reportItem = await one(
    `INSERT INTO report_items (id, workspace_id, recommendation_id, text, committed_at)
     VALUES (gen_random_uuid(), $1, $2, $3, now()) RETURNING id`,
    [ws, rec, JSON.stringify({ en: { title: fieldName, action: "a", why: "w" }, uk: { title: fieldName, action: "a", why: "w" } })],
  );
  const link = await one(
    `INSERT INTO report_links (id, workspace_id, token_hash, language) VALUES (gen_random_uuid(), $1, $2, 'en') RETURNING id`,
    [ws, `hash-${tag}`],
  );
  const task = await one(
    `INSERT INTO scouting_tasks (id, recommendation_id, field_id, created_by, status) VALUES (gen_random_uuid(), $1, $2, $3, 'open') RETURNING id`,
    [rec, field, user],
  );
  const notif = await one(
    `INSERT INTO notifications (id, workspace_id, user_id, kind, payload) VALUES (gen_random_uuid(), $1, $2, 'run_failed', $3) RETURNING id`,
    [ws, user, JSON.stringify({ fieldName })],
  );
  await client.query(
    `INSERT INTO crop_seasons (field_id, season, main_crop, source) VALUES ($1, 2025, 'corn', 'user')`,
    [field],
  ).catch(() => undefined);
  return {
    ws, user, cookie: `ts_at=${await sign(user)}`, field, rec, conv, run, scenarioRun, reportItem, link, task, notif,
  };
}

beforeAll(async () => {
  await GenericContainer.fromDockerfile(DOCKERFILE_DIR).build(IMAGE, { deleteOnExit: false });
  container = await new PostgreSqlContainer(IMAGE).start();
  client = new pg.Client({ connectionString: container.getConnectionUri() });
  await client.connect();
  for (const dir of readdirSync(MIGRATIONS)
    .filter((d) => /^\d+_/.test(d))
    .sort())
    await client.query(readFileSync(`${MIGRATIONS}${dir}/migration.sql`, "utf8"));

  process.env.DATABASE_URL = container.getConnectionUri();
  process.env.RABBITMQ_URL = "amqp://localhost:5672";
  process.env.JWT_SECRET = SECRET;
  process.env.NODE_ENV = "test";
  process.env.ROLE = "api";
  process.env.LOG_LEVEL = "fatal";
  delete process.env.REDIS_URL;
  delete process.env.GEMINI_API_KEY;

  const { Test } = await import("@nestjs/testing");
  const { RequestMethod } = await import("@nestjs/common");
  const { AppModule } = await import("../src/app.module.js");
  const { RabbitService } = await import("../src/messaging/rabbit.service.js");
  const { FakeBroker } = await import("../src/messaging/fake-broker.js");
  const { requireRequestedWith } = await import("../src/http/csrf.js");
  const { ProblemFilter } = await import("../src/http/problem.js");
  const { signAccess } = await import("../src/auth/tokens.js");

  const mod = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(RabbitService)
    .useValue(new FakeBroker())
    .compile();
  app = mod.createNestApplication({ logger: false });
  app.setGlobalPrefix("api", {
    exclude: [
      { path: "healthz", method: RequestMethod.GET },
      { path: "readyz", method: RequestMethod.GET },
    ],
  });
  app.use(cookieParser());
  app.use(requireRequestedWith);
  app.useGlobalFilters(new ProblemFilter());
  await app.init();

  const sign = (id: string) => signAccess(id, SECRET);
  A = await tenant("a", "Field of A", sign);
  B = await tenant("b", NAME_B, sign);
});

afterAll(async () => {
  await app?.close();
  await client?.end();
  await container?.stop();
});

interface RouteDef {
  method: string;
  path: string;
}

function routes(): RouteDef[] {
  const http = app.getHttpAdapter().getInstance() as {
    router?: { stack: unknown[] };
    _router?: { stack: unknown[] };
  };
  const stack = (http.router ?? http._router)!.stack as Array<{
    route?: { path: string; methods: Record<string, boolean> };
  }>;
  const out: RouteDef[] = [];
  for (const l of stack) {
    if (!l.route || !l.route.path.startsWith("/api/w/:ws")) continue;
    for (const m of Object.keys(l.route.methods)) out.push({ method: m, path: l.route.path });
  }
  return out;
}

/** B's resource for a path parameter, decided by the literal segment before it. */
function foreignId(segmentBefore: string, name: string): string {
  if (name === "fieldId") return B.field;
  if (name === "runId") return B.scenarioRun;
  if (name === "userId") return B.user;
  if (name === "season") return "2026";
  if (name === "source") return "power";
  const m: Record<string, string> = {
    fields: B.field,
    conversations: B.conv,
    "analysis-runs": B.run,
    recommendations: B.rec,
    decisions: B.reportItem,
    "report-links": B.link,
    "scouting-tasks": B.task,
    members: B.user,
  };
  const id = m[segmentBefore];
  if (!id) throw new Error(`no foreign id for :${name} after /${segmentBefore} — extend the isolation test`);
  return id;
}

function fill(path: string, ws: string, foreign: boolean): string {
  const parts = path.split("/");
  return parts
    .map((p, i) => {
      if (p === ":ws") return ws;
      if (!p.startsWith(":")) return p;
      return foreign ? foreignId(parts[i - 1] ?? "", p.slice(1)) : "00000000-0000-4000-8000-000000000000";
    })
    .join("/");
}

function body(r: RouteDef): unknown {
  const key = `${r.method} ${r.path}`;
  if (key === "patch /api/w/:ws/recommendations/:id") return { title: { en: "t", uk: "t" } };
  if (key.endsWith("/accept")) return { note: "n" };
  if (key.endsWith("/members") || key.endsWith("/members/:userId")) return { name: "N", email: "n@example.com", role: "agronomist" };
  if (key.endsWith("/fields")) return { name: "x", geometry: { type: "Polygon", coordinates: [[[0, 0], [0, 1], [1, 1], [0, 0]]] } };
  return {
    text: "hello", note: "n", crop: "corn", mainCrop: "corn", secondCrop: null, answer: "approve", language: "en",
    role: "agronomist", pointIdx: 1, contentType: "image/jpeg", bytes: 100, clientId: "client-12345678", counts: [1],
    ids: [B.notif], fieldIds: [B.field], format: "geojson", unit: "kg/ha", overrides: {}, name: "x",
    email: "n@example.com", timeZone: "UTC", units: "metric", reportLanguage: "en", title: "t", sowingDate: null,
    rates: { strong: 1, variable: 1, weak: 1 }, scenarioRunId: B.scenarioRun, rotationId: null,
    geometry: { type: "Polygon", coordinates: [[[0, 0], [0, 1], [1, 1], [0, 0]]] },
  };
}

async function call(r: RouteDef, url: string, cookie: string) {
  const agent = request(app.getHttpServer());
  const verb = r.method as "get" | "post" | "put" | "patch" | "delete";
  let t = agent[verb](url).set("Cookie", cookie).set("X-Requested-With", "isolation-test");
  if (verb !== "get" && verb !== "delete") t = t.send(body(r) as object);
  return t.timeout(15_000);
}

const MARKERS = () => [NAME_B, B.field, B.rec, B.conv, B.run, B.scenarioRun, B.reportItem, B.link, B.task, B.notif, B.user, B.ws, "b@example.com"];
const HAS_ID = (p: string) => /:(?!ws\b)/.test(p);

describe("workspace isolation (IDOR)", () => {
  it("enumerates the workspace routes", () => {
    const list = routes();
    expect(list.length).toBeGreaterThan(40);
  });

  it("every /w/:ws route answers 404 under workspace B's URL for A's user", async () => {
    for (const r of routes()) {
      if (r.path === "/api/w/:ws/events") continue; // SSE: covered below
      const res = await call(r, fill(r.path, B.ws, true), A.cookie);
      expect(res.status, `${r.method} ${r.path} with B's workspace`).toBe(404);
      expect(res.text).not.toContain(NAME_B);
    }
  });

  it("every route with an id: B's ids under A's URL answer 404 and leak nothing", async () => {
    for (const r of routes()) {
      if (r.path === "/api/w/:ws/events" || !HAS_ID(r.path)) continue;
      const res = await call(r, fill(r.path, A.ws, true), A.cookie);
      expect(res.status, `${r.method} ${r.path}`).toBe(404);
      for (const m of MARKERS()) expect(res.text, `${r.method} ${r.path} leaked ${m}`).not.toContain(m);
    }
  });

  it("list and aggregate routes under A's URL never contain B's data", async () => {
    for (const r of routes()) {
      if (r.path === "/api/w/:ws/events" || HAS_ID(r.path) || r.method !== "get") continue;
      const res = await call(r, fill(r.path, A.ws, false), A.cookie);
      expect(res.status, `${r.method} ${r.path}`).toBeLessThan(500);
      for (const m of MARKERS()) expect(res.text, `${r.method} ${r.path} leaked ${m}`).not.toContain(m);
    }
  });

  it("plan save with a foreign scenarioRunId is refused (own field, B's run)", async () => {
    const url = `/api/w/${A.ws}/fields/${A.field}/plans/2027`;
    const res = await call({ method: "put", path: url }, url, A.cookie);
    expect(res.status).toBe(404);
    const rows = await client.query(`SELECT 1 FROM plans WHERE field_id = $1 AND season = 2027`, [A.field]);
    expect(rows.rowCount).toBe(0);
    const ok = await request(app.getHttpServer())
      .put(url)
      .set("Cookie", A.cookie)
      .set("X-Requested-With", "t")
      .send({ crop: "corn", scenarioRunId: A.scenarioRun });
    expect(ok.status).toBe(200);
  });

  it("SSE topics of B (field, conversation) are refused for A", async () => {
    for (const topic of [`field:${B.field}`, `conversation:${B.conv}`]) {
      const res = await request(app.getHttpServer())
        .get(`/api/w/${A.ws}/events?topics=${topic}`)
        .set("Cookie", A.cookie)
        .timeout(10_000);
      expect([403, 404, 422], topic).toContain(res.status);
    }
    const guard = await request(app.getHttpServer())
      .get(`/api/w/${B.ws}/events?topics=brief`)
      .set("Cookie", A.cookie)
      .timeout(10_000);
    expect(guard.status).toBe(404);
  });

  it("B's data is unchanged after all attempts", async () => {
    const f = await client.query(`SELECT archived_at, name FROM fields WHERE id = $1`, [B.field]);
    expect(f.rows[0]).toMatchObject({ archived_at: null, name: NAME_B });
    const rec = await client.query(`SELECT status, text_override FROM recommendations WHERE id = $1`, [B.rec]);
    expect(rec.rows[0]).toMatchObject({ status: "open", text_override: null });
    expect((await client.query(`SELECT 1 FROM conversations WHERE id = $1`, [B.conv])).rowCount).toBe(1);
    expect((await client.query(`SELECT 1 FROM report_links WHERE id = $1 AND revoked_at IS NULL`, [B.link])).rowCount).toBe(1);
    expect((await client.query(`SELECT 1 FROM notifications WHERE id = $1 AND read_at IS NULL`, [B.notif])).rowCount).toBe(1);
    const plan = await client.query(`SELECT crop FROM plans WHERE field_id = $1`, [B.field]);
    expect(plan.rows.map((x) => x.crop)).toEqual(["wheat"]);
    expect((await client.query(`SELECT 1 FROM memberships WHERE workspace_id = $1`, [B.ws])).rowCount).toBe(1);
    expect((await client.query(`SELECT 1 FROM scouting_tasks WHERE id = $1 AND status = 'open'`, [B.task])).rowCount).toBe(1);
  });
});
