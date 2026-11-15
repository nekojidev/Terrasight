import { Module } from "@nestjs/common";
import { GatherSourceConsumer } from "../gather/gather.consumer.js";
import { GatherService } from "../gather/gather.service.js";
import { GeocodeController } from "../geo/geocode.controller.js";
import { GeoService } from "../geo/geo.service.js";
import { HistoryService } from "../history/history.service.js";
import { SeasonsService } from "../seasons/seasons.service.js";
import { ZonesConsumer } from "../zones/zones.consumer.js";
import { ZonesController } from "../zones/zones.controller.js";
import { ZonesService } from "../zones/zones.service.js";
import { SourcesService } from "../sources/sources.service.js";
import { FieldsController } from "./fields.controller.js";
import { FieldsService } from "./fields.service.js";

/** EP-02: fields, sources, gather pipeline, history and season record. */
@Module({
  controllers: [FieldsController, GeocodeController, ZonesController],
  providers: [
    GeoService,
    SourcesService,
    FieldsService,
    GatherService,
    GatherSourceConsumer,
    HistoryService,
    SeasonsService,
    ZonesService,
    ZonesConsumer,
  ],
  exports: [GeoService, SourcesService, FieldsService, HistoryService, SeasonsService],
})
export class FieldsModule {}
