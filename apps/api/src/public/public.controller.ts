import { Body, Controller, Get, Header, HttpCode, Ip, Param, Post, Res } from "@nestjs/common";
import type { Response } from "express";
import { z } from "zod";
import { ProblemException } from "../http/problem.js";
import { ZodPipe } from "../http/zod.js";
import { PublicService } from "./public.service.js";

const PointBody = z.object({ lon: z.number().min(-180).max(180), lat: z.number().min(-90).max(90) }).strict();

/**
 * Routes without a session (S-10.14). Everything here is public: climate numbers and committed outlines, nothing
 * from a workspace. `PUBLIC_EXPLORE=0` answers 404 on all of them.
 */
@Controller("public")
export class PublicController {
  constructor(private readonly pub: PublicService) {}

  private on(): void {
    if (!this.pub.enabled) throw new ProblemException(404, "not-found");
  }

  @Post("climate-shift")
  @HttpCode(200)
  async climateShift(
    @Body(new ZodPipe(PointBody)) body: z.infer<typeof PointBody>,
    @Ip() ip: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    this.on();
    const shift = await this.pub.climateShift(ip, body.lon, body.lat);
    res.setHeader("Cache-Control", shift.status === "ready" ? "public, max-age=3600" : "no-store");
    return shift;
  }

  @Get("outlines")
  @Header("Cache-Control", "public, max-age=3600")
  outlines() {
    this.on();
    return { items: this.pub.listOutlines() };
  }

  @Get("outlines/:id")
  @Header("Cache-Control", "public, max-age=3600")
  outline(@Param("id") id: string) {
    this.on();
    return this.pub.outline(id);
  }
}
