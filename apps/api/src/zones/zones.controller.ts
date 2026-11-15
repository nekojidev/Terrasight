import { Body, Controller, Get, HttpCode, Param, Post, Req, Res, StreamableFile, UseGuards } from "@nestjs/common";
import type { Response } from "express";
import { z } from "zod";
import { AuthGuard, Requires, UUID, WorkspaceGuard, type AuthedRequest } from "../auth/current-user.js";
import { COST_BUCKETS, RateLimitService } from "../auth/rate-limit.js";
import { ProblemException } from "../http/problem.js";
import { ZodPipe } from "../http/zod.js";
import { ZonesService } from "./zones.service.js";

const Rate = z.number().finite().min(0).max(1_000_000_000);
/** Every rate is typed by the agronomist; there are no defaults and nothing is suggested. */
const ExportBody = z.object({
  format: z.enum(["shapefile", "geojson", "isoxml"]),
  rates: z.object({ strong: Rate, variable: Rate, weak: Rate }),
  unit: z.enum(["kg/ha", "seeds/ha", "l/ha"]),
  product: z.string().max(60).optional(),
});

function fieldId(id: string): string {
  if (!UUID.test(id)) throw new ProblemException(404, "not-found");
  return id;
}

/** Rate-map zones of a field (PD FR-ZN-1..3). */
@Controller("w/:ws/fields/:id")
@UseGuards(AuthGuard, WorkspaceGuard)
export class ZonesController {
  constructor(
    private readonly zones: ZonesService,
    private readonly limits: RateLimitService,
  ) {}

  @Post("zones/build")
  @HttpCode(202)
  @Requires("fields.write")
  async build(@Param("id") id: string, @Req() req: AuthedRequest) {
    await this.limits.enforce(`zones:${req.user!.id}`, COST_BUCKETS.zonesBuild);
    return this.zones.build(req.workspaceId!, fieldId(id));
  }

  @Get("zones")
  @Requires("fields.read")
  get(@Param("id") id: string, @Req() req: AuthedRequest) {
    return this.zones.get(req.workspaceId!, fieldId(id));
  }

  @Get("ndvi-latest")
  @Requires("fields.read")
  ndvi(@Param("id") id: string, @Req() req: AuthedRequest) {
    return this.zones.ndviLatest(req.workspaceId!, fieldId(id));
  }

  @Post("zones/export")
  @HttpCode(200)
  @Requires("fields.write")
  async export(
    @Param("id") id: string,
    @Body(new ZodPipe(ExportBody)) body: z.infer<typeof ExportBody>,
    @Req() req: AuthedRequest,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const file = await this.zones.export(req.workspaceId!, fieldId(id), body.format, {
      rates: body.rates,
      unit: body.unit,
      product: body.product,
    });
    res.set({
      "Content-Type": file.contentType,
      "Content-Disposition": `attachment; filename="${file.filename}"`,
      "Cache-Control": "no-store",
    });
    return new StreamableFile(file.body);
  }
}
