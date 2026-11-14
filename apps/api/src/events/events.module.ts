import { Global, Module } from "@nestjs/common";
import { AuthGuard, WorkspaceMemberGuard } from "../auth/current-user.js";
import { EventsController } from "./events.controller.js";
import { EventsService } from "./events.service.js";

@Global()
@Module({
  controllers: [EventsController],
  providers: [EventsService, AuthGuard, WorkspaceMemberGuard],
  exports: [EventsService],
})
export class EventsModule {}
