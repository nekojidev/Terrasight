import { Module } from "@nestjs/common";
import { FieldsModule } from "../fields/fields.module.js";
import { ScenariosController } from "./scenarios.controller.js";
import { ScenariosService } from "./scenarios.service.js";

/** EP-06: rotation scenarios and the season plan. */
@Module({
  imports: [FieldsModule],
  controllers: [ScenariosController],
  providers: [ScenariosService],
  exports: [ScenariosService],
})
export class ScenariosModule {}
