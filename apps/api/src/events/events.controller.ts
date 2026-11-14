import {
  BadRequestException,
  Controller,
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
import { AuthGuard, WorkspaceMemberGuard, type AuthedRequest } from "../auth/current-user.js";
import { PrismaService } from "../db/prisma.service.js";
import { EventsService } from "./events.service.js";

interface SseMessage {
  type: string;
  data: string;
  id?: string;
}

/** `GET /api/w/:ws/events?topics=brief,analysis,field:<id>,conversation:<id>` (Tech Design §14). */
@Controller("w/:ws/events")
@UseGuards(AuthGuard, WorkspaceMemberGuard)
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
    @Req() _req: AuthedRequest,
  ): Promise<Observable<SseMessage>> {
    const raw = (topicsParam ?? "brief")
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean);
    const topics: StreamTopic[] = [];
    for (const t of raw) {
      const parsed = StreamTopic.safeParse(t);
      if (!parsed.success) throw new BadRequestException(`Unknown topic ${t}`);
      topics.push(parsed.data);
    }
    // field:<id> must belong to this workspace (conversation topics are checked by EP-05).
    for (const t of topics) {
      if (t.startsWith("field:")) {
        const id = t.slice("field:".length);
        const field = await this.prisma.db.field.findFirst({
          where: { id, workspaceId: ws },
          select: { id: true },
        });
        if (!field) throw new BadRequestException(`Unknown topic ${t}`);
      }
    }
    return this.events
      .stream(ws, topics)
      .pipe(map((e) => ({ type: e.type, data: JSON.stringify(e.data), ...(e.id ? { id: e.id } : {}) })));
  }
}
