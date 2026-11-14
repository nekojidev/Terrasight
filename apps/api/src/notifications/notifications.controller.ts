import { Body, Controller, Get, HttpCode, Post, Query, Req, UseGuards } from "@nestjs/common";
import { z } from "zod";
import { AuthGuard, Requires, UUID, WorkspaceGuard, type AuthedRequest } from "../auth/current-user.js";
import { ZodPipe } from "../http/zod.js";
import { NotificationsService } from "./notifications.service.js";

const ReadBody = z.object({ ids: z.array(z.string().regex(UUID)).max(100).optional() });

/** `GET /api/w/:ws/notifications`, `POST /api/w/:ws/notifications/read` (RFC §15.4); always the caller's own. */
@Controller("w/:ws/notifications")
@UseGuards(AuthGuard, WorkspaceGuard)
@Requires("workspace.read")
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Get()
  list(@Query("unread") unread: string | undefined, @Req() req: AuthedRequest) {
    return this.notifications.list(req.workspaceId!, req.user!.id, unread === "1" || unread === "true");
  }

  @Post("read")
  @HttpCode(200)
  read(@Body(new ZodPipe(ReadBody)) body: z.infer<typeof ReadBody>, @Req() req: AuthedRequest) {
    return this.notifications.markRead(req.workspaceId!, req.user!.id, body.ids);
  }
}
