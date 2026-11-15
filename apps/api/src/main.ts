import "reflect-metadata";
import { RequestMethod } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import cookieParser from "cookie-parser";
import { Logger } from "nestjs-pino";
import { AppModule } from "./app.module.js";
import { requireRequestedWith } from "./http/csrf.js";
import { ProblemFilter } from "./http/problem.js";
import { loadEnv } from "./config/config.js";
import { installProcessGuards } from "./process-guards.js";

let logger: Logger | null = null;
installProcessGuards(() => logger ?? console);

async function bootstrap(): Promise<void> {
  const env = loadEnv();
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  const pino = app.get(Logger);
  logger = pino;
  app.useLogger(pino);
  app.setGlobalPrefix("api", {
    exclude: [
      { path: "healthz", method: RequestMethod.GET },
      { path: "readyz", method: RequestMethod.GET },
    ],
  });
  app.use(cookieParser());
  app.use(requireRequestedWith);
  app.useGlobalFilters(new ProblemFilter());
  // Behind Caddy / the Next.js proxy: trust the first hop for req.ip (rate limits).
  app.getHttpAdapter().getInstance().set("trust proxy", 1);
  app.getHttpAdapter().getInstance().disable("x-powered-by");
  app.enableCors({ origin: env.WEB_ORIGIN, credentials: true });
  app.enableShutdownHooks();
  // Every role serves /healthz and /readyz; only api/all expose the REST API to users (behind the proxy).
  await app.listen(env.PORT, "0.0.0.0");
}

void bootstrap();
