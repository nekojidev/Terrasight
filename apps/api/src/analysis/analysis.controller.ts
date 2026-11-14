import { Body, Controller, Get, HttpCode, Param, Post, Req, UseGuards } from "@nestjs/common";
import { z } from "zod";
import { AuthGuard, Requires, UUID, WorkspaceGuard, type AuthedRequest } from "../auth/current-user.js";
import { PrismaService } from "../db/prisma.service.js";
import { ProblemException } from "../http/problem.js";
import { ZodPipe } from "../http/zod.js";
import { AnalysisService } from "./analysis.service.js";
import { localDate } from "./scheduler.js";

const StartBody = z.object({ fieldIds: z.array(z.string().regex(UUID)).max(500).optional() });

function uuid(id: string): string {
  if (!UUID.test(id)) throw new ProblemException(404, "not-found");
  return id;
}

/** Analysis runs: "Analyze fields", progress, retry one field (S-03.02, S-03.04; Tech Design §14). */
@Controller("w/:ws/analysis-runs")
@UseGuards(AuthGuard, WorkspaceGuard)
export class AnalysisController {
  constructor(
    private readonly analysis: AnalysisService,
    private readonly prisma: PrismaService,
  ) {}

  private async today(workspaceId: string): Promise<string> {
    const ws = await this.prisma.system.workspace.findUniqueOrThrow({
      where: { id: workspaceId },
      select: { timeZone: true },
    });
    return localDate(ws.timeZone);
  }

  @Post()
  @HttpCode(202)
  @Requires("analysis.run")
  async start(@Body(new ZodPipe(StartBody)) body: z.infer<typeof StartBody>, @Req() req: AuthedRequest) {
    return this.analysis.start(
      req.workspaceId!,
      "manual",
      req.user!.id,
      await this.today(req.workspaceId!),
      body.fieldIds,
    );
  }

  @Get("latest")
  @Requires("brief.read")
  async latest(@Req() req: AuthedRequest) {
    return (await this.analysis.latest(req.workspaceId!)) ?? { id: null };
  }

  @Get(":id")
  @Requires("brief.read")
  get(@Param("id") id: string, @Req() req: AuthedRequest) {
    return this.analysis.view(req.workspaceId!, uuid(id));
  }

  @Post(":id/fields/:fieldId/retry")
  @HttpCode(202)
  @Requires("analysis.run")
  async retry(@Param("id") id: string, @Param("fieldId") fieldId: string, @Req() req: AuthedRequest) {
    return this.analysis.retry(
      req.workspaceId!,
      req.user!.id,
      uuid(id),
      uuid(fieldId),
      await this.today(req.workspaceId!),
    );
  }
}
