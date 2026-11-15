import { Module } from "@nestjs/common";
import { AnalysisModule } from "../analysis/analysis.module.js";
import { FieldsModule } from "../fields/fields.module.js";
import { WorkWindowsController } from "./work-windows.controller.js";
import { WorkWindowsService } from "./work-windows.service.js";

/** "Work windows for the week": spraying, sowing, field traffic and fertiliser timing from the hourly forecast. */
@Module({
  imports: [AnalysisModule, FieldsModule],
  controllers: [WorkWindowsController],
  providers: [WorkWindowsService],
})
export class WorkWindowsModule {}
