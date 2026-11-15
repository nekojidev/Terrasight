import { Module } from "@nestjs/common";
import { RecommendationsModule } from "../recommendations/recommendations.module.js";
import { ReportLinkController, ReportsController } from "./reports.controller.js";
import { DecisionsService } from "./decisions.service.js";
import { ReportsService } from "./reports.service.js";

/** EP-08: Owner decisions, answers, replies, report links. */
@Module({
  imports: [RecommendationsModule],
  controllers: [ReportsController, ReportLinkController],
  providers: [ReportsService, DecisionsService],
})
export class ReportsModule {}
