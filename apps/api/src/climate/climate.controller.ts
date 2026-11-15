import { Controller, Get, Param, Req, UseGuards } from "@nestjs/common";
import { AuthGuard, Requires, UUID, WorkspaceGuard, type AuthedRequest } from "../auth/current-user.js";
import { ProblemException } from "../http/problem.js";
import { ClimateService } from "./climate.service.js";

/** GET /w/:ws/fields/:id/climate-shift: same guards and permission as the field history route. */
@Controller("w/:ws/fields")
@UseGuards(AuthGuard, WorkspaceGuard)
export class ClimateController {
  constructor(private readonly climate: ClimateService) {}

  @Get(":id/climate-shift")
  @Requires("fields.read")
  shift(@Param("id") id: string, @Req() req: AuthedRequest) {
    if (!UUID.test(id)) throw new ProblemException(404, "not-found");
    return this.climate.forField(req.workspaceId!, id);
  }
}
