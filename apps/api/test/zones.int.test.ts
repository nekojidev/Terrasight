import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { GenericContainer } from "testcontainers";
import pg from "pg";
import { makeFieldGrid, zonePolygons } from "@terrasight/sources";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadEnv } from "../src/config/config.js";
import { PrismaService } from "../src/db/prisma.service.js";
import { FakeBroker } from "../src/messaging/fake-broker.js";
import { OutboxService } from "../src/messaging/outbox.service.js";
import { ZonesService } from "../src/zones/zones.service.js";

/** Rate-map zones on PostGIS: the additive migration, clipping to the field (areas add up) and the queued build. */
const MIGRATIONS = fileURLToPath(new URL("../../../prisma/migrations/", import.meta.url));
const IMAGE = "terrasight-postgis:17";
const DOCKERFILE_DIR = fileURLToPath(new URL("../../../infra/postgis/", import.meta.url));

let container: StartedPostgreSqlContainer;
let client: pg.Client;
let prisma: PrismaService;
let service: ZonesService;

const LON = -100.88;
const LAT = 37.97;
const DLAT = 0.0045;
const DLON = DLAT / Math.cos((LAT * Math.PI) / 180);
// An irregular (L-shaped) field so that pixels cross its outline.
const RING = [
  [LON - DLON, LAT - DLAT],
  [LON + DLON, LAT - DLAT],
  [LON + DLON, LAT],
  [LON, LAT],
  [LON, LAT + DLAT],
  [LON - DLON, LAT + DLAT],
  [LON - DLON, LAT - DLAT],
];

async function field(): Promise<{ ws: string; id: string }> {
  const ws = await client.query(
    `INSERT INTO workspaces (id, name, slug, time_zone) VALUES (gen_random_uuid(), 'Co', $1, 'UTC') RETURNING id`,
    [`co-${Math.random().toString(36).slice(2)}`],
  );
  const wkt = `ST_Multi(ST_GeomFromText('POLYGON((${RING.map((p) => p.join(" ")).join(",")}))', 4326))`;
  const f = await client.query(
    `INSERT INTO fields (id, workspace_id, name, alias_no, geom, centroid, area_ha, tier)
     VALUES (gen_random_uuid(), $1, 'L field', 1, ${wkt}, ST_Centroid(${wkt}), ST_Area(${wkt}::geography) / 10000, 'A') RETURNING id`,
    [ws.rows[0].id],
  );
  return { ws: ws.rows[0].id as string, id: f.rows[0].id as string };
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
  service = new ZonesService(prisma, new OutboxService(prisma, new FakeBroker(), env), env);
});

afterAll(async () => {
  await prisma?.onModuleDestroy();
  await client?.end();
  await container?.stop();
});

describe("zones", () => {
  it("clips grid polygons to the field: zone areas add up to the field area", async () => {
    const { id } = await field();
    const fg = makeFieldGrid([[RING]], { lon: LON, lat: LAT });
    const { width, height } = fg.grid;
    const cls = new Uint8Array(width * height);
    for (let r = 0; r < height; r++)
      for (let c = 0; c < width; c++) cls[r * width + c] = c < width / 3 ? 1 : (r + c) % 5 === 0 ? 2 : c < (2 * width) / 3 ? 2 : 3;
    const polys = zonePolygons(cls, fg.grid);
    const sums = await service.saveZones(id, polys, { strong: 0.7, variable: 0.5, weak: 0.3 });
    // Geography areas of the pieces differ from the whole only by edge-geometry rounding (here ~1e-5 relative).
    expect(Math.abs(sums.zones_ha! / sums.field_ha - 1)).toBeLessThan(1e-4);
    const rows = await client.query(
      `SELECT zone, area_ha, share, ST_IsValid(geom) AS valid, ST_GeometryType(geom) AS t,
              ST_Within(geom, (SELECT ST_Buffer(geom, 1e-9) FROM fields WHERE id = $1)) AS within
       FROM field_zones WHERE field_id = $1 ORDER BY zone`,
      [id],
    );
    expect(rows.rows.map((r) => r.zone)).toEqual(["strong", "variable", "weak"]);
    expect(rows.rows.every((r) => r.valid && r.t === "ST_MultiPolygon" && r.within)).toBe(true);
    expect(rows.rows.reduce((s, r) => s + Number(r.share), 0)).toBeCloseTo(1, 9);
    // rebuilding replaces the rows
    await service.saveZones(id, { strong: polys.strong! }, { strong: 0.7, variable: null, weak: null });
    const again = await client.query(`SELECT zone, share FROM field_zones WHERE field_id = $1`, [id]);
    expect(again.rows).toEqual([{ zone: "strong", share: 1 }]);
  });

  it("queues one build per field and reports its status; unknown fields are 404", async () => {
    const { ws, id } = await field();
    expect((await service.status(ws, id)).status).toBe("none");
    const first = await service.build(ws, id);
    expect(first.status).toBe("queued");
    const jobs = async () => Number((await client.query(`SELECT count(*) FROM outbox WHERE routing_key = 'zones.build'`)).rows[0].count);
    const before = await jobs();
    await service.build(ws, id); // already queued: no second job
    expect(await jobs()).toBe(before);
    await expect(service.build(ws, "00000000-0000-4000-8000-000000000000")).rejects.toThrow();
    // another workspace cannot see the field
    const other = await field();
    await expect(service.status(other.ws, id)).rejects.toThrow();
  });
});
