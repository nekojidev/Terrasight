import { Controller, Get, Param, Req, UseGuards } from "@nestjs/common";
import { AuthGuard, Requires, UUID, WorkspaceGuard, type AuthedRequest } from "../auth/current-user.js";
import { ProblemException } from "../http/problem.js";
import { OutlookService } from "./outlook.service.js";

/** Seasonal outlook, 1–3 months ahead: per field and for the company. */
@Controller("w/:ws")
@UseGuards(AuthGuard, WorkspaceGuard)
export class OutlookController {
  constructor(private readonly outlook: OutlookService) {}

  @Get("outlook")
  @Requires("brief.read")
  company(@Req() req: AuthedRequest) {
    return this.outlook.forCompany(req.workspaceId!);
  }

  @Get("fields/:id/outlook")
  @Requires("brief.read")
  field(@Param("id") id: string, @Req() req: AuthedRequest) {
    if (!UUID.test(id)) throw new ProblemException(404, "not-found");
    return this.outlook.forField(req.workspaceId!, id);
  }
}
