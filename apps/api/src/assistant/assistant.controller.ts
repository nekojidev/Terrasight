import { Body, Controller, Delete, Get, HttpCode, Param, Post, Query, Req, UseGuards } from "@nestjs/common";
import { z } from "zod";
import { AuthGuard, Requires, UUID, WorkspaceGuard, type AuthedRequest } from "../auth/current-user.js";
import { PrismaService } from "../db/prisma.service.js";
import { ProblemException } from "../http/problem.js";
import { ZodPipe } from "../http/zod.js";
import { AssistantService } from "./assistant.service.js";

const CreateBody = z.object({ title: z.string().trim().max(120).optional() });
const AskBody = z.object({
  text: z.string().trim().min(1).max(2000),
  /** The language the UI is showing; falls back to the user's profile language. */
  lang: z.enum(["en", "uk"]).optional(),
  context: z
    .object({
      fieldId: z.string().regex(UUID).optional(),
      recommendationId: z.string().regex(UUID).optional(),
    })
    .default({}),
});

function uuid(id: string): string {
  if (!UUID.test(id)) throw new ProblemException(404, "not-found");
  return id;
}

/** Conversations with the assistant (S-05.02, S-05.06; Tech Design §12, §14). */
@Controller("w/:ws/conversations")
@UseGuards(AuthGuard, WorkspaceGuard)
export class AssistantController {
  constructor(
    private readonly assistant: AssistantService,
    private readonly prisma: PrismaService,
  ) {}

  @Post()
  @Requires("assistant.use")
  create(@Body(new ZodPipe(CreateBody)) body: z.infer<typeof CreateBody>, @Req() req: AuthedRequest) {
    return this.assistant.create(req.workspaceId!, req.user!.id, body.title);
  }

  @Get()
  @Requires("assistant.use")
  list(@Req() req: AuthedRequest) {
    return this.assistant.list(req.workspaceId!, req.user!.id);
  }

  @Get(":id")
  @Requires("assistant.use")
  get(
    @Param("id") id: string,
    @Query("include") include: string | undefined,
    @Query("limit") limit: string | undefined,
    @Query("before") before: string | undefined,
    @Req() req: AuthedRequest,
  ) {
    // ?include=tools adds tool results (golden-question recordings, audit); only for the chat's owner.
    return this.assistant.get(req.workspaceId!, uuid(id), req.user!.id, include === "tools", {
      limit: limit === undefined || Number.isNaN(Number(limit)) ? undefined : Number(limit),
      before,
    });
  }

  @Post(":id/messages")
  @HttpCode(202)
  @Requires("assistant.use")
  async ask(
    @Param("id") id: string,
    @Body(new ZodPipe(AskBody)) body: z.infer<typeof AskBody>,
    @Req() req: AuthedRequest,
  ) {
    // Answers come in the user's UI language (RFC §12.5).
    const u = await this.prisma.system.user.findUnique({
      where: { id: req.user!.id },
      select: { uiLanguage: true },
    });
    const lang = body.lang ?? (u?.uiLanguage === "uk" ? "uk" : "en");
    return this.assistant.ask(
      { workspaceId: req.workspaceId!, userId: req.user!.id, role: req.role ?? "agronomist", lang },
      uuid(id),
      body.text,
      body.context,
    );
  }

  @Delete(":id")
  @HttpCode(204)
  @Requires("assistant.use")
  async remove(@Param("id") id: string, @Req() req: AuthedRequest) {
    await this.assistant.remove(req.workspaceId!, req.user!.id, uuid(id));
  }
}
