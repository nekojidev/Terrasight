import { Module } from "@nestjs/common";
import { CropPricesModule } from "../crop-prices/crop-prices.module.js";
import { ScenariosModule } from "../scenarios/scenarios.module.js";
import { YieldsModule } from "../yields/yields.module.js";
import { TrustController } from "./trust.controller.js";
import { TrustService } from "./trust.service.js";

/** EP-10: hindcast and retrospective ("how far can you trust this"). */
@Module({
  imports: [ScenariosModule, YieldsModule, CropPricesModule],
  controllers: [TrustController],
  providers: [TrustService],
})
export class TrustModule {}
