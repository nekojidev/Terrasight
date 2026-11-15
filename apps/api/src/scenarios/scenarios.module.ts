import { Module } from "@nestjs/common";
import { FieldsModule } from "../fields/fields.module.js";
import { RotationsOverviewController, ScenariosController } from "./scenarios.controller.js";
import { AiRotationsService } from "./ai-rotations.service.js";
import { ScenariosService } from "./scenarios.service.js";

/** EP-06: rotation scenarios and the season plan. */
@Module({
  imports: [FieldsModule],
  controllers: [ScenariosController, RotationsOverviewController],
  providers: [AiRotationsService, ScenariosService],
  exports: [ScenariosService],
})
export class ScenariosModule {}
