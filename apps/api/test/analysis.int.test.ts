import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { loadLibrary, type Library, type PestModel } from "@terrasight/library";
import type { Envelope } from "@terrasight/shared";
import { forecastCell, POWER_PARAMETERS, type DailyWeather, type Forecast } from "@terrasight/sources";
import { GenericContainer } from "testcontainers";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { AnalysisService, type FieldCheckJob } from "../src/analysis/analysis.service.js";
import { FieldCheckConsumer } from "../src/analysis/field-check.consumer.js";
import { EvalInputsService } from "../src/analysis/eval-inputs.service.js";
import { ForecastService } from "../src/analysis/forecast.service.js";
import { AnalysisScheduler } from "../src/analysis/scheduler.js";
import { ToolError, ToolExecutor } from "../src/assistant/executor.js";
import type { ScenariosService } from "../src/scenarios/scenarios.service.js";
import { HistoryService } from "../src/history/history.service.js";
import { RateLimitService } from "../src/auth/rate-limit.js";
import { loadEnv, type Env } from "../src/config/config.js";
import { PrismaService } from "../src/db/prisma.service.js";
import type { EventsService } from "../src/events/events.service.js";
import { GeoService } from "../src/geo/geo.service.js";
import { FakeBroker } from "../src/messaging/fake-broker.js";
import { OutboxService } from "../src/messaging/outbox.service.js";
import { QUEUES } from "../src/messaging/topology.js";
import { RedisService } from "../src/redis/redis.service.js";
import { SeasonsService } from "../src/seasons/seasons.service.js";
import { SourcesService } from "../src/sources/sources.service.js";

/**
 * Analysis run end to end on PostGIS (S-03.02; one of the three integration suites kept in the hackathon):
 * start → one field.check per field → evaluators → recommendation upsert + level history → run summary,
 * plus attaching to an active check and the 06:00 scheduler. No network: weather and forecast come from the cache.
 */
const MIGRATIONS = fileURLToPath(new URL("../../../prisma/migrations/", import.meta.url));
const DATA_DIR = fileURLToPath(new URL("../../../data/", import.meta.url));
const IMAGE = "terrasight-postgis:17";
const DOCKERFILE_DIR = fileURLToPath(new URL("../../../infra/postgis/", import.meta.url));
const AS_OF = "2026-11-14";
// Pivot near Garden City, KS (us-southern-plains); other points sit in other weather cells.
const pivot = (lon: number, lat: number) =>
  `ST_Multi(ST_Buffer(ST_SetSRID(ST_MakePoint(${lon}, ${lat}), 4326)::geography, 390)::geometry)`;
const GARDEN_CITY: [number, number] = [-101.05474, 38.09913];

let container: StartedPostgreSqlContainer;
let client: pg.Client;
let env: Env;
let prisma: PrismaService;
let analysis: AnalysisService;
let consumer: FieldCheckConsumer;
let scheduler: AnalysisScheduler;
let sources: SourcesService;
let geo: GeoService;

/** The rootworm model as it will look once verified; the citation here is a test placeholder. */
function verifiedRootworm(lib: Library): PestModel {
  const m = structuredClone(lib.pestModels.models.find((x) => x.pest === "western_corn_rootworm")!);
  m.enabled = true;
  m.thresholds.repeatSeasons = {
    ...m.thresholds.repeatSeasons!,
    value: 1,
    verified: true,
    verifiedBy: "integration test",
    verifiedAt: AS_OF,
    source: {
      title: "Test citation",
      publisher: "test",
      url: "https://example.org",
      accessed: AS_OF,
      appliesTo: [],
      type: "extension" as const,
    },
  };
  return m;
}

