import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { GenericContainer } from "testcontainers";
import { PrismaPg } from "@prisma/adapter-pg";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "../src/generated/prisma/client.js";
import { createScopedClient } from "../src/db/prisma.service.js";
import { WorkspaceScopeError } from "../src/db/workspace-scope.js";

/**
 * Integration suite kept in the hackathon (Tech Design §1.1): the real migration on PostGIS,
 * the partial unique indexes (Tech Design §5.2) and the workspace-scope guard.
 */
const MIGRATION = fileURLToPath(
  new URL("../../../prisma/migrations/20261114000000_init/migration.sql", import.meta.url),
);
// Built from infra/postgis/Dockerfile (multi-arch); postgis/postgis has no arm64 image.
const IMAGE = "terrasight-postgis:17";
const DOCKERFILE_DIR = fileURLToPath(new URL("../../../infra/postgis/", import.meta.url));

let container: StartedPostgreSqlContainer;
let client: pg.Client;
let prisma: PrismaClient;

const SQUARE =
  "ST_Multi(ST_GeomFromText('POLYGON((-100.9 37.9,-100.8 37.9,-100.8 38.0,-100.9 38.0,-100.9 37.9))', 4326))";

async function workspaceWithField(): Promise<{ ws: string; field: string }> {
  const ws = await client.query(
    `INSERT INTO workspaces (id, name, slug, time_zone) VALUES (gen_random_uuid(), 'Prairie Field Co.', $1, 'America/Chicago') RETURNING id`,
    [`prairie-${Math.random().toString(36).slice(2)}`],
  );
  const wsId = ws.rows[0].id as string;
  const field = await client.query(
    `INSERT INTO fields (id, workspace_id, name, alias_no, geom, centroid, area_ha, tier)
     VALUES (gen_random_uuid(), $1, 'Pivot 12', 1, ${SQUARE}, ST_Centroid(${SQUARE}), 50, 'A') RETURNING id`,
    [wsId],
  );
  return { ws: wsId, field: field.rows[0].id as string };
}

beforeAll(async () => {
  await GenericContainer.fromDockerfile(DOCKERFILE_DIR).build(IMAGE, { deleteOnExit: false });
  container = await new PostgreSqlContainer(IMAGE).start();
  client = new pg.Client({ connectionString: container.getConnectionUri() });
  await client.connect();
  await client.query(readFileSync(MIGRATION, "utf8"));
  prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: container.getConnectionUri() }) });
});

afterAll(async () => {
  await prisma?.$disconnect();
  await client?.end();
  await container?.stop();
});

describe("migration", () => {
  it("creates PostGIS geometry columns and spatial indexes", async () => {
    const { field } = await workspaceWithField();
    const r = await client.query(
      `SELECT ST_GeometryType(geom) AS t, ST_SRID(geom) AS srid FROM fields WHERE id = $1`,
      [field],
    );
    expect(r.rows[0]).toEqual({ t: "ST_MultiPolygon", srid: 4326 });
    const idx = await client.query(`SELECT indexname FROM pg_indexes WHERE tablename = 'fields'`);
    expect(idx.rows.map((x) => x.indexname)).toContain("fields_geom_gist");
  });
});

describe("partial unique indexes (Tech Design §5.2)", () => {
  it("allows one active gather job per field", async () => {
    const { field } = await workspaceWithField();
    await client.query(
      `INSERT INTO gather_jobs (id, field_id, status) VALUES (gen_random_uuid(), $1, 'running')`,
      [field],
    );
    await expect(
      client.query(
        `INSERT INTO gather_jobs (id, field_id, status) VALUES (gen_random_uuid(), $1, 'queued')`,
        [field],
      ),
    ).rejects.toThrow(/gather_jobs_one_active_per_field/);
    // Finished jobs don't block a new one.
    await client.query(`UPDATE gather_jobs SET status = 'done' WHERE field_id = $1`, [field]);
    await client.query(
      `INSERT INTO gather_jobs (id, field_id, status) VALUES (gen_random_uuid(), $1, 'queued')`,
      [field],
    );
  });

  it("allows one active field check per field across runs", async () => {
    const { ws, field } = await workspaceWithField();
    const run = async (trigger: string) =>
      (
        await client.query(
          `INSERT INTO analysis_runs (id, workspace_id, trigger, as_of) VALUES (gen_random_uuid(), $1, $2, CURRENT_DATE) RETURNING id`,
          [ws, trigger],
        )
      ).rows[0].id as string;
    const r1 = await run("manual");
    const r2 = await run("manual");
    await client.query(
      `INSERT INTO analysis_run_fields (run_id, field_id, status, updated_at) VALUES ($1, $2, 'running', now())`,
      [r1, field],
    );
    await expect(
      client.query(
        `INSERT INTO analysis_run_fields (run_id, field_id, status, updated_at) VALUES ($1, $2, 'waiting', now())`,
        [r2, field],
      ),
    ).rejects.toThrow(/analysis_run_fields_one_active_per_field/);
  });

  it("allows one active scheduled run per workspace", async () => {
    const { ws } = await workspaceWithField();
    const insert = () =>
      client.query(
        `INSERT INTO analysis_runs (id, workspace_id, trigger, as_of) VALUES (gen_random_uuid(), $1, 'schedule', CURRENT_DATE)`,
        [ws],
      );
    await insert();
    await expect(insert()).rejects.toThrow(/analysis_runs_one_active_schedule_per_workspace/);
  });

  it("allows one live recommendation per field, type, subject and season", async () => {
    const { ws, field } = await workspaceWithField();
    const insert = (status: string) =>
      client.query(
        `INSERT INTO recommendations (id, workspace_id, field_id, type, subject, season, status, level, confidence, tier, updated_at)
         VALUES (gen_random_uuid(), $1, $2, 'pest', 'barley_yellow_dwarf', 2027, $3, 'high', 'medium', 'A', now())`,
        [ws, field, status],
      );
    await insert("open");
    await expect(insert("open")).rejects.toThrow(/recommendations_one_live/);
    await expect(insert("dismissed")).rejects.toThrow(/recommendations_one_live/);
    await insert("expired"); // not live: allowed alongside
  });
});

describe("workspace scope guard on a real client", () => {
  it("rejects an unscoped query before it reaches the database", async () => {
    const { ws } = await workspaceWithField();
    const db = createScopedClient(prisma);
    await expect(db.field.findMany()).rejects.toThrow(WorkspaceScopeError);
    const scoped = await db.field.findMany({ where: { workspaceId: ws }, select: { name: true } });
    expect(scoped).toEqual([{ name: "Pivot 12" }]);
  });
});
