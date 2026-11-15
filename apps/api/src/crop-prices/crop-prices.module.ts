import { Module } from "@nestjs/common";
import { CropPricesController } from "./crop-prices.controller.js";
import { CropPricesService } from "./crop-prices.service.js";

/** The company's own crop prices (user data) used by the rotation scenarios. */
@Module({
  controllers: [CropPricesController],
  providers: [CropPricesService],
  exports: [CropPricesService],
})
export class CropPricesModule {}