async function workspaceWithField(
  name: string,
  at: [number, number] = GARDEN_CITY,
): Promise<{ ws: string; field: string }> {
  const PIVOT = pivot(at[0], at[1]);
  const ws = await client.query(
    `INSERT INTO workspaces (id, name, slug, time_zone) VALUES (gen_random_uuid(), 'Prairie Field Co.', $1, 'America/Chicago') RETURNING id`,
    [`prairie-${Math.random().toString(36).slice(2)}`],
  );
  const wsId = ws.rows[0].id as string;
  const f = await client.query(
    `INSERT INTO fields (id, workspace_id, name, alias_no, geom, centroid, area_ha, tier, country, admin_code, region_id)
     VALUES (gen_random_uuid(), $1, $2, 1, ${PIVOT}, ST_Centroid(${PIVOT}), 47.6, 'A', 'US', 'US-KS', 'us-southern-plains') RETURNING id`,
    [wsId, name],
  );
  const fieldId = f.rows[0].id as string;
  for (const [season, crop] of [
    [2023, "sorghum"],
    [2024, "corn"],
    [2025, "corn"],
  ] as const) {
    await client.query(
      `INSERT INTO crop_seasons (field_id, season, main_crop, confidence, source, updated_at) VALUES ($1, $2, $3, 0.95, 'cdl', now())`,
      [fieldId, season, crop],
    );
  }
  return { ws: wsId, field: fieldId };
}

/** Puts POWER weather and a forecast for the field's cells into the source cache, as a gather would have. */
async function seedWeather(fieldId: string, withForecast = true): Promise<void> {
  const geom = await geo.fieldGeometry(fieldId);
  const dates: string[] = [];
  for (let t = Date.parse("2025-01-01T00:00:00Z"); t <= Date.parse("2026-11-10T00:00:00Z"); t += 864e5)
    dates.push(new Date(t).toISOString().slice(0, 10));
  const values = Object.fromEntries(
    POWER_PARAMETERS.map((p) => [p, dates.map(() => (p === "PRECTOTCORR" ? 1 : 12))]),
  ) as DailyWeather["values"];
  const weather: DailyWeather = { dates, values, cell: { lon: -101.25, lat: 38 }, elevationM: 900 };
  const adapter = sources.adapter("power")!;
  await sources.store(
    adapter,
    sources.key(adapter, geom, AS_OF),
    { source: "power" },
    { status: "done", payload: weather, dataDate: "2026-11-10", attribution: "NASA POWER" },
    "live",
  );
  if (!withForecast) return;
  const cell = forecastCell(geom.centroid.lat, geom.centroid.lon);
  const days = ["2026-11-11", "2026-11-12", "2026-11-13", "2026-11-14", "2026-11-15", "2026-11-16"].map(
    (date, i) => ({
      date,
      tminC: 2,
      tmaxC: 14,
      tmeanC: 8,
      precipMm: 0,
      et0Mm: 1,
      ...(date < AS_OF
        ? { origin: "observed" as const }
        : { origin: "forecast" as const, forecastDay: i - 2 }),
    }),
  );
  const forecast: Forecast = {
    provider: "open-meteo",
    cell,
    issuedAt: new Date().toISOString(),
    days,
    attribution: "Open-Meteo",
  };
  await client.query(
    `INSERT INTO source_cache (key, source, params, payload, origin, fetched_at, expires_at) VALUES ($1, 'forecast', '{}', $2, 'live', now(), now() + interval '6 hours')
     ON CONFLICT (key) DO UPDATE SET payload = EXCLUDED.payload, fetched_at = now()`,
    [`forecast:${cell.key}`, JSON.stringify(forecast)],
  );
}

