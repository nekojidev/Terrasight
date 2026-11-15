import { Module } from "@nestjs/common";
import { CropPricesModule } from "../crop-prices/crop-prices.module.js";
import { FieldsModule } from "../fields/fields.module.js";
import { RotationsOverviewController, ScenariosController } from "./scenarios.controller.js";
import { AiRotationsService } from "./ai-rotations.service.js";
import { ScenarioInputsService } from "./scenario-inputs.service.js";
import { ScenarioPlansService } from "./scenario-plans.service.js";
import { ScenariosService } from "./scenarios.service.js";

/** EP-06: rotation scenarios and the season plan. */
@Module({
  imports: [FieldsModule, CropPricesModule],
  controllers: [ScenariosController, RotationsOverviewController],
  providers: [AiRotationsService, ScenarioInputsService, ScenarioPlansService, ScenariosService],
  exports: [ScenariosService],
})
export class ScenariosModule {}
