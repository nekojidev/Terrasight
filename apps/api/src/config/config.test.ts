import { describe, expect, it } from "vitest";
import { loadEnv } from "./config.js";

const base = { DATABASE_URL: "postgresql://u:p@localhost:5432/db", RABBITMQ_URL: "amqp://localhost" };

describe("loadEnv", () => {
  it("applies defaults and treats Redis as optional", () => {
    const env = loadEnv(base);
    expect(env).toMatchObject({ ROLE: "all", PORT: 4000, DEV_AUTH: false });
    expect(env.REDIS_URL).toBeUndefined();
  });

  it("treats an empty variable as not set", () => {
    expect(loadEnv({ ...base, REDIS_URL: "" }).REDIS_URL).toBeUndefined();
  });

  it("lists every invalid variable", () => {
    expect(() => loadEnv({ ROLE: "boss" })).toThrow(/DATABASE_URL[\s\S]*RABBITMQ_URL|ROLE/);
  });

  it("refuses the development auth stand-in in production", () => {
    expect(() => loadEnv({ ...base, NODE_ENV: "production", DEV_AUTH: "true" })).toThrow(/DEV_AUTH/);
  });
});