/** Field-check jobs written to the outbox for a run (the relay would publish them). */
async function jobsFor(runId: string): Promise<Array<Envelope<FieldCheckJob>>> {
  const rows = await prisma.system.outbox.findMany({ where: { routingKey: QUEUES.fieldCheck } });
  return rows
    .map((r) => r.payload as unknown as Envelope<FieldCheckJob>)
    .filter((e) => e.data.runId === runId);
}

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
  env = loadEnv({
    DATABASE_URL: container.getConnectionUri(),
    RABBITMQ_URL: "amqp://localhost:5672",
    JWT_SECRET: "integration-test-secret-0123456789abcdef",
    NODE_ENV: "test",
    DATA_DIR,
  });
  // No network in this suite: every live call fails, so only cached data is used.
  vi.stubGlobal("fetch", async () => {
    throw new Error("network disabled in tests");
  });
  prisma = new PrismaService(env);
  const broker = new FakeBroker();
  const outbox = new OutboxService(prisma, broker, env);
  const events = { registerStateProvider: () => undefined } as unknown as EventsService;
  const limits = new RateLimitService(new RedisService(env));
  const real = loadLibrary(DATA_DIR);
  const lib: Library = { ...real, enabledModels: [verifiedRootworm(real)] };
  geo = new GeoService(prisma, lib);
  sources = new SourcesService(prisma, env);
  analysis = new AnalysisService(prisma, outbox, events);
  const inputsService = new EvalInputsService(
    lib,
    prisma,
    new ForecastService(prisma, limits, env),
    sources,
    new SeasonsService(prisma, env),
    geo,
    limits,
  );
  const scenariosStub = { upsertRecommendation: async () => false } as unknown as ScenariosService;
  consumer = new FieldCheckConsumer(broker, env, lib, prisma, analysis, inputsService, scenariosStub);
  scheduler = new AnalysisScheduler(env, prisma, analysis);
});

afterAll(async () => {
  vi.unstubAllGlobals();
  await prisma?.system.$disconnect();
  await client?.end();
  await container?.stop();
});

describe("analysis run", () => {
  it("checks every field, creates the rootworm planning item and writes the summary", async () => {
    const { ws, field } = await workspaceWithField("Pivot 12");
    await seedWeather(field);
    const run = await analysis.start(ws, "manual", null, AS_OF);
    expect(run.fields).toEqual([expect.objectContaining({ fieldId: field, status: "waiting" })]);
    for (const job of await jobsFor(run.id)) await consumer.handle(job);

    const done = await analysis.view(ws, run.id);
    expect(done.status).toBe("done");
    expect(done.fields[0]).toMatchObject({ status: "ok", dataDate: "2026-11-13", newRecommendations: 1 });
    const recs = await prisma.system.recommendation.findMany({ where: { fieldId: field } });
    expect(recs).toHaveLength(1);
    // Corn in 2024 and 2025, crop for 2027 not chosen → moderate; capped at medium until scouted; deadline =
    // typical corn sowing in us-southern-plains (crop calendar).
    expect(recs[0]).toMatchObject({
      type: "pest",
      subject: "western_corn_rootworm",
      season: 2027,
      level: "moderate",
      confidence: "medium",
      planning: true,
    });
    expect(recs[0]!.deadline?.toISOString().slice(0, 10)).toBe("2027-04-25");
    expect(recs[0]!.inputSnapshotId).not.toBeNull();
    expect(done.summary).toEqual({ total: 1, checked: 1, newRecommendations: 1, problems: [] });
  });

  it("updates the live recommendation in place and appends the level history", async () => {
    const { ws, field } = await workspaceWithField("Pivot 14");
    await seedWeather(field);
    for (let i = 0; i < 2; i++) {
      const run = await analysis.start(ws, "manual", null, AS_OF);
      for (const job of await jobsFor(run.id)) await consumer.handle(job);
    }
    const recs = await prisma.system.recommendation.findMany({
      where: { fieldId: field },
      include: { levels: true },
    });
    expect(recs).toHaveLength(1);
    expect(recs[0]!.levels).toHaveLength(2);
  });

  it("is stale with the reason when the forecast is unavailable", async () => {
    const { ws, field } = await workspaceWithField("Pivot 40", [-99.3, 37.6]);
    await seedWeather(field, false);
    const run = await analysis.start(ws, "manual", null, AS_OF);
    for (const job of await jobsFor(run.id)) await consumer.handle(job);
    const done = await analysis.view(ws, run.id);
    expect(done.fields[0]).toMatchObject({
      status: "stale",
      dataDate: "2026-11-10",
      error: "Forecast unavailable",
    });
    expect(done.summary?.problems[0]).toMatchObject({
      fieldId: field,
      name: "Pivot 40",
      status: "stale",
      dataDate: "2026-11-10",
    });
  });

  it("fails a field with no usable data, and says what failed", async () => {
    const { ws, field } = await workspaceWithField("Dryland 3", [-103.2, 40.6]);
    const run = await analysis.start(ws, "manual", null, AS_OF);
    for (const job of await jobsFor(run.id)) await consumer.handle(job);
    const done = await analysis.view(ws, run.id);
    expect(done.fields[0]!.status).toBe("failed");
    expect(done.fields[0]!.error).toContain("NASA POWER");
    expect(done.summary).toMatchObject({
      total: 1,
      checked: 0,
      problems: [{ fieldId: field, name: "Dryland 3", status: "failed" }],
    });
    expect(await prisma.system.recommendation.count({ where: { fieldId: field } })).toBe(0);
  });

  it("attaches a field already being checked to that check instead of starting another", async () => {
    const { ws, field } = await workspaceWithField("Pivot 21");
    await seedWeather(field);
    const first = await analysis.start(ws, "manual", null, AS_OF);
    const second = await analysis.start(ws, "manual", null, AS_OF);
    expect(await jobsFor(second.id)).toHaveLength(0);
    expect(second.fields[0]).toMatchObject({ fieldId: field, status: "waiting" });
    for (const job of await jobsFor(first.id)) await consumer.handle(job);
    for (const id of [first.id, second.id]) {
      const v = await analysis.view(ws, id);
      expect(v.status).toBe("done");
      expect(v.fields[0]!.status).toBe("ok");
    }
  });
});

