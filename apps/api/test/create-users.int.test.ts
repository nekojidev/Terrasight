import { mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Mailer } from "../src/mail/mailer.js";
import { fileURLToPath } from "node:url";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { GenericContainer } from "testcontainers";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AuthService } from "../src/auth/auth.service.js";
import { hashToken } from "../src/auth/tokens.js";
import { loadEnv } from "../src/config/config.js";
import { PrismaService } from "../src/db/prisma.service.js";
import { ProblemException } from "../src/http/problem.js";
import { WorkspacesService } from "../src/workspaces/workspaces.service.js";

/** Owner creates users (PD v2.9): create → setup link → set password → login; existing email; regenerate; expiry. */
const MIGRATIONS = fileURLToPath(new URL("../../../prisma/migrations/", import.meta.url));
const IMAGE = "terrasight-postgis:17";
const DOCKERFILE_DIR = fileURLToPath(new URL("../../../infra/postgis/", import.meta.url));

let container: StartedPostgreSqlContainer;
let client: pg.Client;
let prisma: PrismaService;
let auth: AuthService;
let workspaces: WorkspacesService;

const tokenOf = (setupUrl: string) => setupUrl.replace("/setup/", "");
const code = async (p: Promise<unknown>) =>
  p.then(
    () => null,
    (e: unknown) => (e instanceof ProblemException ? e.getStatus() : "other"),
  );

async function workspace(): Promise<string> {
  const r = await client.query(
    `INSERT INTO workspaces (id, name, slug, time_zone) VALUES (gen_random_uuid(), 'Co', $1, 'UTC') RETURNING id`,
    [`co-${Math.random().toString(36).slice(2)}`],
  );
  return r.rows[0].id as string;
}
async function member(ws: string, role: string): Promise<{ id: string; role: "owner" | "agronomist" }> {
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
  return { id, role: role as "owner" | "agronomist" };
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
    UPLOADS_DIR: mkdtempSync(join(tmpdir(), "ts-outbox-")),
  });
  prisma = new PrismaService(env);
  const mailer = new Mailer(env);
  auth = new AuthService(prisma, env, mailer);
  workspaces = new WorkspacesService(prisma, env, mailer);
});

afterAll(async () => {
  await prisma?.onModuleDestroy();
  await client?.end();
  await container?.stop();
});

