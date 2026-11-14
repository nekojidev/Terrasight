import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { GenericContainer } from "testcontainers";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadEnv } from "../src/config/config.js";
import { PrismaService } from "../src/db/prisma.service.js";
import { WorkspaceScopeError } from "../src/db/workspace-scope.js";
import { FakeBroker } from "../src/messaging/fake-broker.js";
import { OutboxService } from "../src/messaging/outbox.service.js";
import { NotificationsService } from "../src/notifications/notifications.service.js";

/** Notifications on PostGIS (L-06): the migration, per-recipient rows, read state, isolation and the outbox event. */
const MIGRATIONS = fileURLToPath(new URL("../../../prisma/migrations/", import.meta.url));
const IMAGE = "terrasight-postgis:17";
const DOCKERFILE_DIR = fileURLToPath(new URL("../../../infra/postgis/", import.meta.url));

let container: StartedPostgreSqlContainer;
let client: pg.Client;
let prisma: PrismaService;
let service: NotificationsService;

async function workspace(): Promise<string> {
  const r = await client.query(
    `INSERT INTO workspaces (id, name, slug, time_zone) VALUES (gen_random_uuid(), 'Co', $1, 'UTC') RETURNING id`,
    [`co-${Math.random().toString(36).slice(2)}`],
  );
  return r.rows[0].id as string;
}
async function user(ws: string, role: string): Promise<string> {
  const r = await client.query(
    `INSERT INTO users (id, email, password_hash, name) VALUES (gen_random_uuid(), $1, 'x', 'U') RETURNING id`,
    [`${Math.random().toString(36).slice(2)}@example.com`],
  );
  const id = r.rows[0].id as string;
  await client.query(`INSERT INTO memberships (workspace_id, user_id, role) VALUES ($1, $2, $3)`, [
    ws,
    id,
    role,
  ]);
  return id;
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
  service = new NotificationsService(prisma, new OutboxService(prisma, new FakeBroker(), env));
});

afterAll(async () => {
  await prisma?.onModuleDestroy();
  await client?.end();
  await container?.stop();
});

describe("notifications (L-06)", () => {
  it("creates per-recipient rows with an event, lists newest first and marks read", async () => {
    const ws = await workspace();
    const a = await user(ws, "agronomist");
    const b = await user(ws, "admin");
    await service.create(prisma.system, ws, [
      {
        userId: a,
        kind: "report_answered",
        payload: { reportItemId: "i", answer: "question", fieldName: "P12" },
      },
      { userId: a, kind: "run_failed", payload: { runId: "r", failed: 1, total: 2 } },
      { userId: b, kind: "run_failed", payload: { runId: "r", failed: 1, total: 2 } },
    ]);
    const events = await prisma.system.outbox.findMany({ where: { routingKey: { contains: ws } } });
    expect(events.map((e) => e.routingKey).sort()).toEqual(
      [`workspace.${ws}.notifications.${a}`, `workspace.${ws}.notifications.${b}`].sort(),
    );

    const mine = await service.list(ws, a, false);
    expect(mine.unread).toBe(2);
    expect(mine.items).toHaveLength(2);
    expect((await service.list(ws, b, true)).items).toHaveLength(1);

    expect((await service.markRead(ws, a, [mine.items[0]!.id])).updated).toBe(1);
    expect((await service.list(ws, a, true)).items).toHaveLength(1);
    expect((await service.markRead(ws, a)).updated).toBe(1);
    expect((await service.list(ws, a, false)).unread).toBe(0);
    // Another user's notifications are untouched.
    expect((await service.list(ws, b, false)).unread).toBe(1);
  });

  it("never reads or marks across workspaces, and the scope guard rejects unscoped queries", async () => {
    const ws1 = await workspace();
    const ws2 = await workspace();
    const u = await user(ws1, "owner");
    await service.create(prisma.system, ws1, [{ userId: u, kind: "run_failed", payload: {} }]);
    expect((await service.list(ws2, u, false)).items).toHaveLength(0);
    expect((await service.markRead(ws2, u)).updated).toBe(0);
    await expect(prisma.db.notification.findMany({ where: { userId: u } })).rejects.toBeInstanceOf(
      WorkspaceScopeError,
    );
  });
});
