import { defineConfig } from "prisma/config";

// `prisma generate` needs no database, so a placeholder is fine there; `migrate deploy` gets the real URL
// from the environment (docker compose, the demo host, CI integration jobs).
export default defineConfig({
  schema: "../../prisma/schema.prisma",
  migrations: { path: "../../prisma/migrations" },
  datasource: { url: process.env.DATABASE_URL ?? "postgresql://placeholder@localhost:5432/placeholder" },
});
