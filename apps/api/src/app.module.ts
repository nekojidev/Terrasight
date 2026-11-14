import { Module } from "@nestjs/common";
import { LoggerModule } from "nestjs-pino";
import { loadEnv } from "./config/config.js";
import { AnalysisModule } from "./analysis/analysis.module.js";
import { AssistantModule } from "./assistant/assistant.module.js";
import { AuthModule } from "./auth/auth.module.js";
import { ConfigModule } from "./config/config.module.js";
import { DbModule } from "./db/db.module.js";
import { EventsModule } from "./events/events.module.js";
import { FieldsModule } from "./fields/fields.module.js";
import { HealthController } from "./health/health.controller.js";
import { LibraryModule } from "./library/library.module.js";
import { MessagingModule } from "./messaging/messaging.module.js";
import { RecommendationsModule } from "./recommendations/recommendations.module.js";
import { ScenariosModule } from "./scenarios/scenarios.module.js";
import { ScoutingModule } from "./scouting/scouting.module.js";
import { RedisModule } from "./redis/redis.module.js";
import { WorkspacesModule } from "./workspaces/workspaces.module.js";

const env = loadEnv();

@Module({
  imports: [
    LoggerModule.forRoot({
      pinoHttp: {
        level: env.LOG_LEVEL,
        autoLogging: { ignore: (req) => req.url === "/healthz" || req.url === "/readyz" },
        redact: ["req.headers.cookie", "req.headers.authorization", 'res.headers["set-cookie"]'],
        ...(env.NODE_ENV === "development"
          ? { transport: { target: "pino-pretty", options: { singleLine: true } } }
          : {}),
      },
    }),
    ConfigModule,
    LibraryModule,
    DbModule,
    RedisModule,
    MessagingModule,
    AuthModule,
    EventsModule,
    WorkspacesModule,
    FieldsModule,
    AnalysisModule,
    RecommendationsModule,
    AssistantModule,
    ScenariosModule,
    ScoutingModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
