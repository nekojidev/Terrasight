import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { loadLibrary } from "@terrasight/library";
import { GenericContainer } from "testcontainers";
import pg from "pg";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { loadEnv } from "../src/config/config.js";
import { PrismaService } from "../src/db/prisma.service.js";
import { FakeBroker } from "../src/messaging/fake-broker.js";
import { OutboxService } from "../src/messaging/outbox.service.js";
import { NotificationsService } from "../src/notifications/notifications.service.js";
import { QUEUES } from "../src/messaging/topology.js";
import { RecommendationsService, type CommitJob } from "../src/recommendations/recommendations.service.js";

/**
 * Commit / Undo race (S-04.04; one of the three integration suites kept in the hackathon): an accept never reaches the
 * owner; an "ask the owner" becomes a Decision only after 8 s, Undo within 8 s cancels it, and the two can never both win.
 */
const MIGRATIONS = fileURLToPath(new URL("../../../prisma/migrations/", import.meta.url));
const DATA_DIR = fileURLToPath(new URL("../../../data/", import.meta.url));
const IMAGE = "terrasight-postgis:17";
const DOCKERFILE_DIR = fileURLToPath(new URL("../../../infra/postgis/", import.meta.url));
const SQUARE =
  "ST_Multi(ST_GeomFromText('POLYGON((-100.9 37.9,-100.89 37.9,-100.89 37.91,-100.9 37.91,-100.9 37.9))', 4326))";

let container: StartedPostgreSqlContainer;
let client: pg.Client;
let prisma: PrismaService;
let recs: RecommendationsService;
let ws: string;
let user: string;

async function openItem(): Promise<string> {
  const f = await client.query(
    `INSERT INTO fields (id, workspace_id, name, alias_no, geom, centroid, area_ha, tier)
     VALUES (gen_random_uuid(), $1, 'Pivot 14', (SELECT coalesce(max(alias_no), 0) + 1 FROM fields WHERE workspace_id = $1), ${SQUARE}, ST_Centroid(${SQUARE}), 50, 'A') RETURNING id`,
    [ws],
  );
  const r = await client.query(
    `INSERT INTO recommendations (id, workspace_id, field_id, type, subject, season, level, confidence, tier, deadline, irreversible, updated_at)
     VALUES (gen_random_uuid(), $1, $2, 'disease', 'barley_yellow_dwarf', 2027, 'high', 'medium', 'A', '2026-11-18', true, now()) RETURNING id`,
    [ws, f.rows[0].id],
  );
  return r.rows[0].id as string;
}

/** The commit job the accept wrote to the outbox (the relay would publish it with an 8 s delay). */
async function commitJob(id: string): Promise<CommitJob> {
  const rows = await prisma.system.outbox.findMany({
    where: { routingKey: QUEUES.recommendationCommit },
    orderBy: { id: "desc" },
  });
  const job = rows.map((r) => (r.payload as unknown as { data: CommitJob }).data).find((d) => d.id === id);
  if (!job) throw new Error("no commit job");
  return job;
}

const reportItems = (id: string) => prisma.system.reportItem.count({ where: { recommendationId: id } });
const status = async (id: string) =>
  (await prisma.system.recommendation.findUniqueOrThrow({ where: { id } })).status;

beforeAll(async () => {
  await GenericContainer.fromDockerfile(DOCKERFILE_DIR).build(IMAGE, { deleteOnExit: false });
  container = await new PostgreSqlContainer(IMAGE).start();
  client = new pg.Client({ connectionString: container.getConnectionUri() });
  await client.connect();
  for (const dir of readdirSync(MIGRATIONS)
    .filter((d) => /^\d+_/.test(d))
    .sort()) {
    await client.query(readFileSync(`${MIGRATIONS}${dir}/migration.sql`, "utf8"));
  }
  const env = loadEnv({
    DATABASE_URL: container.getConnectionUri(),
    RABBITMQ_URL: "amqp://localhost:5672",
    JWT_SECRET: "integration-test-secret-0123456789abcdef",
    NODE_ENV: "test",
    DATA_DIR,
    // Tests never see the recorded fixtures.
    FIXTURES_DIR: "/nonexistent/fixtures",
  });
  prisma = new PrismaService(env);
  const outbox = new OutboxService(prisma, new FakeBroker(), env);
  recs = new RecommendationsService(
    prisma,
    outbox,
    new NotificationsService(prisma, outbox),
    loadLibrary(DATA_DIR),
  );
  ws = (
    await client.query(
      `INSERT INTO workspaces (id, name, slug, time_zone) VALUES (gen_random_uuid(), 'Prairie Field Co.', 'prairie', 'America/Chicago') RETURNING id`,
    )
  ).rows[0].id;
  user = (
    await client.query(
      `INSERT INTO users (id, email, password_hash, name) VALUES (gen_random_uuid(), 'a@example.com', 'x', 'Agronomist') RETURNING id`,
    )
  ).rows[0].id;
});

