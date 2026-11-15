import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Put,
  Req,
  UseGuards,
} from "@nestjs/common";
import { z } from "zod";
import { AuthGuard, Requires, UUID, WorkspaceGuard, type AuthedRequest } from "../auth/current-user.js";
import { COST_BUCKETS, RateLimitService } from "../auth/rate-limit.js";
import { GatherService } from "../gather/gather.service.js";
import { HistoryService } from "../history/history.service.js";
import { ProblemException } from "../http/problem.js";
import { ZodPipe } from "../http/zod.js";
import { SeasonsService } from "../seasons/seasons.service.js";
import { FieldsService } from "./fields.service.js";

const Position = z.tuple([z.number().min(-180).max(180), z.number().min(-90).max(90)]).rest(z.number());
const Ring = z.array(Position).min(4).max(5_000);
const Geometry = z.union([
  z.object({ type: z.literal("Polygon"), coordinates: z.array(Ring).min(1) }),
  z.object({ type: z.literal("MultiPolygon"), coordinates: z.array(z.array(Ring).min(1)).min(1).max(50) }),
]);
const PreviewBody = z.object({ geometry: Geometry });
const CreateBody = z.object({
  name: z.string().trim().min(1).max(80),
  geometry: Geometry,
  irrigated: z.enum(["yes", "no", "unknown"]).default("unknown"),
});
const PatchBody = z
  .object({
    name: z.string().trim().min(1).max(80).optional(),
    irrigation: z.enum(["irrigated", "dryland"]).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, "nothing to change");
const CropBody = z.object({
  mainCrop: z.string().min(1).max(40),
  secondCrop: z.string().min(1).max(40).nullable().default(null),
});
const IsoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const SeasonBody = z.object({
  crop: z.string().min(1).max(40).nullable().optional(),
  sowingDate: IsoDate.nullable().optional(),
  emergenceDate: IsoDate.nullable().optional(),
  irrigated: z.boolean().nullable().optional(),
  tillage: z.enum(["conventional", "reduced", "no_till"]).nullable().optional(),
});

function fieldId(id: string): string {
  if (!UUID.test(id)) throw new ProblemException(404, "not-found");
  return id;
}

/** Fields, gather, history and season record (EP-02; Tech Design §14). */
@Controller("w/:ws/fields")
@UseGuards(AuthGuard, WorkspaceGuard)
export class FieldsController {
  constructor(
    private readonly fields: FieldsService,
    private readonly gather: GatherService,
    private readonly history: HistoryService,
    private readonly seasons: SeasonsService,
    private readonly limits: RateLimitService,
  ) {}

  @Get()
  @Requires("fields.read")
  list(@Req() req: AuthedRequest) {
    return this.fields.list(req.workspaceId!);
  }

  @Post("preview")
  @HttpCode(200)
  @Requires("fields.write")
  async preview(@Body(new ZodPipe(PreviewBody)) body: z.infer<typeof PreviewBody>, @Req() req: AuthedRequest) {
    await this.limits.enforce(`fields:preview:${req.user!.id}`, COST_BUCKETS.fieldPreview);
    return this.fields.preview(body.geometry);
  }

  @Post()
  @Requires("fields.write")
  async create(@Body(new ZodPipe(CreateBody)) body: z.infer<typeof CreateBody>, @Req() req: AuthedRequest) {
    await this.limits.enforce(`fields:create:${req.user!.id}`, COST_BUCKETS.fieldCreate);
    return this.fields.create(req.workspaceId!, req.user!.id, body);
  }

  @Get(":id")
  @Requires("fields.read")
  get(@Param("id") id: string, @Req() req: AuthedRequest) {
    return this.fields.get(req.workspaceId!, fieldId(id));
  }

  @Patch(":id")
  @Requires("fields.write")
  update(
    @Param("id") id: string,
    @Body(new ZodPipe(PatchBody)) body: z.infer<typeof PatchBody>,
    @Req() req: AuthedRequest,
  ) {
    return this.fields.update(req.workspaceId!, req.user!.id, fieldId(id), body);
  }

  @Delete(":id")
  @HttpCode(204)
  @Requires("fields.write")
  async archive(@Param("id") id: string, @Req() req: AuthedRequest): Promise<void> {
    await this.fields.archive(req.workspaceId!, req.user!.id, fieldId(id));
  }

  @Get(":id/gather")
  @Requires("fields.read")
  gatherStatus(@Param("id") id: string, @Req() req: AuthedRequest) {
    return this.gather.status(req.workspaceId!, fieldId(id));
  }

  @Post(":id/gather/sources/:source/retry")
  @HttpCode(200)
  @Requires("fields.write")
  retry(@Param("id") id: string, @Param("source") source: string, @Req() req: AuthedRequest) {
    return this.gather.retry(req.workspaceId!, fieldId(id), source);
  }

  @Get(":id/history")
  @Requires("fields.read")
  historyView(@Param("id") id: string, @Req() req: AuthedRequest) {
    return this.history.get(req.workspaceId!, fieldId(id));
  }

  @Put(":id/crop-seasons/:season")
  @Requires("fields.write")
  overrideSeason(
    @Param("id") id: string,
    @Param("season", ParseIntPipe) season: number,
    @Body(new ZodPipe(CropBody)) body: z.infer<typeof CropBody>,
    @Req() req: AuthedRequest,
  ) {
    if (season < 2000 || season > 2100) throw new ProblemException(422, "invalid-season");
    return this.history.override(
      req.workspaceId!,
      req.user!.id,
      fieldId(id),
      season,
      body.mainCrop,
      body.secondCrop,
    );
  }

  @Get(":id/season-records/current")
  @Requires("fields.read")
  currentSeason(@Param("id") id: string, @Req() req: AuthedRequest) {
    return this.seasons.get(req.workspaceId!, fieldId(id), SeasonsService.currentSeason());
  }

  @Get(":id/season-records/:season")
  @Requires("fields.read")
  season(@Param("id") id: string, @Param("season", ParseIntPipe) season: number, @Req() req: AuthedRequest) {
    return this.seasons.get(req.workspaceId!, fieldId(id), season);
  }

  @Put(":id/season-records/:season")
  @Requires("fields.write")
  putSeason(
    @Param("id") id: string,
    @Param("season", ParseIntPipe) season: number,
    @Body(new ZodPipe(SeasonBody)) body: z.infer<typeof SeasonBody>,
    @Req() req: AuthedRequest,
  ) {
    return this.seasons.put(req.workspaceId!, req.user!.id, fieldId(id), season, body);
  }
}
