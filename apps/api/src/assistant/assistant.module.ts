import { Module } from "@nestjs/common";
import { AnalysisModule } from "../analysis/analysis.module.js";
import { ClimateModule } from "../climate/climate.module.js";
import { FieldsModule } from "../fields/fields.module.js";
import { RecommendationsModule } from "../recommendations/recommendations.module.js";
import { AssistantController } from "./assistant.controller.js";
import { AssistantService } from "./assistant.service.js";
import { ToolExecutor } from "./executor.js";

/** EP-05: the AI assistant (Gemini + read-only tools, number check, safety filter, retention). */
@Module({
  imports: [FieldsModule, ClimateModule, AnalysisModule, RecommendationsModule],
  controllers: [AssistantController],
  providers: [ToolExecutor, AssistantService],
})
export class AssistantModule {}