afterEach(() => {
  vi.useRealTimers();
});

afterAll(async () => {
  await prisma?.system.$disconnect();
  await client?.end();
  await container?.stop();
});

/** Moves the app clock (Date only; database time is not used by the lifecycle). */
function clock(at: number) {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(at);
}

describe("accept → 8 s (never reaches the owner)", () => {
  it("Undo within 8 s returns the item to Open and nothing is committed", async () => {
    const id = await openItem();
    const t0 = Date.now();
    clock(t0);
    const accepted = await recs.accept(ws, user, id, {});
    expect(accepted.status).toBe("accepted");
    expect(new Date(accepted.undoUntil!).getTime()).toBe(t0 + 8_000);
    const job = await commitJob(id);
    clock(t0 + 3_000);
    expect((await recs.undo(ws, user, id)).status).toBe("open");
    clock(t0 + 8_500);
    expect(await recs.commit(job)).toBe("skipped");
    expect(await reportItems(id)).toBe(0);
  });

  it("after 8 s Undo is refused (409) and the commit finalises the accept without a decision", async () => {
    const id = await openItem();
    const t0 = Date.now();
    clock(t0);
    await recs.accept(ws, user, id, { note: "Please check this week" });
    const job = await commitJob(id);
    clock(t0 + 8_100);
    await expect(recs.undo(ws, user, id)).rejects.toMatchObject({ status: 409 });
    expect(await recs.commit(job)).toBe("committed");
    expect(await recs.commit(job)).toBe("skipped"); // redelivery is harmless
    expect(await status(id)).toBe("in_report");
    expect(await reportItems(id)).toBe(0);
  });

  it("a commit delivered early does nothing (the consumer re-queues it)", async () => {
    const id = await openItem();
    const t0 = Date.now();
    clock(t0);
    await recs.accept(ws, user, id, {});
    clock(t0 + 7_000);
    expect(await recs.commit(await commitJob(id))).toBe("early");
    expect(await status(id)).toBe("accepted");
  });

  it("an old commit job is ignored after Undo and a new Accept", async () => {
    const id = await openItem();
    const t0 = Date.now();
    clock(t0);
    await recs.accept(ws, user, id, {});
    const first = await commitJob(id);
    clock(t0 + 1_000);
    await recs.undo(ws, user, id);
    clock(t0 + 2_000);
    await recs.accept(ws, user, id, {});
    const second = await commitJob(id);
    clock(t0 + 8_500); // 8.5 s after the first accept, 6.5 s after the second
    expect(await recs.commit(first)).toBe("skipped");
    expect(await status(id)).toBe("accepted");
    clock(t0 + 10_100);
    expect(await recs.commit(second)).toBe("committed");
    expect(await reportItems(id)).toBe(0);
  });

  it("Undo and commit racing at the boundary: exactly one wins", async () => {
    for (let i = 0; i < 5; i++) {
      const id = await openItem();
      const t0 = Date.now();
      clock(t0);
      await recs.accept(ws, user, id, {});
      const job = await commitJob(id);
      clock(t0 + 8_000 + (i % 2)); // right on the edge of the window
      const [undo, commit] = await Promise.allSettled([recs.undo(ws, user, id), recs.commit(job)]);
      const undone = undo.status === "fulfilled";
      const committed = commit.status === "fulfilled" && commit.value === "committed";
      expect(undone !== committed).toBe(true);
      expect(await reportItems(id)).toBe(0);
      expect(await status(id)).toBe(committed ? "in_report" : "open");
    }
  });
});