describe("owner creates users (PD v2.9)", () => {
  it("create → list → login fails → setup link → password → signed in → link is single-use", async () => {
    const ws = await workspace();
    const owner = await member(ws, "owner");
    const email = `ira-${Math.random().toString(36).slice(2)}@example.com`;

    const created = await workspaces.createUser(ws, owner, { name: "Ira", email, role: "agronomist" });
    if (!("setupUrl" in created)) throw new Error("expected a setup link");
    expect(created.setupUrl).toMatch(/^\/setup\/[\w-]{43}$/);
    expect(created.expiresAt.getTime() - Date.now()).toBeGreaterThan(6.9 * 864e5);

    // Only the hash is stored.
    const row = (await client.query(`SELECT * FROM users WHERE id = $1`, [created.userId])).rows[0];
    expect(row.password_hash).toBeNull();
    expect(row.setup_token_hash).toBe(hashToken(tokenOf(created.setupUrl)));
    expect(JSON.stringify(row)).not.toContain(tokenOf(created.setupUrl));

    const list = await workspaces.members(ws);
    expect(list.members.find((m) => m.id === created.userId)).toMatchObject({
      role: "agronomist",
      needsSetup: true,
    });

    // No password yet: login fails like a wrong password.
    expect(await code(auth.login(email, "whatever long password"))).toBe(401);
    expect(await code(auth.login(email, ""))).toBe(401);

    expect(await auth.setupInfo(tokenOf(created.setupUrl))).toEqual({ name: "Ira", email });
    const session = await auth.completeSetup(tokenOf(created.setupUrl), "a long enough password");
    expect(session.userId).toBe(created.userId);
    expect(session.access).toBeTruthy();
    expect((await auth.login(email, "a long enough password")).userId).toBe(created.userId);

    // Consumed: the link works once, and the member no longer needs setup.
    expect(await code(auth.completeSetup(tokenOf(created.setupUrl), "another long password"))).toBe(410);
    expect(await code(auth.setupInfo(tokenOf(created.setupUrl)))).toBe(410);
    expect((await workspaces.members(ws)).members.find((m) => m.id === created.userId)?.needsSetup).toBe(
      false,
    );
    expect(await code(workspaces.newSetupLink(ws, owner, created.userId))).toBe(409);

    const audit = await client.query(`SELECT action FROM audit_log WHERE workspace_id = $1 ORDER BY at`, [
      ws,
    ]);
    expect(audit.rows.map((r) => r.action)).toEqual(expect.arrayContaining(["member.create", "user.setup"]));
  });

  it("an existing account is invited, not silently added; a member is 409", async () => {
    const ws = await workspace();
    const owner = await member(ws, "owner");
    const other = await member(await workspace(), "owner");
    const email = (await client.query(`SELECT email FROM users WHERE id = $1`, [other.id])).rows[0]
      .email as string;

    const r = await workspaces.createUser(ws, owner, {
      name: "Someone",
      email: email.toUpperCase(),
      role: "agronomist",
    });
    expect(r).toMatchObject({ userId: other.id, existing: true, invited: true });
    const m = await client.query(`SELECT role FROM memberships WHERE workspace_id = $1 AND user_id = $2`, [
      ws,
      other.id,
    ]);
    expect(m.rows).toHaveLength(0);
    const inv = await client.query(`SELECT role FROM invitations WHERE workspace_id = $1`, [ws]);
    expect(inv.rows[0].role).toBe("agronomist");
    // The existing password stays untouched and no setup token is issued.
    const u = (
      await client.query(`SELECT password_hash, setup_token_hash FROM users WHERE id = $1`, [other.id])
    ).rows[0];
    expect(u).toEqual({ password_hash: "x", setup_token_hash: null });

    await client.query(`INSERT INTO memberships (workspace_id, user_id, role) VALUES ($1, $2, 'agronomist')`, [
      ws,
      other.id,
    ]);
    expect(await code(workspaces.createUser(ws, owner, { name: "Someone", email, role: "agronomist" }))).toBe(
      409,
    );
  });

  it("regenerating a link invalidates the previous one", async () => {
    const ws = await workspace();
    const owner = await member(ws, "owner");
    const created = await workspaces.createUser(ws, owner, {
      name: "Max",
      email: `max-${Math.random().toString(36).slice(2)}@example.com`,
      role: "agronomist",
    });
    if (!("setupUrl" in created)) throw new Error("expected a setup link");
    const next = await workspaces.newSetupLink(ws, owner, created.userId);
    expect(next.setupUrl).not.toBe(created.setupUrl);
    expect(await code(auth.completeSetup(tokenOf(created.setupUrl), "a long enough password"))).toBe(410);
    expect((await auth.completeSetup(tokenOf(next.setupUrl), "a long enough password")).userId).toBe(
      created.userId,
    );
    // Not a member of this workspace → 404.
    const stranger = await member(await workspace(), "owner");
    expect(await code(workspaces.newSetupLink(ws, owner, stranger.id))).toBe(404);
  });

  it("an expired link is rejected", async () => {
    const ws = await workspace();
    const owner = await member(ws, "owner");
    const created = await workspaces.createUser(ws, owner, {
      name: "Old",
      email: `old-${Math.random().toString(36).slice(2)}@example.com`,
      role: "agronomist",
    });
    if (!("setupUrl" in created)) throw new Error("expected a setup link");
    await client.query(`UPDATE users SET setup_expires_at = now() - interval '1 minute' WHERE id = $1`, [
      created.userId,
    ]);
    expect(await code(auth.completeSetup(tokenOf(created.setupUrl), "a long enough password"))).toBe(410);
    expect(await code(auth.setupInfo(tokenOf(created.setupUrl)))).toBe(410);
    // The owner can issue a fresh one.
    const fresh = await workspaces.newSetupLink(ws, owner, created.userId);
    expect((await auth.completeSetup(tokenOf(fresh.setupUrl), "a long enough password")).userId).toBe(
      created.userId,
    );
  });

  it("only the two roles exist: the old values are rejected by the database", async () => {
    const ws = await workspace();
    for (const role of ["admin", "viewer"]) {
      await expect(
        client.query(
          `INSERT INTO invitations (id, workspace_id, email, role, token_hash, expires_at)
           VALUES (gen_random_uuid(), $1, 'x@example.com', $2, $3, now() + interval '1 day')`,
          [ws, role, Math.random().toString(36)],
        ),
      ).rejects.toThrow();
    }
  });
});
