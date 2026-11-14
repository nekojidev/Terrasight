import { Module } from "@nestjs/common";
import { RecommendationsModule } from "../recommendations/recommendations.module.js";
import { ReportLinkController, ReportsController } from "./reports.controller.js";
import { ReportsService } from "./reports.service.js";

/** EP-08: Owner report, answers, replies, report links. */
@Module({
  imports: [RecommendationsModule],
  controllers: [ReportsController, ReportLinkController],
  providers: [ReportsService],
})
export class ReportsModule {}
