import { describe, expect, it } from "vitest";
import { loadEnv } from "./config.js";

const base = {
  DATABASE_URL: "postgresql://u:p@localhost:5432/db",
  RABBITMQ_URL: "amqp://localhost",
  JWT_SECRET: "x".repeat(32),
};

describe("loadEnv", () => {
  it("applies defaults and treats Redis as optional", () => {
    const env = loadEnv(base);
    expect(env).toMatchObject({ ROLE: "all", PORT: 4000 });
    expect(env.REDIS_URL).toBeUndefined();
  });

  it("treats an empty variable as not set", () => {
    expect(loadEnv({ ...base, REDIS_URL: "" }).REDIS_URL).toBeUndefined();
  });

  it("lists every invalid variable", () => {
    expect(() => loadEnv({ ROLE: "boss" })).toThrow(/DATABASE_URL[\s\S]*RABBITMQ_URL|ROLE/);
  });

  it("requires a JWT secret of at least 32 characters", () => {
    expect(() => loadEnv({ ...base, JWT_SECRET: "short" })).toThrow(/JWT_SECRET/);
  });
});
