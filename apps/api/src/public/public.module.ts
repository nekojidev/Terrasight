import { Module } from "@nestjs/common";
import { ClimateModule } from "../climate/climate.module.js";
import { FieldsModule } from "../fields/fields.module.js";
import { PublicController } from "./public.controller.js";
import { PublicService } from "./public.service.js";

/** EP-10 S-10.14: the public page's routes. SourcesService comes from FieldsModule; RateLimitService and RedisService are global. */
@Module({ imports: [ClimateModule, FieldsModule], controllers: [PublicController], providers: [PublicService] })
export class PublicModule {}
