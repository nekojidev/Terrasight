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
import { ProblemException } from "../http/problem.js";
import { ZodPipe } from "../http/zod.js";
import { ReportsService } from "./reports.service.js";

const AnswerBody = z.object({
  answer: z.enum(["done", "not_yet", "question"]),
  text: z.string().max(1000).optional(),
});
const ReplyBody = z.object({ text: z.string().trim().min(1).max(2000) });
const LinkBody = z.object({
  language: z.enum(["uk", "en"]),
  expiresAt: z.string().datetime().nullable().optional(),
});
const LINK_BUCKET = { capacity: 30, refillPerSec: 0.5 };

function uuid(id: string): string {
  if (!UUID.test(id)) throw new ProblemException(404, "not-found");
  return id;
}

/** Owner report in the app (S-08.01–S-08.06; Tech Design §14). */
@Controller("w/:ws")
@UseGuards(AuthGuard, WorkspaceGuard)
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}

  @Get("report")
  @Requires("report.read")
  report(@Query("field") field: string | undefined, @Req() req: AuthedRequest) {
    return this.reports.report(req.workspaceId!, undefined, field ? uuid(field) : undefined);
  }

  @Post("report-items/:id/answers")
  @Requires("report.answer")
  answer(
    @Param("id") id: string,
    @Body(new ZodPipe(AnswerBody)) body: z.infer<typeof AnswerBody>,
    @Req() req: AuthedRequest,
  ) {
    return this.reports.answer(req.workspaceId!, uuid(id), body, { userId: req.user!.id });
  }

  @Post("report-items/:id/republish")
  @Requires("recommendations.act")
  republish(@Param("id") id: string, @Req() req: AuthedRequest) {
    return this.reports.republish(req.workspaceId!, req.user!.id, uuid(id));
  }

  @Post("report-items/:id/reply-draft")
  @HttpCode(200)
  @Requires("recommendations.act")
  draft(@Param("id") id: string, @Req() req: AuthedRequest) {
    return this.reports.replyDraft(req.workspaceId!, uuid(id));
  }

  @Post("report-items/:id/replies")
  @Requires("recommendations.act")
  reply(
    @Param("id") id: string,
    @Body(new ZodPipe(ReplyBody)) body: z.infer<typeof ReplyBody>,
    @Req() req: AuthedRequest,
  ) {
    return this.reports.reply(req.workspaceId!, req.user!.id, uuid(id), body.text);
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

/** The report through a link (`/r/:token`): read and answer only; rate-limited (RFC §14.1). */
@Controller("r")
export class ReportLinkController {
  constructor(
    private readonly reports: ReportsService,
    private readonly limits: RateLimitService,
  ) {}

  private async guard(token: string, ip: string) {
    if (!(await this.limits.take(`reportlink:${ip}`, LINK_BUCKET)))
      throw new ProblemException(429, "rate-limited", "Too many requests");
    return this.reports.byToken(token);
  }

  @Get(":token")
  async report(@Param("token") token: string, @Ip() ip: string) {
    const link = await this.guard(token, ip);
    return this.reports.report(link.workspaceId, link.language);
  }

  @Post(":token/items/:id/answers")
  async answer(
    @Param("token") token: string,
    @Param("id") id: string,
    @Body(new ZodPipe(AnswerBody)) body: z.infer<typeof AnswerBody>,
    @Ip() ip: string,
  ) {
    const link = await this.guard(token, ip);
    return this.reports.answer(link.workspaceId, uuid(id), body, { link: true });
  }
}
