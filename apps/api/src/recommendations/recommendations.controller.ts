import { Body, Controller, Get, HttpCode, Param, Patch, Post, Req, UseGuards } from "@nestjs/common";
import { z } from "zod";
import { AuthGuard, Requires, UUID, WorkspaceGuard, type AuthedRequest } from "../auth/current-user.js";
import { ProblemException } from "../http/problem.js";
import { ZodPipe } from "../http/zod.js";
import { RecommendationsService } from "./recommendations.service.js";

const Localised = z.object({ en: z.string().trim().min(1).max(500), uk: z.string().trim().min(1).max(500) });
const TextBody = z
  .object({ title: Localised.optional(), action: Localised.optional() })
  .refine((v) => v.title || v.action, "nothing to change");
const AcceptBody = z.object({ note: z.string().trim().max(1000).optional(), text: TextBody.optional() });

const AskOwnerBody = z.object({ note: z.string().trim().max(1000).optional() });

function uuid(id: string): string {
  if (!UUID.test(id)) throw new ProblemException(404, "not-found");
  return id;
}

/** Recommendation detail and lifecycle actions (Tech Design §10.3, §14). */
@Controller("w/:ws/recommendations")
@UseGuards(AuthGuard, WorkspaceGuard)
export class RecommendationsController {
  constructor(private readonly recs: RecommendationsService) {}

  @Get(":id")
  @Requires("brief.read")
  get(@Param("id") id: string, @Req() req: AuthedRequest) {
    return this.recs.get(req.workspaceId!, uuid(id));
  }

  @Post(":id/accept")
  @HttpCode(200)
  @Requires("recommendations.act")
  accept(
    @Param("id") id: string,
    @Body(new ZodPipe(AcceptBody)) body: z.infer<typeof AcceptBody>,
    @Req() req: AuthedRequest,
  ) {
    return this.recs.accept(req.workspaceId!, req.user!.id, uuid(id), body);
  }

  @Post(":id/ask-owner")
  @HttpCode(200)
  @Requires("recommendations.act")
  askOwner(
    @Param("id") id: string,
    @Body(new ZodPipe(AskOwnerBody)) body: z.infer<typeof AskOwnerBody>,
    @Req() req: AuthedRequest,
  ) {
    return this.recs.askOwner(req.workspaceId!, req.user!.id, uuid(id), body);
  }

  @Post(":id/snooze")
  @HttpCode(200)
  @Requires("recommendations.act")
  snooze(@Param("id") id: string, @Req() req: AuthedRequest) {
    return this.recs.snooze(req.workspaceId!, req.user!.id, uuid(id));
  }

  @Post(":id/undo")
  @HttpCode(200)
  @Requires("recommendations.act")
  undo(@Param("id") id: string, @Req() req: AuthedRequest) {
    return this.recs.undo(req.workspaceId!, req.user!.id, uuid(id));
  }

  @Post(":id/dismiss")
  @HttpCode(200)
  @Requires("recommendations.act")
  dismiss(@Param("id") id: string, @Req() req: AuthedRequest) {
    return this.recs.dismiss(req.workspaceId!, req.user!.id, uuid(id));
  }

  @Patch(":id")
  @Requires("recommendations.act")
  edit(
    @Param("id") id: string,
    @Body(new ZodPipe(TextBody)) body: z.infer<typeof TextBody>,
    @Req() req: AuthedRequest,
  ) {
    return this.recs.edit(req.workspaceId!, req.user!.id, uuid(id), body);
  }
}
