import { Module } from "@nestjs/common";
import { AnalysisModule } from "../analysis/analysis.module.js";
import { ClimateModule } from "../climate/climate.module.js";
import { FieldsModule } from "../fields/fields.module.js";
import { RecommendationsModule } from "../recommendations/recommendations.module.js";
import { AssistantController } from "./assistant.controller.js";
import { AssistantService } from "./assistant.service.js";
import { ScenariosModule } from "../scenarios/scenarios.module.js";
import { YearSetsService } from "../scenarios/year-sets.service.js";
import { ToolExecutor } from "./executor.js";
import { YEAR_SET_COMPARISON_PROVIDER, type YearSetComparisonProvider } from "./year-set-provider.js";

/** EP-05: the AI assistant (Gemini + read-only tools, number check, safety filter, retention). */
@Module({
  imports: [FieldsModule, ClimateModule, AnalysisModule, RecommendationsModule, ScenariosModule],
  controllers: [AssistantController],
  providers: [
    ToolExecutor,
    AssistantService,
    {
      // The year-set comparison of the rotation run (default overrides); "not available" when it cannot be made.
      provide: YEAR_SET_COMPARISON_PROVIDER,
      inject: [YearSetsService],
      useFactory: (sets: YearSetsService): YearSetComparisonProvider => ({
        compare: (workspaceId, fieldId) => sets.compare(workspaceId, fieldId, {}).catch(() => null),
      }),
    },
  ],
})
export class AssistantModule {}
