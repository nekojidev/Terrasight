import { Controller, Get, Param, Query, Req, UseGuards } from "@nestjs/common";
import { z } from "zod";
import { AuthGuard, Requires, UUID, WorkspaceGuard, type AuthedRequest } from "../auth/current-user.js";
import { ProblemException } from "../http/problem.js";
import { WorkWindowsService } from "./work-windows.service.js";

const Days = z.coerce.number().int().min(1).max(7).default(7);

function parseDays(days: string | undefined): number {
  const r = Days.safeParse(days);
  if (!r.success) throw new ProblemException(400, "validation", "days must be 1 to 7");
  return r.data;
}

/** GET /w/:ws/work-windows and /w/:ws/fields/:id/work-windows (permission like the brief). */
@Controller("w/:ws")
@UseGuards(AuthGuard, WorkspaceGuard)
export class WorkWindowsController {
  constructor(private readonly windows: WorkWindowsService) {}

  @Get("work-windows")
  @Requires("brief.read")
  all(@Query("days") days: string | undefined, @Req() req: AuthedRequest) {
    return this.windows.forWorkspace(req.workspaceId!, parseDays(days));
  }

  @Get("fields/:id/work-windows")
  @Requires("brief.read")
  one(@Param("id") id: string, @Query("days") days: string | undefined, @Req() req: AuthedRequest) {
    if (!UUID.test(id)) throw new ProblemException(404, "not-found");
    return this.windows.forField(req.workspaceId!, id, parseDays(days));
  }
}
