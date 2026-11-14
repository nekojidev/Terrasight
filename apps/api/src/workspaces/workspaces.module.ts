import { Module } from "@nestjs/common";
import {
  InvitationsPublicController,
  WorkspaceController,
  WorkspacesController,
} from "./workspaces.controller.js";
import { WorkspacesService } from "./workspaces.service.js";

@Module({
  controllers: [WorkspacesController, InvitationsPublicController, WorkspaceController],
  providers: [WorkspacesService],
  exports: [WorkspacesService],
})
export class WorkspacesModule {}
