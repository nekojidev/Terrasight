import { Module } from "@nestjs/common";
import { AnalysisModule } from "../analysis/analysis.module.js";
import { ScoutingController, ScoutingPhotosController } from "./scouting.controller.js";
import { ScoutingService } from "./scouting.service.js";

/** EP-07: scouting tasks, W-route, photos, send. */
@Module({
  imports: [AnalysisModule],
  controllers: [ScoutingController, ScoutingPhotosController],
  providers: [ScoutingService],
})
export class ScoutingModule {}
