import { describe, expect, it } from "vitest";
import type { Env } from "../config/config.js";
import type { PrismaService } from "../db/prisma.service.js";
import { CountyYieldsService } from "./yields.service.js";

const env = { NASS_API_KEY: "SECRET-KEY-VALUE", FIXTURES_DIR: new URL("../../../../fixtures/", import.meta.url).pathname } as Env;

describe("CountyYieldsService", () => {
  const svc = new CountyYieldsService({} as PrismaService, env);

  it("cache key is a hash that does not depend on or contain the API key", () => {
    const q = { stateAlpha: "KS", countyFips: "20055", crop: "corn" };
    const other = new CountyYieldsService({} as PrismaService, { ...env, NASS_API_KEY: "other" } as Env);
    expect(svc.cacheKey(q)).toMatch(/^[0-9a-f]{64}$/);
    expect(svc.cacheKey(q)).toBe(other.cacheKey(q));
  });

  it("serves the recorded fixture for a demo county", () => {
    const f = svc.fixture("KS", "20055", "corn");
    expect(f?.area).toBe("Finney County, KS");
    expect(svc.fixture("KS", "20055", "no_such_crop")).toBeNull();
  });
});
