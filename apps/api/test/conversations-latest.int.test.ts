import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { GenericContainer } from "testcontainers";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AssistantService } from "../src/assistant/assistant.service.js";
import { loadEnv } from "../src/config/config.js";
import { PrismaService } from "../src/db/prisma.service.js";

/** Latest chat per field (GET /conversations?fieldId=): the migration, ordering, and per-user / per-company isolation. */
const MIGRATIONS = fileURLToPath(new URL("../../../prisma/migrations/", import.meta.url));
const IMAGE = "terrasight-postgis:17";
const DOCKERFILE_DIR = fileURLToPath(new URL("../../../infra/postgis/", import.meta.url));

let container: StartedPostgreSqlContainer;
let client: pg.Client;
let prisma: PrismaService;
let service: AssistantService;

const rand = () => Math.random().toString(36).slice(2);
async function workspace(): Promise<string> {
  const r = await client.query(
    `INSERT INTO workspaces (id, name, slug, time_zone) VALUES (gen_random_uuid(), 'Co', $1, 'UTC') RETURNING id`,
    [`co-${rand()}`],
  );
  return r.rows[0].id as string;
}
async function user(ws: string): Promise<string> {
  const r = await client.query(
    `INSERT INTO users (id, email, password_hash, name) VALUES (gen_random_uuid(), $1, 'x', 'U') RETURNING id`,
    [`${rand()}@example.com`],
  );
  await client.query(`INSERT INTO memberships (workspace_id, user_id, role) VALUES ($1, $2, 'agronomist')`, [
    ws,
    r.rows[0].id,
  ]);
  return r.rows[0].id as string;
}
async function field(ws: string, n: number): Promise<string> {
  const wkt = `ST_Multi(ST_GeomFromText('POLYGON((0 0,0 0.01,0.01 0.01,0.01 0,0 0))', 4326))`;
  const r = await client.query(
    `INSERT INTO fields (id, workspace_id, name, alias_no, geom, centroid, area_ha, tier)
     VALUES (gen_random_uuid(), $1, $2, $3, ${wkt}, ST_Centroid(${wkt}), 10, 'A') RETURNING id`,
    [ws, `F${n}`, n],
  );
  return r.rows[0].id as string;
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
  const env = loadEnv({
    DATABASE_URL: container.getConnectionUri(),
    RABBITMQ_URL: "amqp://localhost:5672",
    JWT_SECRET: "integration-test-secret-0123456789abcdef",
    NODE_ENV: "test",
  });
  prisma = new PrismaService(env);
  service = new AssistantService(
    env,
    prisma,
    undefined as never,
    undefined as never,
    undefined as never,
    undefined as never,
  );
});

afterAll(async () => {
  await prisma?.onModuleDestroy();
  await client?.end();
  await container?.stop();
});

describe("latest conversation per field", () => {
  it("returns the newest chat opened from the field, only the caller's own", async () => {
    const ws = await workspace();
    const [me, other] = [await user(ws), await user(ws)];
    const [f1, f2] = [await field(ws, 1), await field(ws, 2)];
    const old = await service.create(ws, me, undefined, f1);
    const newest = await service.create(ws, me, undefined, f1);
    const onF2 = await service.create(ws, me, undefined, f2);
    const global = await service.create(ws, me);
    const theirs = await service.create(ws, other, undefined, f1);

    expect((await service.list(ws, me, f1)).map((c) => c.id)).toEqual([newest.id]);
    expect((await service.list(ws, me, f2)).map((c) => c.id)).toEqual([onF2.id]);
    expect((await service.list(ws, other, f1)).map((c) => c.id)).toEqual([theirs.id]);
    // The plain list stays complete and says where each chat came from.
    const all = await service.list(ws, me);
    expect(all.map((c) => c.id).sort()).toEqual([old.id, newest.id, onF2.id, global.id].sort());
    expect(all.find((c) => c.id === global.id)?.contextFieldId).toBeNull();
    expect(all.find((c) => c.id === old.id)?.contextFieldId).toBe(f1);
  });

  it("nothing for a field without chats, and other companies' fields cannot be attached", async () => {
    const ws = await workspace();
    const me = await user(ws);
    const f = await field(ws, 1);
    expect(await service.list(ws, me, f)).toEqual([]);
    const ws2 = await workspace();
    const foreign = await field(ws2, 1);
    await expect(service.create(ws, me, undefined, foreign)).rejects.toMatchObject({ status: 404 });
    // A second company cannot read the first one's latest chat even with the same field id.
    await service.create(ws, me, undefined, f);
    const stranger = await user(ws2);
    expect(await service.list(ws2, stranger, f)).toEqual([]);
  });
});
