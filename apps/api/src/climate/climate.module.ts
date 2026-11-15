import { Module } from "@nestjs/common";
import { FieldsModule } from "../fields/fields.module.js";
import { ClimateController } from "./climate.controller.js";
import { ClimateService } from "./climate.service.js";

/**
 * EP-10: climate shift of a field from the cached NASA POWER series. Another module may provide `GPM_CHECK_PROVIDER`
 * (see climate.service.ts) to add the IMERG cross-check; without it `gpm` is null.
 */
@Module({
  imports: [FieldsModule],
  controllers: [ClimateController],
  providers: [ClimateService],
  exports: [ClimateService],
})
export class ClimateModule {}
