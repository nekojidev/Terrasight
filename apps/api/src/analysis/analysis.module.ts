import { Module } from "@nestjs/common";
import { FieldsModule } from "../fields/fields.module.js";
import { ScenariosModule } from "../scenarios/scenarios.module.js";
import { AnalysisController } from "./analysis.controller.js";
import { AlertsService } from "./alerts.service.js";
import { AnalysisService } from "./analysis.service.js";
import { EvalInputsService } from "./eval-inputs.service.js";
import { FieldCheckConsumer } from "./field-check.consumer.js";
import { ForecastService } from "./forecast.service.js";
import { AnalysisScheduler } from "./scheduler.js";

/** EP-03: forecast, analysis runs (06:00 and manual), field checks and evaluators. */
@Module({
  imports: [FieldsModule, ScenariosModule],
  controllers: [AnalysisController],
  providers: [AlertsService, ForecastService, AnalysisService, AnalysisScheduler, FieldCheckConsumer, EvalInputsService],
  exports: [ForecastService, AnalysisService, EvalInputsService],
})
export class AnalysisModule {}
