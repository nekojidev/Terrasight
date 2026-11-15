import { Module } from "@nestjs/common";
import {
  WorkspaceController,
  WorkspacesController,
} from "./workspaces.controller.js";
import { WorkspacesService } from "./workspaces.service.js";

@Module({
  controllers: [WorkspacesController, WorkspaceController],
  providers: [WorkspacesService],
  exports: [WorkspacesService],
})
export class WorkspacesModule {}
