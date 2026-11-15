import { mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
import { Mailer, linkIn } from "../src/mail/mailer.js";
import { WorkspacesService } from "../src/workspaces/workspaces.service.js";

/** Email verification, password reset, uniform sign-up, invitations that need a verified email. */
const MIGRATIONS = fileURLToPath(new URL("../../../prisma/migrations/", import.meta.url));
const IMAGE = "terrasight-postgis:17";
const DOCKERFILE_DIR = fileURLToPath(new URL("../../../infra/postgis/", import.meta.url));

let container: StartedPostgreSqlContainer;
let client: pg.Client;
let prisma: PrismaService;
let auth: AuthService;
let workspaces: WorkspacesService;
let mailer: Mailer;
let outbox: string;

const rand = () => Math.random().toString(36).slice(2);
const tokenIn = (link: string) => link.split("/").pop()!;
const code = async (p: Promise<unknown>) =>
  p.then(
    () => null,
    (e: unknown) => (e instanceof ProblemException ? e.getStatus() : "other"),
  );
const mailsTo = (to: string) =>
  readdirSync(outbox)
    .map((f) => JSON.parse(readFileSync(join(outbox, f), "utf8")) as { to: string; subject: string; text: string })
    .filter((m) => m.to === to);
const signup = (email: string, sendMail = true) =>
  auth.signup({ email, password: "a long enough password", name: "Ira", uiLanguage: "en" }, sendMail);

beforeAll(async () => {
  await GenericContainer.fromDockerfile(DOCKERFILE_DIR).build(IMAGE, { deleteOnExit: false });
  container = await new PostgreSqlContainer(IMAGE).start();
  client = new pg.Client({ connectionString: container.getConnectionUri() });
  await client.connect();
  for (const dir of readdirSync(MIGRATIONS)
    .filter((d) => /^\d+_/.test(d))
    .sort())
    await client.query(readFileSync(`${MIGRATIONS}${dir}/migration.sql`, "utf8"));
  outbox = join(mkdtempSync(join(tmpdir(), "ts-verify-")), "outbox");
  const env = loadEnv({
    DATABASE_URL: container.getConnectionUri(),
    RABBITMQ_URL: "amqp://localhost:5672",
    JWT_SECRET: "integration-test-secret-0123456789abcdef",
    NODE_ENV: "test",
    UPLOADS_DIR: join(outbox, ".."),
    WEB_ORIGIN: "https://app.example.test",
  });
  prisma = new PrismaService(env);
  mailer = new Mailer(env);
  auth = new AuthService(prisma, env, mailer);
  workspaces = new WorkspacesService(prisma, env, mailer);
});

afterAll(async () => {
  await prisma?.onModuleDestroy();
  await client?.end();
  await container?.stop();
});

describe("email verification", () => {
  it("sign-up emails a single-use 24 h link, stores only its hash, and opens no session", async () => {
    const email = `${rand()}@example.com`;
    expect(await signup(email)).toBeUndefined();
    const [mail] = mailsTo(email);
    const link = linkIn(mail!.text)!;
    expect(link).toMatch(/^https:\/\/app\.example\.test\/verify\/[\w-]{43}$/);
    const token = tokenIn(link);
    const row = (await client.query(`SELECT * FROM users WHERE email = $1`, [email])).rows[0];
    expect(row.email_verified_at).toBeNull();
    expect(row.verify_token_hash).toBe(hashToken(token));
    expect(JSON.stringify(row)).not.toContain(token);
    expect(new Date(row.verify_expires_at).getTime() - Date.now()).toBeGreaterThan(23.9 * 36e5);

    await auth.verifyEmail(token);
    expect((await client.query(`SELECT email_verified_at FROM users WHERE email = $1`, [email])).rows[0].email_verified_at).not.toBeNull();
    expect(await code(auth.verifyEmail(token))).toBe(410);
    expect(await code(auth.verifyEmail("nope"))).toBe(410);
  });

  it("an expired link is refused and resend issues a new one", async () => {
    const email = `${rand()}@example.com`;
    await signup(email);
    const token = tokenIn(linkIn(mailsTo(email)[0]!.text)!);
    await client.query(`UPDATE users SET verify_expires_at = now() - interval '1 minute' WHERE email = $1`, [email]);
    expect(await code(auth.verifyEmail(token))).toBe(410);
    const id = (await client.query(`SELECT id FROM users WHERE email = $1`, [email])).rows[0].id as string;
    expect(await auth.resendVerification(id)).toEqual({ alreadyVerified: false });
    const mails = mailsTo(email);
    expect(mails).toHaveLength(2);
    await auth.verifyEmail(tokenIn(linkIn(mails[1]!.text)!));
    expect(await auth.resendVerification(id)).toEqual({ alreadyVerified: true });
  });

  it("signing up with an existing address answers the same and emails 'you already have an account'", async () => {
    const email = `${rand()}@example.com`;
    await signup(email);
    const before = (await client.query(`SELECT id, password_hash FROM users WHERE email = $1`, [email])).rows[0];
    expect(await signup(email.toUpperCase())).toBeUndefined();
    const after = (await client.query(`SELECT id, password_hash, verify_token_hash FROM users WHERE email = $1`, [email])).rows;
    expect(after).toHaveLength(1);
    expect(after[0].password_hash).toBe(before.password_hash); // the existing password is untouched
    const mails = mailsTo(email);
    expect(mails).toHaveLength(2);
    expect(mails[1]!.subject).toMatch(/already have/i);
    expect(mails[1]!.text).not.toMatch(/\/verify\//);
  });

  it("a throttled address gets no email but the same answer", async () => {
    const email = `${rand()}@example.com`;
    expect(await signup(email, false)).toBeUndefined();
    expect(mailsTo(email)).toHaveLength(0);
  });
});

describe("invitations need a verified email", () => {
  it("accept is refused until the invited account verified its address", async () => {
    const owner = (
      await client.query(`INSERT INTO users (id, email, password_hash, name) VALUES (gen_random_uuid(), $1, 'x', 'O') RETURNING id`, [`${rand()}@example.com`])
    ).rows[0].id as string;
    const ws = (
      await client.query(`INSERT INTO workspaces (id, name, slug, time_zone) VALUES (gen_random_uuid(), 'Co', $1, 'UTC') RETURNING id`, [`co-${rand()}`])
    ).rows[0].id as string;
    await client.query(`INSERT INTO memberships (workspace_id, user_id, role) VALUES ($1, $2, 'owner')`, [ws, owner]);

    const email = `${rand()}@example.com`;
    await signup(email);
    const userId = (await client.query(`SELECT id FROM users WHERE email = $1`, [email])).rows[0].id as string;
    const inv = await workspaces.invite(ws, { id: owner, role: "owner" }, email, "agronomist");
    // The invitation is emailed too.
    expect(mailsTo(email).some((m) => linkIn(m.text)?.endsWith(`/invite/${inv.token}`))).toBe(true);

    expect(await code(workspaces.accept(inv.token, userId))).toBe(403);
    expect((await client.query(`SELECT * FROM memberships WHERE user_id = $1`, [userId])).rows).toHaveLength(0);

    await auth.verifyEmail(tokenIn(linkIn(mailsTo(email).find((m) => /\/verify\//.test(m.text))!.text)!));
    expect(await workspaces.accept(inv.token, userId)).toMatchObject({ workspaceId: ws, role: "agronomist" });
  });
});

describe("password reset", () => {
  it("is uniform, single use, expires, verifies the email and revokes every session", async () => {
    const email = `${rand()}@example.com`;
    await signup(email);
    const userId = (await client.query(`SELECT id FROM users WHERE email = $1`, [email])).rows[0].id as string;
    const session = await auth.login(email, "a long enough password");

    // Unknown address: no email, no error.
    const ghost = `${rand()}@example.com`;
    expect(await auth.forgotPassword(ghost)).toBeUndefined();
    expect(mailsTo(ghost)).toHaveLength(0);

    await auth.forgotPassword(email);
    const mail = mailsTo(email).find((m) => /\/reset\//.test(m.text))!;
    const token = tokenIn(linkIn(mail.text)!);
    const row = (await client.query(`SELECT reset_token_hash, reset_expires_at FROM users WHERE id = $1`, [userId])).rows[0];
    expect(row.reset_token_hash).toBe(hashToken(token));
    const ttl = new Date(row.reset_expires_at).getTime() - Date.now();
    expect(ttl).toBeGreaterThan(59 * 6e4);
    expect(ttl).toBeLessThanOrEqual(60 * 6e4);

    await auth.resetPassword(token, "a brand new password!");
    expect(await code(auth.login(email, "a long enough password"))).toBe(401);
    expect((await auth.login(email, "a brand new password!")).userId).toBe(userId);
    expect((await client.query(`SELECT email_verified_at FROM users WHERE id = $1`, [userId])).rows[0].email_verified_at).not.toBeNull();
    // The old session's refresh token is dead; the link works once.
    expect((await auth.rotate(session.refresh).catch((e: unknown) => e)) instanceof ProblemException).toBe(true);
    expect(await code(auth.resetPassword(token, "yet another password"))).toBe(410);
  });

  it("an expired reset link is refused", async () => {
    const email = `${rand()}@example.com`;
    await signup(email);
    await auth.forgotPassword(email);
    const token = tokenIn(linkIn(mailsTo(email).find((m) => /\/reset\//.test(m.text))!.text)!);
    await client.query(`UPDATE users SET reset_expires_at = now() - interval '1 minute' WHERE email = $1`, [email]);
    expect(await code(auth.resetPassword(token, "a brand new password!"))).toBe(410);
  });
});