describe("06:00 scheduler", () => {
  it("starts one schedule run per workspace after 06:00 local time, once per day", async () => {
    const { ws } = await workspaceWithField("Pivot 30");
    const before = await scheduler.tick(new Date("2026-11-14T11:30:00Z")); // 05:30 in Chicago
    expect(before).not.toContain(ws);
    const at = await scheduler.tick(new Date("2026-11-14T12:05:00Z")); // 06:05
    expect(at).toContain(ws);
    expect(await scheduler.tick(new Date("2026-11-14T15:00:00Z"))).not.toContain(ws);
    const runs = await prisma.system.analysisRun.findMany({
      where: { workspaceId: ws, trigger: "schedule" },
    });
    expect(runs.map((r) => r.asOf.toISOString().slice(0, 10))).toEqual(["2026-11-14"]);
  });
});

describe("assistant tool scope (S-05.01)", () => {
  it("reads a field by alias in its own workspace and returns 'not found' from any other", async () => {
    const a = await workspaceWithField("Pivot 50");
    const b = await workspaceWithField("Pivot 51");
    const lib = loadLibrary(DATA_DIR);
    const seasons = new SeasonsService(prisma, env);
    const broker = new FakeBroker();
    const history = new HistoryService(broker, env, lib, prisma, new OutboxService(prisma, broker, env));
    const unused = null as never;
    const tools = new ToolExecutor(
      lib,
      prisma,
      unused,
      unused,
      history,
      seasons,
      unused,
      sources,
      geo,
      unused,
    );
    const scopeA = { workspaceId: a.ws, userId: "u", role: "agronomist", lang: "en" as const };
    const summary = (await tools.run("get_field_summary", { field: "F1" }, scopeA)) as {
      field: string;
      area: { value: number; unit: string };
    };
    expect(summary.field).toBe("F1");
    expect(summary.area.unit).toBe("ha");
    expect(JSON.stringify(summary)).not.toContain("Pivot 50"); // names never leave
    const scopeB = { ...scopeA, workspaceId: b.ws };
    await expect(tools.run("get_field_summary", { field: "F2" }, scopeB)).rejects.toBeInstanceOf(ToolError);
    await expect(tools.run("get_field_summary", { field: "Pivot 50" }, scopeB)).rejects.toThrow(
      /invalid arguments/,
    );
    // A recommendation id from workspace A is not visible from workspace B.
    const rec = await prisma.system.recommendation.findFirst({
      where: { workspaceId: { not: b.ws } },
      select: { id: true },
    });
    if (rec)
      await expect(tools.run("explain_recommendation", { id: rec.id }, scopeB)).rejects.toThrow(/not found/);
    const historyA = (await tools.run("get_field_history", { field: "F1" }, scopeA)) as {
      seasons: Array<{ season: number }>;
    };
    expect(historyA.seasons.map((x) => x.season)).toEqual([2023, 2024, 2025]);
  });
});
