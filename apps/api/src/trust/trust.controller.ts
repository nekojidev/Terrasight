import { Controller, Get, Param, Req, UseGuards } from "@nestjs/common";
import { AuthGuard, Requires, UUID, WorkspaceGuard, type AuthedRequest } from "../auth/current-user.js";
import { ProblemException } from "../http/problem.js";
import { TrustService } from "./trust.service.js";

/** EP-10 S-10.08 / S-10.10: the model against what happened, same guards and permission as the field history. */
@Controller("w/:ws/fields")
@UseGuards(AuthGuard, WorkspaceGuard)
export class TrustController {
  constructor(private readonly trust: TrustService) {}

  @Get(":id/trust")
  @Requires("fields.read")
  report(@Param("id") id: string, @Req() req: AuthedRequest) {
    if (!UUID.test(id)) throw new ProblemException(404, "not-found");
    return this.trust.report(req.workspaceId!, id);
  }
}
