import {
  Controller,
  ForbiddenException,
  Get,
  Header,
  Param,
  Query,
  Req,
  Sse,
  UseGuards,
} from "@nestjs/common";
import { StreamTopic } from "@terrasight/shared";
import type { Observable } from "rxjs";
import { map } from "rxjs";
import { AuthGuard, Requires, WorkspaceGuard, type AuthedRequest } from "../auth/current-user.js";
import { PrismaService } from "../db/prisma.service.js";
import { ProblemException } from "../http/problem.js";
import { EventsService } from "./events.service.js";

interface SseMessage {
  type: string;
  data: string;
  id?: string;
}

/** `GET /api/w/:ws/events?topics=brief,analysis,field:<id>,conversation:<id>` (Tech Design §14). */
@Controller("w/:ws/events")
@UseGuards(AuthGuard, WorkspaceGuard)
@Requires("workspace.read")
export class EventsController {
  constructor(
    private readonly events: EventsService,
    private readonly prisma: PrismaService,
  ) {}

  @Get()
  @Sse()
  @Header("Cache-Control", "no-cache, no-transform")
  @Header("X-Accel-Buffering", "no")
  async stream(
    @Param("ws") ws: string,
    @Query("topics") topicsParam: string | undefined,
    @Req() req: AuthedRequest,
  ): Promise<Observable<SseMessage>> {
    const raw = (topicsParam ?? "brief")
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean);
    const topics: StreamTopic[] = [];
    for (const t of raw) {
      const parsed = StreamTopic.safeParse(t);
      if (!parsed.success) throw new ProblemException(422, "invalid-input", `Unknown topic ${t}`);
      topics.push(parsed.data);
    }
    // field:<id> must belong to this workspace; conversation:<id> only to the user who owns the conversation
    // (conversations are private to their author: `list` filters by user, Tech Design §12).
    for (const t of topics) {
      if (t.startsWith("conversation:")) {
        const id = t.slice("conversation:".length);
        const userId = req.user?.id;
        const conv = userId
          ? await this.prisma.system.conversation.findFirst({
              where: { id, workspaceId: ws, userId },
              select: { id: true },
            })
          : null;
        if (!conv) throw new ForbiddenException(`No access to topic ${t}`);
      }
      if (t.startsWith("field:")) {
        const id = t.slice("field:".length);
        const field = await this.prisma.db.field.findFirst({
          where: { id, workspaceId: ws },
          select: { id: true },
        });
        if (!field) throw new ProblemException(422, "invalid-input", `Unknown topic ${t}`);
      }
    }
    return this.events
      .stream(ws, topics, undefined, req.user?.id)
      .pipe(map((e) => ({ type: e.type, data: JSON.stringify(e.data), ...(e.id ? { id: e.id } : {}) })));
  }
}
