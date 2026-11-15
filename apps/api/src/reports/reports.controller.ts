import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Ip,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from "@nestjs/common";
import { z } from "zod";
import { AuthGuard, Requires, UUID, WorkspaceGuard, type AuthedRequest } from "../auth/current-user.js";
import { RateLimitService } from "../auth/rate-limit.js";
import { hashToken } from "../auth/tokens.js";
import { ProblemException } from "../http/problem.js";
import { ZodPipe } from "../http/zod.js";
import { DecisionsService } from "./decisions.service.js";
import { ReportsService } from "./reports.service.js";

const AnswerBody = z.object({
  answer: z.enum(["approve", "not_now", "question"]),
  text: z.string().max(1000).optional(),
});
const ReplyBody = z.object({ text: z.string().trim().min(1).max(2000) });
const StateQuery = z.enum(["waiting", "question", "decided", "all"]);
const LinkBody = z.object({
  language: z.enum(["uk", "en"]),
  expiresAt: z.string().datetime().nullable().optional(),
});
const LINK_BUCKET = { capacity: 30, refillPerSec: 0.5 };
const TOKEN_BUCKET = { capacity: 60, refillPerSec: 1 };
const ANSWER_BUCKET = { capacity: 10, refillPerSec: 1 / 30 };

function uuid(id: string): string {
  if (!UUID.test(id)) throw new ProblemException(404, "not-found");
  return id;
}

/** Owner decisions in the app and report links (PD v2.7; Tech Design §14). */
@Controller("w/:ws")
@UseGuards(AuthGuard, WorkspaceGuard)
export class ReportsController {
  constructor(
    private readonly reports: ReportsService,
    private readonly decisions: DecisionsService,
  ) {}

  @Get("decisions")
  @Requires("report.read")
  list(@Query("state") state: string | undefined, @Req() req: AuthedRequest) {
    const parsed = StateQuery.safeParse(state ?? "all");
    if (!parsed.success) throw new ProblemException(422, "invalid-input", "Unknown state");
    return this.decisions.list(req.workspaceId!, parsed.data);
  }

  @Post("decisions/:id/answer")
  @HttpCode(200)
  @Requires("report.answer")
  answer(
    @Param("id") id: string,
    @Body(new ZodPipe(AnswerBody)) body: z.infer<typeof AnswerBody>,
    @Req() req: AuthedRequest,
  ) {
    return this.decisions.answer(req.workspaceId!, uuid(id), body, { userId: req.user!.id });
  }

  @Post("decisions/:id/republish")
  @HttpCode(200)
  @Requires("recommendations.act")
  republish(@Param("id") id: string, @Req() req: AuthedRequest) {
    return this.decisions.republish(req.workspaceId!, req.user!.id, uuid(id));
  }

  @Post("decisions/:id/reply-draft")
  @HttpCode(200)
  @Requires("recommendations.act")
  draft(@Param("id") id: string, @Req() req: AuthedRequest) {
    return this.decisions.replyDraft(req.workspaceId!, uuid(id));
  }

  @Post("decisions/:id/replies")
  @HttpCode(200)
  @Requires("recommendations.act")
  reply(
    @Param("id") id: string,
    @Body(new ZodPipe(ReplyBody)) body: z.infer<typeof ReplyBody>,
    @Req() req: AuthedRequest,
  ) {
    return this.decisions.reply(req.workspaceId!, req.user!.id, uuid(id), body.text);
  }

  @Get("report-links")
  @Requires("reportLinks.manage")
  links(@Req() req: AuthedRequest) {
    return this.reports.links(req.workspaceId!);
  }

  @Post("report-links")
  @Requires("reportLinks.manage")
  createLink(@Body(new ZodPipe(LinkBody)) body: z.infer<typeof LinkBody>, @Req() req: AuthedRequest) {
    return this.reports.createLink(req.workspaceId!, req.user!.id, body);
  }

  @Delete("report-links/:id")
  @HttpCode(204)
  @Requires("reportLinks.manage")
  async revoke(@Param("id") id: string, @Req() req: AuthedRequest) {
    await this.reports.revokeLink(req.workspaceId!, req.user!.id, uuid(id));
  }
}

/** The decisions through a link (`/r/:token`): read and answer only; rate-limited (RFC §14.1). */
@Controller("r")
export class ReportLinkController {
  constructor(
    private readonly reports: ReportsService,
    private readonly decisions: DecisionsService,
    private readonly limits: RateLimitService,
  ) {}

  private async guard(token: string, ip: string, answering = false) {
    if (!(await this.limits.take(`reportlink:${ip}`, LINK_BUCKET)))
      throw new ProblemException(429, "rate-limited", "Too many requests");
    // Per link, whoever holds it: a leaked or shared link can't be used to flood answers.
    const id = hashToken(token).slice(0, 16);
    if (!(await this.limits.take(`reportlink:tok:${id}`, TOKEN_BUCKET)))
      throw new ProblemException(429, "rate-limited", "Too many requests");
    if (answering && !(await this.limits.take(`reportlink:ans:${id}`, ANSWER_BUCKET)))
      throw new ProblemException(429, "rate-limited", "Too many answers; try again later");
    return this.reports.byToken(token);
  }

  @Get(":token")
  async report(@Param("token") token: string, @Ip() ip: string) {
    const link = await this.guard(token, ip);
    return this.decisions.publicView(link.workspaceId, link.language);
  }

  @Post(":token/decisions/:id/answer")
  @HttpCode(200)
  async answer(
    @Param("token") token: string,
    @Param("id") id: string,
    @Body(new ZodPipe(AnswerBody)) body: z.infer<typeof AnswerBody>,
    @Ip() ip: string,
  ) {
    const link = await this.guard(token, ip, true);
    return this.decisions.answer(link.workspaceId, uuid(id), body, { link: true });
  }
}
