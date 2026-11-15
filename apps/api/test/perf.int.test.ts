import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { GenericContainer } from "testcontainers";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AiBudgetExceeded, AiBudgetService } from "../src/ai/ai-budget.service.js";
import { loadEnv, type Env } from "../src/config/config.js";
import { PrismaService } from "../src/db/prisma.service.js";
import { DecisionsService } from "../src/reports/decisions.service.js";
import { RetentionService } from "../src/retention/retention.service.js";

/**
 * Data / cost hardening on PostGIS: the additive migration (indexes, thumbnail trigger), retention, the daily Gemini
 * budget counted in the database, and cursor pagination of decisions with SQL counts.
 */
const MIGRATIONS = fileURLToPath(new URL("../../../prisma/migrations/", import.meta.url));
const IMAGE = "terrasight-postgis:17";
const DOCKERFILE_DIR = fileURLToPath(new URL("../../../infra/postgis/", import.meta.url));
const SQUARE = `ST_Multi(ST_SetSRID(ST_MakePolygon(ST_MakeLine(ARRAY[ST_MakePoint(-101,38), ST_MakePoint(-101,38.01), ST_MakePoint(-100.99,38.01), ST_MakePoint(-100.99,38), ST_MakePoint(-101,38)])), 4326))`;

let container: StartedPostgreSqlContainer;
let client: pg.Client;
let prisma: PrismaService;
let env: Env;
let ws: string;
let fieldId: string;

const q = async (sql: string, params: unknown[] = []) => (await client.query(sql, params)).rows;

beforeAll(async () => {
  await GenericContainer.fromDockerfile(DOCKERFILE_DIR).build(IMAGE, { deleteOnExit: false });
  container = await new PostgreSqlContainer(IMAGE).start();
  client = new pg.Client({ connectionString: container.getConnectionUri() });
  await client.connect();
  for (const dir of readdirSync(MIGRATIONS)
    .filter((d) => /^\d+_/.test(d))
    .sort())
    await client.query(readFileSync(`${MIGRATIONS}${dir}/migration.sql`, "utf8"));
  env = loadEnv({
    DATABASE_URL: container.getConnectionUri(),
    RABBITMQ_URL: "amqp://localhost:5672",
    JWT_SECRET: "integration-test-secret-0123456789abcdef",
    NODE_ENV: "test",
    GEMINI_DAILY_CALL_BUDGET: "3",
  });
  prisma = new PrismaService(env);
  ws = (
    await q(
      `INSERT INTO workspaces (id, name, slug, time_zone) VALUES (gen_random_uuid(), 'Co', 'co-perf', 'UTC') RETURNING id`,
    )
  )[0].id;
  fieldId = (
    await q(
      `INSERT INTO fields (id, workspace_id, name, alias_no, geom, centroid, area_ha, tier)
       VALUES (gen_random_uuid(), $1, 'Pivot 1', 1, ${SQUARE}, ST_Centroid(${SQUARE}), 50, 'A') RETURNING id`,
      [ws],
    )
  )[0].id;
});

afterAll(async () => {
  await prisma?.onModuleDestroy();
  await client?.end();
  await container?.stop();
});

describe("migration", () => {
  it("creates the new indexes", async () => {
    const names = (await q(`SELECT indexname FROM pg_indexes WHERE schemaname = 'public'`)).map((r) => r.indexname);
    for (const n of [
      "recommendations_field_id_status_idx",
      "recommendations_workspace_id_field_id_status_idx",
      "analysis_run_fields_field_id_updated_at_idx",
      "gather_jobs_field_id_started_at_idx",
      "plans_field_id_saved_at_idx",
      "scouting_tasks_field_id_idx",
      "scouting_tasks_recommendation_id_idx",
      "messages_conversation_id_created_at_idx",
      "source_cache_expires_at_idx",
      "analysis_runs_workspace_id_trigger_as_of_idx",
      "scouting_photos_task_id_idx",
      "notifications_unread_idx",
    ])
      expect(names, n).toContain(n);
    const [unread] = await q(`SELECT indexdef FROM pg_indexes WHERE indexname = 'notifications_unread_idx'`);
    expect(unread.indexdef).toMatch(/WHERE \(?read_at IS NULL\)?/);
  });

  it("fills the field thumbnail when the geometry is written, and refreshes it when it changes", async () => {
    const [a] = await q(`SELECT thumb_geojson FROM fields WHERE id = $1`, [fieldId]);
    expect(["Polygon", "MultiPolygon"]).toContain(JSON.parse(a.thumb_geojson).type);
    await q(`UPDATE fields SET name = 'renamed' WHERE id = $1`, [fieldId]);
    await q(
      `UPDATE fields SET geom = ST_Multi(ST_SetSRID(ST_Buffer(ST_MakePoint(-101, 38)::geography, 500)::geometry, 4326)) WHERE id = $1`,
      [fieldId],
    );
    const [b] = await q(`SELECT thumb_geojson FROM fields WHERE id = $1`, [fieldId]);
    expect(b.thumb_geojson).not.toBe(a.thumb_geojson);
  });
});

