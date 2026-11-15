import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { GenericContainer } from "testcontainers";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/** Two roles (PD v2.10): the migration maps admin / viewer → owner in memberships and invitations. */
const MIGRATIONS = fileURLToPath(new URL("../../../prisma/migrations/", import.meta.url));
const IMAGE = "terrasight-postgis:17";
const DOCKERFILE_DIR = fileURLToPath(new URL("../../../infra/postgis/", import.meta.url));
const TWO_ROLES = "20261115200000_two_roles";

let container: StartedPostgreSqlContainer;
let client: pg.Client;

beforeAll(async () => {
  await GenericContainer.fromDockerfile(DOCKERFILE_DIR).build(IMAGE, { deleteOnExit: false });
  container = await new PostgreSqlContainer(IMAGE).start();
  client = new pg.Client({ connectionString: container.getConnectionUri() });
  await client.connect();
});

afterAll(async () => {
  await client?.end();
  await container?.stop();
});

describe("two-roles migration", () => {
  it("maps viewer and admin to owner, keeps owner and agronomist, and drops the old values", async () => {
    const dirs = readdirSync(MIGRATIONS)
      .filter((d) => /^\d+_/.test(d))
      .sort();
    for (const dir of dirs.filter((d) => d < TWO_ROLES))
      await client.query(readFileSync(`${MIGRATIONS}${dir}/migration.sql`, "utf8"));

    const ws = (
      await client.query(
        `INSERT INTO workspaces (id, name, slug, time_zone) VALUES (gen_random_uuid(), 'Co', 'co', 'UTC') RETURNING id`,
      )
    ).rows[0].id as string;
    for (const role of ["owner", "admin", "agronomist", "viewer"]) {
      const u = (
        await client.query(
          `INSERT INTO users (id, email, password_hash, name) VALUES (gen_random_uuid(), $1, 'x', $2) RETURNING id`,
          [`${role}@example.com`, role],
        )
      ).rows[0].id as string;
      await client.query(`INSERT INTO memberships (workspace_id, user_id, role) VALUES ($1, $2, $3)`, [
        ws,
        u,
        role,
      ]);
      await client.query(
        `INSERT INTO invitations (id, workspace_id, email, role, token_hash, expires_at)
         VALUES (gen_random_uuid(), $1, $2, $3, $4, now() + interval '1 day')`,
        [ws, `inv-${role}@example.com`, role, `token-${role}`],
      );
    }

    await client.query(readFileSync(`${MIGRATIONS}${TWO_ROLES}/migration.sql`, "utf8"));

    const m = await client.query(
      `SELECT u.name AS was, m.role::text AS role FROM memberships m JOIN users u ON u.id = m.user_id`,
    );
    expect(Object.fromEntries(m.rows.map((r) => [r.was, r.role]))).toEqual({
      owner: "owner",
      admin: "owner",
      viewer: "owner",
      agronomist: "agronomist",
    });
    const i = await client.query(`SELECT email, role::text AS role FROM invitations`);
    expect(Object.fromEntries(i.rows.map((r) => [r.email, r.role]))).toEqual({
      "inv-owner@example.com": "owner",
      "inv-admin@example.com": "owner",
      "inv-viewer@example.com": "owner",
      "inv-agronomist@example.com": "agronomist",
    });
    const e = await client.query(`SELECT unnest(enum_range(NULL::"Role"))::text AS v`);
    expect(e.rows.map((r) => r.v)).toEqual(["owner", "agronomist"]);
  });
});
