import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { GenericContainer } from "testcontainers";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AccountService } from "../src/account/account.module.js";
import { AuthService } from "../src/auth/auth.service.js";
import { loadEnv } from "../src/config/config.js";
import { PrismaService } from "../src/db/prisma.service.js";
import { ExportService } from "../src/export/export.module.js";
import { FieldsService } from "../src/fields/fields.service.js";
import { ProblemException } from "../src/http/problem.js";

/** Settings: profile, password change (revokes other sessions), sign out everywhere, field restore, owner export. */
const MIGRATIONS = fileURLToPath(new URL("../../../prisma/migrations/", import.meta.url));
const IMAGE = "terrasight-postgis:17";
const DOCKERFILE_DIR = fileURLToPath(new URL("../../../infra/postgis/", import.meta.url));

let container: StartedPostgreSqlContainer;
let client: pg.Client;
let prisma: PrismaService;
let auth: AuthService;
let account: AccountService;
let fields: FieldsService;
let exporter: ExportService;

const status = async (p: Promise<unknown>) =>
  p.then(
    () => null,
    (e: unknown) => (e instanceof ProblemException ? e.getStatus() : "other"),
  );

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
  auth = new AuthService(prisma, env);
  account = new AccountService(prisma);
  fields = new FieldsService(prisma, null as never, null as never, null as never);
  exporter = new ExportService(prisma);
});

afterAll(async () => {
  await prisma?.onModuleDestroy();
  await client?.end();
  await container?.stop();
});

async function signup(): Promise<{ id: string; email: string }> {
  const email = `${Math.random().toString(36).slice(2)}@example.com`;
  const s = await auth.signup({ email, password: "a long enough password", name: "Ann", uiLanguage: "en" });
  return { id: s.userId, email };
}
async function workspaceOf(userId: string): Promise<string> {
  const r = await client.query(
    `INSERT INTO workspaces (id, name, slug, time_zone) VALUES (gen_random_uuid(), 'Co', $1, 'UTC') RETURNING id`,
    [`co-${Math.random().toString(36).slice(2)}`],
  );
  const ws = r.rows[0].id as string;
  await client.query(`INSERT INTO memberships (workspace_id, user_id, role) VALUES ($1, $2, 'owner')`, [ws, userId]);
  return ws;
}
async function field(ws: string, name: string): Promise<string> {
  const sq = "ST_SetSRID(ST_GeomFromText('MULTIPOLYGON(((0 0,0 1,1 1,1 0,0 0)))'), 4326)";
  const r = await client.query(
    `INSERT INTO fields (id, workspace_id, name, alias_no, geom, centroid, area_ha, tier)
     VALUES (gen_random_uuid(), $1, $2, (SELECT COALESCE(MAX(alias_no), 0) + 1 FROM fields WHERE workspace_id = $1),
             ${sq}, ST_SetSRID(ST_MakePoint(0.5, 0.5), 4326), 10, 'C') RETURNING id`,
    [ws, name],
  );
  return r.rows[0].id as string;
}

describe("account", () => {
  it("updates name and UI language", async () => {
    const u = await signup();
    const r = await account.updateProfile(u.id, { name: "Anna", uiLanguage: "uk" });
    expect(r).toMatchObject({ name: "Anna", uiLanguage: "uk" });
  });

  it("password change: wrong current is 401; success keeps this session and revokes the others", async () => {
    const u = await signup();
    const here = await auth.login(u.email, "a long enough password");
    const other = await auth.login(u.email, "a long enough password");

    expect(await status(account.changePassword(u.id, "not my password", "a brand new password", here.refresh))).toBe(
      401,
    );
    await account.changePassword(u.id, "a long enough password", "a brand new password", here.refresh);

    expect(await status(auth.login(u.email, "a long enough password"))).toBe(401);
    expect((await auth.login(u.email, "a brand new password")).userId).toBe(u.id);
    expect((await auth.rotate(here.refresh)).userId).toBe(u.id);
    expect(await status(auth.rotate(other.refresh))).toBe(401);
  });

  it("sign out everywhere revokes every refresh token", async () => {
    const u = await signup();
    const a = await auth.login(u.email, "a long enough password");
    const b = await auth.login(u.email, "a long enough password");
    await account.revokeAll(u.id);
    expect(await status(auth.rotate(a.refresh))).toBe(401);
    expect(await status(auth.rotate(b.refresh))).toBe(401);
  });
});

describe("archive, restore and export", () => {
  it("restore brings an archived field back; a live or foreign field is 404", async () => {
    const u = await signup();
    const ws = await workspaceOf(u.id);
    const other = await workspaceOf((await signup()).id);
    const id = await field(ws, "North");

    expect(await status(fields.restore(ws, u.id, id))).toBe(404);
    await fields.archive(ws, u.id, id);
    expect(await fields.list(ws)).toHaveLength(0);
    expect((await fields.listArchived(ws)).map((f) => f.id)).toEqual([id]);
    expect(await status(fields.restore(other, u.id, id))).toBe(404);

    await fields.restore(ws, u.id, id);
    expect((await fields.list(ws)).map((f) => f.id)).toEqual([id]);
    expect(await fields.listArchived(ws)).toHaveLength(0);
  });

  it("export holds this company's fields (archived too) as GeoJSON, and nothing from another company", async () => {
    const u = await signup();
    const ws = await workspaceOf(u.id);
    const a = await field(ws, "Alpha");
    const b = await field(ws, "Beta");
    await fields.archive(ws, u.id, b);
    await client.query(`INSERT INTO season_records (field_id, season, crop, updated_at) VALUES ($1, 2026, 'corn', now())`, [a]);
    const foreign = await workspaceOf((await signup()).id);
    await field(foreign, "Foreign");

    const out = await exporter.build(ws, u.id);
    expect(out.workspace?.id).toBe(ws);
    expect(out.fields.type).toBe("FeatureCollection");
    expect(out.fields.features.map((f) => f.properties.name).sort()).toEqual(["Alpha", "Beta"]);
    expect(out.fields.features[0]?.geometry).toMatchObject({ type: "MultiPolygon" });
    expect(out.seasonRecords).toHaveLength(1);
    expect(JSON.stringify(out)).not.toContain("Foreign");
    expect(out).toHaveProperty("recommendations");
    expect(out).toHaveProperty("decisions");
    expect(out).toHaveProperty("plans");
  });
});
