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
  /** HS256 key for the 15-minute access JWT (Tech Design §14.1). At least 32 characters. */
  JWT_SECRET: z.string().min(32, "must be at least 32 characters"),
  /** Source credentials (Tech Design §17). Optional: without them those sources report "not configured". */
  CDSE_CLIENT_ID: z.string().optional(),
  CDSE_CLIENT_SECRET: z.string().optional(),
  OPENET_API_KEY: z.string().optional(),
  /** Open-Meteo commercial key (RFC §13); without it the free endpoint is used (development, hackathon demo). */
  OPEN_METEO_API_KEY: z.string().optional(),
  EARTHDATA_TOKEN: z.string().optional(),
  /** Gemini API (RFC D9); without a key the assistant answers "Assistant unavailable". */
  GEMINI_API_KEY: z.string().optional(),
  GEMINI_MODEL: z.string().default("gemini-3.8-flash"),
  /** First planned season (harvest year) of the 5-season horizon (RFC §7.7: 2026–2030). */
  PLAN_FIRST_SEASON: z.coerce.number().int().min(2020).max(2100).default(2026),
  /** Recorded real responses served when a live call fails (RFC §5.4). */
  FIXTURES_DIR: z.string().default(fileURLToPath(new URL("../../../../fixtures/", import.meta.url))),
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
  return parsed.data;
}

export const ENV = Symbol("ENV");

export const runsApi = (env: Env) => env.ROLE === "all" || env.ROLE === "api";
export const runsWorker = (env: Env) => env.ROLE === "all" || env.ROLE === "worker";
export const runsScheduler = (env: Env) => env.ROLE === "all" || env.ROLE === "scheduler";