describe("retention", () => {
  it("prunes by age, keeps what is still needed, and a second pass the same day does nothing", async () => {
    const old = "now() - interval '200 days'";
    await q(
      `INSERT INTO source_cache (key, source, params, fetched_at, expires_at) VALUES
        ('old', 'power', '{}', ${old}, now() - interval '9 days'),
        ('fresh', 'power', '{}', now(), now() - interval '2 days'),
        ('forever', 'ai-watch', '{}', ${old}, NULL)`,
    );
    const snapOpen = (await q(`INSERT INTO input_snapshots (id, hash, payload, created_at) VALUES (gen_random_uuid(), 'h-open', '{}', ${old}) RETURNING id`))[0].id;
    await q(`INSERT INTO input_snapshots (id, hash, payload, created_at) VALUES (gen_random_uuid(), 'h-old', '{}', ${old})`);
    await q(`INSERT INTO input_snapshots (id, hash, payload, created_at) VALUES (gen_random_uuid(), 'h-new', '{}', now())`);
    const rec = (
      await q(
        `INSERT INTO recommendations (id, workspace_id, field_id, type, subject, season, level, confidence, tier, input_snapshot_id, updated_at)
         VALUES (gen_random_uuid(), $1, $2, 'pest', 'x', 2027, 'high', 'medium', 'A', $3, now()) RETURNING id`,
        [ws, fieldId, snapOpen],
      )
    )[0].id;
    await q(
      `INSERT INTO recommendation_levels (id, recommendation_id, level, confidence, at) VALUES
        (gen_random_uuid(), $1, 'low', 'low', ${old}),
        (gen_random_uuid(), $1, 'moderate', 'low', now() - interval '190 days'),
        (gen_random_uuid(), $1, 'high', 'medium', now() - interval '181 days'),
        (gen_random_uuid(), $1, 'high', 'medium', now() - interval '1 day')`,
      [rec],
    );
    const run = (
      await q(
        `INSERT INTO analysis_runs (id, workspace_id, trigger, as_of, status) VALUES (gen_random_uuid(), $1, 'manual', '2026-01-01', 'done') RETURNING id`,
        [ws],
      )
    )[0].id;
    await q(
      `INSERT INTO analysis_run_fields (run_id, field_id, status, updated_at) VALUES ($1, $2, 'ok', now() - interval '91 days')`,
      [run, fieldId],
    );
    const user = (await q(`INSERT INTO users (id, email, password_hash, name) VALUES (gen_random_uuid(), 'r@example.com', 'x', 'U') RETURNING id`))[0].id;
    await q(
      `INSERT INTO notifications (id, workspace_id, user_id, kind, read_at) VALUES
        (gen_random_uuid(), $1, $2, 'a', now() - interval '91 days'),
        (gen_random_uuid(), $1, $2, 'b', now() - interval '10 days'),
        (gen_random_uuid(), $1, $2, 'c', NULL)`,
      [ws, user],
    );

    const svc = new RetentionService(env, prisma);
    const counts = await svc.run(new Date(), true);
    expect(counts).toMatchObject({
      sourceCache: 1,
      inputSnapshots: 1,
      recommendationLevels: 3, // the three older than 180 days; the newest one stays
      analysisRunFields: 1,
      notifications: 1,
    });
    expect((await q(`SELECT key FROM source_cache WHERE key IN ('old','fresh','forever') ORDER BY key`)).map((r) => r.key)).toEqual(["forever", "fresh"]);
    expect((await q(`SELECT hash FROM input_snapshots ORDER BY hash`)).map((r) => r.hash)).toEqual(["h-new", "h-open"]);
    expect(await svc.run(new Date(), true)).toBeNull();
  });

  it("lets only one instance run at a time (advisory lock)", async () => {
    const other = new pg.Client({ connectionString: container.getConnectionUri() });
    await other.connect();
    try {
      await other.query("BEGIN");
      await other.query("SELECT pg_advisory_xact_lock(60301)");
      expect(await new RetentionService(env, prisma).run(new Date())).toBeNull();
    } finally {
      await other.query("ROLLBACK");
      await other.end();
    }
  });
});

