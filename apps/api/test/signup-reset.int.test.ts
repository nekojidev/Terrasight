import { existsSync, mkdtempSync, readdirSync, readFileSync } from "node:fs";
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

/** Uniform sign-up (no email verification, PD v2.12) and password reset. */
const MIGRATIONS = fileURLToPath(new URL("../../../prisma/migrations/", import.meta.url));
const IMAGE = "terrasight-postgis:17";
const DOCKERFILE_DIR = fileURLToPath(new URL("../../../infra/postgis/", import.meta.url));

let container: StartedPostgreSqlContainer;
let client: pg.Client;
let prisma: PrismaService;
let auth: AuthService;
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
  (existsSync(outbox) ? readdirSync(outbox) : [])
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
});

afterAll(async () => {
  await prisma?.onModuleDestroy();
  await client?.end();
  await container?.stop();
});

describe("sign-up", () => {
  it("creates the account at once: no verification email, no session, password stored hashed", async () => {
    const email = `${rand()}@example.com`;
    expect(await signup(email)).toBeUndefined();
    expect(mailsTo(email)).toHaveLength(0);
    const row = (await client.query(`SELECT * FROM users WHERE email = $1`, [email])).rows[0];
    expect(row.password_hash).toMatch(/^\$argon2id\$/);
    expect("email_verified_at" in row).toBe(false);
    expect((await auth.login(email, "a long enough password")).userId).toBe(row.id);
  });

  it("signing up with an existing address answers the same and emails 'you already have an account'", async () => {
    const email = `${rand()}@example.com`;
    await signup(email);
    const before = (await client.query(`SELECT id, password_hash FROM users WHERE email = $1`, [email])).rows[0];
    expect(await signup(email.toUpperCase())).toBeUndefined();
    const after = (await client.query(`SELECT id, password_hash FROM users WHERE email = $1`, [email])).rows;
    expect(after).toHaveLength(1);
    expect(after[0].password_hash).toBe(before.password_hash); // the existing password is untouched
    const mails = mailsTo(email);
    expect(mails).toHaveLength(1);
    expect(mails[0]!.subject).toMatch(/already have/i);
  });

  it("a throttled address gets no email but the same answer", async () => {
    const email = `${rand()}@example.com`;
    await signup(email);
    expect(await signup(email, false)).toBeUndefined();
    expect(mailsTo(email)).toHaveLength(0);
  });
});

describe("password reset", () => {
  it("is uniform, single use, expires and revokes every session", async () => {
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
