import { Controller, Get, Param, ParseIntPipe, Query, Req, UseGuards } from "@nestjs/common";
import { z } from "zod";
import { AuthGuard, Requires, UUID, WorkspaceGuard, type AuthedRequest } from "../auth/current-user.js";
import { ProblemException } from "../http/problem.js";
import { SeasonSuggestService } from "./season-suggest.service.js";

const Query_ = z.object({
  crop: z.string().regex(/^[a-z_]{1,40}$/),
  sowing: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
});

/** GET /w/:ws/fields/:id/season-records/:season/suggest?crop=<id>[&sowing=YYYY-MM-DD] (suggestions, nothing is saved). */
@Controller("w/:ws/fields")
@UseGuards(AuthGuard, WorkspaceGuard)
export class SeasonSuggestController {
  constructor(private readonly suggestions: SeasonSuggestService) {}

  @Get(":id/season-records/:season/suggest")
  @Requires("fields.read")
  async suggest(
    @Param("id") id: string,
    @Param("season", ParseIntPipe) season: number,
    @Query() query: Record<string, string>,
    @Req() req: AuthedRequest,
  ) {
    if (!UUID.test(id)) throw new ProblemException(404, "not-found");
    if (season < 2000 || season > 2100) throw new ProblemException(422, "invalid-season");
    await this.suggestions.assertField(req.workspaceId!, id);
    const q = Query_.safeParse(query);
    if (!q.success) throw new ProblemException(400, "validation", "crop is required; sowing is YYYY-MM-DD");
    if (q.data.sowing && Number.isNaN(Date.parse(q.data.sowing)))
      throw new ProblemException(400, "validation", "sowing is not a date");
    return this.suggestions.suggest(req.workspaceId!, id, season, q.data.crop, q.data.sowing ?? null);
  }
}
