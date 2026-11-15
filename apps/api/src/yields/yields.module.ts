import { Module } from "@nestjs/common";
import { CountyYieldsService } from "./yields.service.js";

/** USDA NASS Quick Stats county yields (EP-10 S-10.07), used by the hindcast. */
@Module({
  providers: [CountyYieldsService],
  exports: [CountyYieldsService],
})
export class YieldsModule {}
