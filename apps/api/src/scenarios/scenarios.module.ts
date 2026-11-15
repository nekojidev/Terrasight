import { Module } from "@nestjs/common";
import { CropPricesModule } from "../crop-prices/crop-prices.module.js";
import { FieldsModule } from "../fields/fields.module.js";
import { FarmStressController, RotationsOverviewController, ScenariosController } from "./scenarios.controller.js";
import { AiRotationsService } from "./ai-rotations.service.js";
import { ScenarioInputsService } from "./scenario-inputs.service.js";
import { ScenarioPlansService } from "./scenario-plans.service.js";
import { FarmStressService } from "./farm-stress.service.js";
import { ScenariosService } from "./scenarios.service.js";
import { YearSetsService } from "./year-sets.service.js";

/** EP-06: rotation scenarios and the season plan. */
@Module({
  imports: [FieldsModule, CropPricesModule],
  controllers: [ScenariosController, RotationsOverviewController, FarmStressController],
  providers: [AiRotationsService, ScenarioInputsService, ScenarioPlansService, ScenariosService, YearSetsService, FarmStressService],
  exports: [ScenariosService, YearSetsService],
})
export class ScenariosModule {}
