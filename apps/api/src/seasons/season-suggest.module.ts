import { Module } from "@nestjs/common";
import { AnalysisModule } from "../analysis/analysis.module.js";
import { FieldsModule } from "../fields/fields.module.js";
import { SeasonSuggestController } from "./season-suggest.controller.js";
import { SeasonSuggestService } from "./season-suggest.service.js";

/** Suggested sowing window, emergence date and tillage for the "This season" form. */
@Module({
  imports: [AnalysisModule, FieldsModule],
  controllers: [SeasonSuggestController],
  providers: [SeasonSuggestService],
})
export class SeasonSuggestModule {}