describe("ask the owner → 8 s → Decision", () => {
  it("from Open: accept implied, Undo within 8 s cancels everything", async () => {
    const id = await openItem();
    const t0 = Date.now();
    clock(t0);
    const asked = await recs.askOwner(ws, user, id, { note: "Needs your OK" });
    expect(asked.status).toBe("accepted");
    expect(asked.decisionPending).toBe(true);
    expect(new Date(asked.undoUntil!).getTime()).toBe(t0 + 8_000);
    const job = await commitJob(id);
    clock(t0 + 3_000);
    const undone = await recs.undo(ws, user, id);
    expect(undone.status).toBe("open");
    expect(undone.decisionPending).toBe(false);
    clock(t0 + 8_500);
    expect(await recs.commit(job)).toBe("skipped");
    expect(await reportItems(id)).toBe(0);
  });

  it("after 8 s the commit creates the decision with the note; redelivery and a second ask are harmless", async () => {
    const id = await openItem();
    const t0 = Date.now();
    clock(t0);
    await recs.askOwner(ws, user, id, { note: "Needs your OK" });
    const job = await commitJob(id);
    clock(t0 + 7_000);
    expect(await recs.commit(job)).toBe("early");
    clock(t0 + 8_100);
    await expect(recs.undo(ws, user, id)).rejects.toMatchObject({ status: 409 });
    expect(await recs.commit(job)).toBe("committed");
    expect(await recs.commit(job)).toBe("skipped");
    expect(await status(id)).toBe("in_report");
    const again = await recs.askOwner(ws, user, id, { note: "again" }); // idempotent
    expect(again.decisionPending).toBe(false);
    expect(await reportItems(id)).toBe(1);
    const item = await prisma.system.reportItem.findFirstOrThrow({ where: { recommendationId: id } });
    expect(item.note).toBe("Needs your OK");
    expect(item.askedBy).toBe(user);
    expect(item.text).toMatchObject({ fieldName: "Pivot 14", level: "high", deadline: "2026-11-18" });
    const audit = await prisma.system.auditLog.count({
      where: { target: id, action: "recommendation.ask_owner" },
    });
    expect(audit).toBe(1);
  });

  it("from an already committed accept: creates the decision, Undo keeps the accept", async () => {
    const id = await openItem();
    const t0 = Date.now();
    clock(t0);
    await recs.accept(ws, user, id, {});
    clock(t0 + 8_100);
    expect(await recs.commit(await commitJob(id))).toBe("committed");
    expect(await reportItems(id)).toBe(0);
    clock(t0 + 20_000);
    const asked = await recs.askOwner(ws, user, id, {});
    expect(asked.status).toBe("in_report");
    expect(asked.decisionPending).toBe(true);
    clock(t0 + 22_000);
    const undone = await recs.undo(ws, user, id);
    expect(undone.status).toBe("in_report");
    expect(undone.decisionPending).toBe(false);
    clock(t0 + 30_000);
    await recs.askOwner(ws, user, id, { note: "n" });
    const job = await commitJob(id);
    clock(t0 + 38_100);
    expect(await recs.commit(job)).toBe("committed");
    expect(await reportItems(id)).toBe(1);
    expect(await status(id)).toBe("in_report");
  });

  it("asking during the accept window supersedes the plain accept job", async () => {
    const id = await openItem();
    const t0 = Date.now();
    clock(t0);
    await recs.accept(ws, user, id, {});
    const accept = await commitJob(id);
    clock(t0 + 2_000);
    await recs.askOwner(ws, user, id, {});
    clock(t0 + 8_500);
    expect(await recs.commit(accept)).toBe("skipped");
    clock(t0 + 10_100);
    expect(await recs.commit(await commitJob(id))).toBe("committed");
    expect(await reportItems(id)).toBe(1);
  });

  it("Undo and the ask commit racing at the boundary: exactly one wins", async () => {
    for (let i = 0; i < 5; i++) {
      const id = await openItem();
      const t0 = Date.now();
      clock(t0);
      await recs.askOwner(ws, user, id, {});
      const job = await commitJob(id);
      clock(t0 + 8_000 + (i % 2));
      const [undo, commit] = await Promise.allSettled([recs.undo(ws, user, id), recs.commit(job)]);
      const undone = undo.status === "fulfilled";
      const committed = commit.status === "fulfilled" && commit.value === "committed";
      expect(undone !== committed).toBe(true);
      expect(await reportItems(id)).toBe(committed ? 1 : 0);
      expect(await status(id)).toBe(committed ? "in_report" : "open");
    }
  });
});

describe("snooze", () => {
  it("snoozes until the next 06:00 in the workspace time zone, with the same 8 s Undo", async () => {
    const id = await openItem();
    clock(Date.parse("2026-11-14T15:00:00Z")); // 09:00 in Chicago
    const s = await recs.snooze(ws, user, id);
    expect(s.status).toBe("snoozed");
    expect(new Date(s.snoozedUntil!).toISOString()).toBe("2026-11-15T12:00:00.000Z"); // 06:00 CST
    clock(Date.parse("2026-11-14T15:00:05Z"));
    expect((await recs.undo(ws, user, id)).status).toBe("open");
    await recs.snooze(ws, user, id);
    clock(Date.parse("2026-11-14T15:00:20Z"));
    await expect(recs.undo(ws, user, id)).rejects.toMatchObject({ status: 409 });
  });
});
