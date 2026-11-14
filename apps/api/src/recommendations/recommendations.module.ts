import { Module } from "@nestjs/common";
import { AnalysisModule } from "../analysis/analysis.module.js";
import { FieldsModule } from "../fields/fields.module.js";
import { BriefController } from "../brief/brief.controller.js";
import { BriefService } from "../brief/brief.service.js";
import { CommitConsumer } from "./commit.consumer.js";
import { FieldOverviewController } from "./field-overview.controller.js";
import { RecommendationsController } from "./recommendations.controller.js";
import { RecommendationsService } from "./recommendations.service.js";

/** EP-04: recommendation lifecycle (accept / snooze / Undo / commit) and the morning brief. */
@Module({
  imports: [AnalysisModule, FieldsModule],
  controllers: [RecommendationsController, BriefController, FieldOverviewController],
  providers: [RecommendationsService, CommitConsumer, BriefService],
  exports: [RecommendationsService, BriefService],
})
export class RecommendationsModule {}
