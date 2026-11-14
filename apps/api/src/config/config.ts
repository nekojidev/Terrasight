import { fileURLToPath } from "node:url";
import { z } from "zod";

const DEFAULT_DATA_DIR = fileURLToPath(new URL("../../../../data/", import.meta.url));

/** Environment variables (Tech Design §17). Parsed once at start-up; invalid config stops the process. */
export const EnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  /** Which parts of the app run in this process (Tech Design §2). */
  ROLE: z.enum(["all", "api", "worker", "scheduler"]).default("all"),
  PORT: z.coerce.number().int().positive().default(4000),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace"]).default("info"),
  DATABASE_URL: z.string().url(),
  RABBITMQ_URL: z.string().url(),
  /** Optional (RFC §5.2): without it the app runs on in-process fallbacks. */
  REDIS_URL: z.string().url().optional(),
  DATA_DIR: z.string().default(DEFAULT_DATA_DIR),
  WEB_ORIGIN: z.string().url().default("http://localhost:3000"),
  /**
   * Development-only stand-in for auth until EP-01: trusts the `x-dev-user-id` header.
   * Refused when NODE_ENV=production.
   */
  DEV_AUTH: z
    .enum(["true", "false"])
    .default("false")
    .transform((v) => v === "true"),
});

export type Env = z.infer<typeof EnvSchema>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  // An empty variable (e.g. `REDIS_URL=` in compose) means "not set".
  const cleaned = Object.fromEntries(Object.entries(source).filter(([, v]) => v !== undefined && v !== ""));
  const parsed = EnvSchema.safeParse(cleaned);
  if (!parsed.success) {
    const lines = parsed.error.issues.map((i) => `  - ${i.path.join(".")}: ${i.message}`);
    throw new Error(`Invalid environment:\n${lines.join("\n")}`);
  }
  if (parsed.data.DEV_AUTH && parsed.data.NODE_ENV === "production") {
    throw new Error("DEV_AUTH must not be enabled in production");
  }
  return parsed.data;
}

export const ENV = Symbol("ENV");

export const runsApi = (env: Env) => env.ROLE === "all" || env.ROLE === "api";
export const runsWorker = (env: Env) => env.ROLE === "all" || env.ROLE === "worker";
export const runsScheduler = (env: Env) => env.ROLE === "all" || env.ROLE === "scheduler";
