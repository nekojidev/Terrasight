import { Controller, Get, Req, UseGuards } from "@nestjs/common";
import { AuthGuard, Requires, WorkspaceGuard, type AuthedRequest } from "../auth/current-user.js";
import { BriefService } from "./brief.service.js";

/** GET /w/:ws/brief (S-04.02). */
@Controller("w/:ws/brief")
@UseGuards(AuthGuard, WorkspaceGuard)
export class BriefController {
  constructor(private readonly brief: BriefService) {}

  @Get()
  @Requires("brief.read")
  get(@Req() req: AuthedRequest) {
    return this.brief.get(req.workspaceId!);
  }
}