describe("Gemini daily budget in the database", () => {
  it("allows the configured number of calls, then refuses; tokens are counted", async () => {
    const budget = new AiBudgetService(env, prisma);
    for (let i = 0; i < 3; i++) await budget.reserve();
    await expect(budget.reserve()).rejects.toBeInstanceOf(AiBudgetExceeded);
    await budget.record(1234);
    expect((await budget.usage()).tokens).toBe(1234);
    // A new day starts from zero.
    await budget.reserve(new Date(Date.now() + 864e5));
  });

  it("refuses once the token budget is spent", async () => {
    const e = loadEnv({
      DATABASE_URL: container.getConnectionUri(),
      RABBITMQ_URL: "amqp://localhost:5672",
      JWT_SECRET: "integration-test-secret-0123456789abcdef",
      NODE_ENV: "test",
      GEMINI_DAILY_TOKEN_BUDGET: "100",
    });
    const budget = new AiBudgetService(e, prisma);
    const day = new Date("2031-01-01T10:00:00Z");
    await budget.reserve(day);
    await budget.record(150, day);
    await expect(budget.reserve(day)).rejects.toBeInstanceOf(AiBudgetExceeded);
  });
});

describe("decisions pagination", () => {
  it("pages newest first with a cursor and counts all states from SQL", async () => {
    const user = (await q(`INSERT INTO users (id, email, password_hash, name) VALUES (gen_random_uuid(), 'p@example.com', 'x', 'P') RETURNING id`))[0].id;
    await q(`INSERT INTO memberships (workspace_id, user_id, role) VALUES ($1, $2, 'owner')`, [ws, user]);
    const text = JSON.stringify({
      fieldName: "Pivot 1",
      title: { en: "t", uk: "t" },
      action: { en: "a", uk: "a" },
      why: { en: "w", uk: "w" },
      scout: null,
      level: "high",
      confidence: "medium",
      deadline: null,
      keyNumbers: [],
      edited: false,
    });
    const rec = (
      await q(
        `INSERT INTO recommendations (id, workspace_id, field_id, type, subject, season, level, confidence, tier, updated_at)
         VALUES (gen_random_uuid(), $1, $2, 'pest', 'paged', 2027, 'high', 'medium', 'A', now()) RETURNING id`,
        [ws, fieldId],
      )
    )[0].id;
    const ids: string[] = [];
    for (let i = 0; i < 5; i++)
      ids.push(
        (
          await q(
            `INSERT INTO report_items (id, workspace_id, recommendation_id, text, committed_at)
             VALUES (gen_random_uuid(), $1, $2, $3::jsonb, now() - ($4 || ' minutes')::interval) RETURNING id`,
            [ws, rec, text, String(i)],
          )
        )[0].id,
      ); // ids[0] is the newest
    // 0: approved, 1: question (unanswered by staff), 2: not_now then nothing, 3 and 4: waiting
    await q(`INSERT INTO owner_answers (id, report_item_id, answer, via, created_at) VALUES (gen_random_uuid(), $1, 'done', 'user', now())`, [ids[0]]);
    await q(`INSERT INTO owner_answers (id, report_item_id, answer, via, created_at) VALUES (gen_random_uuid(), $1, 'question', 'user', now())`, [ids[1]]);
    await q(`INSERT INTO owner_answers (id, report_item_id, answer, via, created_at) VALUES (gen_random_uuid(), $1, 'not_yet', 'user', now())`, [ids[2]]);

    const view = { level: "high", deadline: null, text: { title: { en: "t" }, action: { en: "a" } } };
    const svc = new DecisionsService(prisma, null as never, { view: () => view } as never, null as never);

    const p1 = await svc.list(ws, "all", { limit: 2 });
    expect(p1.counts).toEqual({ waiting: 2, question: 1, decided: 2 });
    expect(p1.items.map((d) => d.id)).toEqual([ids[0], ids[1]]);
    expect(p1.nextCursor).toBeTruthy();
    const p2 = await svc.list(ws, "all", { limit: 2, cursor: p1.nextCursor });
    expect(p2.items.map((d) => d.id)).toEqual([ids[2], ids[3]]);
    const p3 = await svc.list(ws, "all", { limit: 2, cursor: p2.nextCursor });
    expect(p3.items.map((d) => d.id)).toEqual([ids[4]]);
    expect(p3.nextCursor).toBeNull();

    const decided = await svc.list(ws, "decided");
    expect(decided.items.map((d) => d.id)).toEqual([ids[0], ids[2]]);
    expect(decided.nextCursor).toBeNull();
    expect((await svc.list(ws, "question")).items.map((d) => d.id)).toEqual([ids[1]]);
    expect((await svc.list(ws, "waiting")).items.map((d) => d.id)).toEqual([ids[3], ids[4]]);
  });
});
