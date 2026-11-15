import { createRequire } from "node:module";
import { Module } from "@nestjs/common";
import { LoggerModule } from "nestjs-pino";
import { requestId } from "./http/request-id.js";
import { loadEnv } from "./config/config.js";
import { AiModule } from "./ai/ai.module.js";
import { reqSerializer } from "./http/redact.js";
import { MailModule } from "./mail/mail.module.js";
import { AnalysisModule } from "./analysis/analysis.module.js";
import { AssistantModule } from "./assistant/assistant.module.js";
import { AccountModule } from "./account/account.module.js";
import { AuthModule } from "./auth/auth.module.js";
import { ExportModule } from "./export/export.module.js";
import { CropPricesModule } from "./crop-prices/crop-prices.module.js";
import { ClimateModule } from "./climate/climate.module.js";
import { ConfigModule } from "./config/config.module.js";
import { DbModule } from "./db/db.module.js";
import { EventsModule } from "./events/events.module.js";
import { FieldsModule } from "./fields/fields.module.js";
import { HealthController } from "./health/health.controller.js";
import { LibraryModule } from "./library/library.module.js";
import { MessagingModule } from "./messaging/messaging.module.js";
import { RecommendationsModule } from "./recommendations/recommendations.module.js";
import { ScenariosModule } from "./scenarios/scenarios.module.js";
import { NotificationsModule } from "./notifications/notifications.module.js";
import { ReportsModule } from "./reports/reports.module.js";
import { ScoutingModule } from "./scouting/scouting.module.js";
import { RetentionModule } from "./retention/retention.module.js";
import { RedisModule } from "./redis/redis.module.js";
import { SeasonSuggestModule } from "./seasons/season-suggest.module.js";
import { WorkWindowsModule } from "./work-windows/work-windows.module.js";
import { WorkspacesModule } from "./workspaces/workspaces.module.js";

const env = loadEnv();

/** pino-pretty is a dev dependency: the production image does not ship it, so `NODE_ENV=development` there logs JSON. */
function hasPrettyPrinter(): boolean {
  try {
    createRequire(import.meta.url).resolve("pino-pretty");
    return true;
  } catch {
    return false;
  }
}

@Module({
  imports: [
    LoggerModule.forRoot({
      pinoHttp: {
        level: env.LOG_LEVEL,
        // Request-id correlation: reuse a sane X-Request-Id from the proxy, else mint one. It is `req.id` on every
        // log line of the request, the X-Request-Id response header and, for 5xx, a tag on the Sentry event.
        genReqId: requestId,
        autoLogging: { ignore: (req) => req.url === "/healthz" || req.url === "/readyz" },
        serializers: { req: reqSerializer },
        redact: [
          "req.headers.cookie",
          "req.headers.authorization",
          "req.headers.referer",
          'res.headers["set-cookie"]',
        ],
        ...(env.NODE_ENV === "development" && hasPrettyPrinter()
          ? { transport: { target: "pino-pretty", options: { singleLine: true } } }
          : {}),
      },
    }),
    ConfigModule,
    LibraryModule,
    DbModule,
    RedisModule,
    AiModule,
    MailModule,
    MessagingModule,
    AuthModule,
    AccountModule,
    ExportModule,
    EventsModule,
    WorkspacesModule,
    FieldsModule,
    AnalysisModule,
    ClimateModule,
    RecommendationsModule,
    AssistantModule,
    CropPricesModule,
    ScenariosModule,
    ScoutingModule,
    ReportsModule,
    NotificationsModule,
    WorkWindowsModule,
    SeasonSuggestModule,
    RetentionModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
