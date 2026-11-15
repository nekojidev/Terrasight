import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Put,
  Query,
  Req,
  Res,
  UseGuards,
} from "@nestjs/common";
import type { Request, Response } from "express";
import { z } from "zod";
import { AuthGuard, Requires, UUID, WorkspaceGuard, type AuthedRequest } from "../auth/current-user.js";
import { ProblemException } from "../http/problem.js";
import { ZodPipe } from "../http/zod.js";
import { ScoutingService } from "./scouting.service.js";

const PresignBody = z.object({
  pointIdx: z.number().int().min(1).max(5),
  contentType: z.string(),
  bytes: z.number().int().positive(),
});
const SendBody = z.object({
  clientId: z.string().min(8).max(80),
  counts: z.array(z.number().int().min(0).max(20)).max(5),
});

function uuid(id: string): string {
  if (!UUID.test(id)) throw new ProblemException(404, "not-found");
  return id;
}

/** Scouting tasks (S-07.01–S-07.04; Tech Design §11, §14). */
@Controller("w/:ws")
@UseGuards(AuthGuard, WorkspaceGuard)
export class ScoutingController {
  constructor(private readonly scouting: ScoutingService) {}

  @Post("recommendations/:id/scouting-tasks")
  @Requires("scouting.use")
  create(@Param("id") id: string, @Req() req: AuthedRequest) {
    return this.scouting.create(req.workspaceId!, req.user!.id, uuid(id));
  }

  @Get("scouting-tasks/:id")
  @Requires("scouting.use")
  get(@Param("id") id: string, @Req() req: AuthedRequest) {
    return this.scouting.get(req.workspaceId!, uuid(id));
  }

  @Post("scouting-tasks/:id/photos/presign")
  @HttpCode(200)
  @Requires("scouting.use")
  presign(
    @Param("id") id: string,
    @Body(new ZodPipe(PresignBody)) body: z.infer<typeof PresignBody>,
    @Req() req: AuthedRequest,
  ) {
    return this.scouting.presign(req.workspaceId!, req.user!.id, uuid(id), body);
  }

  @Post("scouting-tasks/:id/send")
  @HttpCode(200)
  @Requires("scouting.use")
  send(
    @Param("id") id: string,
    @Body(new ZodPipe(SendBody)) body: z.infer<typeof SendBody>,
    @Req() req: AuthedRequest,
  ) {
    return this.scouting.send(req.workspaceId!, req.user!.id, uuid(id), body);
  }
}

/** Development photo storage behind signed URLs (used only when S3_BUCKET is not set). */
@Controller("scouting-photos")
export class ScoutingPhotosController {
  constructor(private readonly scouting: ScoutingService) {}

  @Put(":photoId")
  @HttpCode(204)
  async put(
    @Param("photoId") photoId: string,
    @Query("exp") exp: string,
    @Query("sig") sig: string,
    @Req() req: Request,
  ) {
    if (!this.scouting.verify(uuid(photoId), "put", Number(exp), sig ?? ""))
      throw new ProblemException(403, "forbidden", "The upload link has expired");
    await this.scouting.putLocal(photoId, req);
  }

  @Get(":photoId")
  async get(
    @Param("photoId") photoId: string,
    @Query("exp") exp: string,
    @Query("sig") sig: string,
    @Res() res: Response,
  ) {
    if (!this.scouting.verify(uuid(photoId), "get", Number(exp), sig ?? ""))
      throw new ProblemException(403, "forbidden", "The photo link has expired");
    const f = await this.scouting.getLocal(photoId);
    res.setHeader("Content-Type", f.contentType);
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Content-Security-Policy", "default-src 'none'; sandbox");
    res.setHeader("Content-Disposition", "inline");
    res.setHeader("Cache-Control", "private, max-age=300");
    f.stream.pipe(res);
  }
}
