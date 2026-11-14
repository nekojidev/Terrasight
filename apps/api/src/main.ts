import "reflect-metadata";
import { RequestMethod } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import cookieParser from "cookie-parser";
import { Logger } from "nestjs-pino";
import { AppModule } from "./app.module.js";
import { loadEnv } from "./config/config.js";

async function bootstrap(): Promise<void> {
  const env = loadEnv();
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  app.useLogger(app.get(Logger));
  app.setGlobalPrefix("api", {
    exclude: [
      { path: "healthz", method: RequestMethod.GET },
      { path: "readyz", method: RequestMethod.GET },
    ],
  });
  app.use(cookieParser());
  app.enableCors({ origin: env.WEB_ORIGIN, credentials: true });
  app.enableShutdownHooks();
  // Every role serves /healthz and /readyz; only api/all expose the REST API to users (behind the proxy).
  await app.listen(env.PORT, "0.0.0.0");
}

void bootstrap();
