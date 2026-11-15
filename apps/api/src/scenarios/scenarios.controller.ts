import { Body, Controller, Get, Param, ParseIntPipe, Post, Put, Req, UseGuards } from "@nestjs/common";
import { z } from "zod";
import { AuthGuard, Requires, UUID, WorkspaceGuard, type AuthedRequest } from "../auth/current-user.js";
import { COST_BUCKETS, RateLimitService } from "../auth/rate-limit.js";
import { ProblemException } from "../http/problem.js";
import { ZodPipe } from "../http/zod.js";
import { FarmStressService } from "./farm-stress.service.js";
import { ScenariosService } from "./scenarios.service.js";
import { YearSetsService } from "./year-sets.service.js";

const RunBody = z.object({
  overrides: z
    .object({
      waterCapMm: z.number().min(0).max(2000).optional(),
      deltaT: z.number().min(-3).max(5).optional(),
      precipFactor: z.number().min(0.5).max(1.5).optional(),
    })
    .default({}),
});
const PlanBody = z.object({
  crop: z.string().min(1).max(40),
  rotationId: z.string().max(80).nullable().optional(),
  scenarioRunId: z.string().regex(UUID).nullable().optional(),
});

function uuid(id: string): string {
  if (!UUID.test(id)) throw new ProblemException(404, "not-found");
  return id;
}

/** Rotations overview for the workspace (sidebar "Rotations"). */
@Controller("w/:ws/rotations")
@UseGuards(AuthGuard, WorkspaceGuard)
export class RotationsOverviewController {
  constructor(private readonly scenarios: ScenariosService) {}

  @Get()
  @Requires("scenarios.explore")
  overview(@Req() req: AuthedRequest) {
    return this.scenarios.overview(req.workspaceId!);
  }
}

/** Farm stress test: margin at risk if 2022 weather repeats on every field (EP-10, S-10.13). */
@Controller("w/:ws/farm-stress")
@UseGuards(AuthGuard, WorkspaceGuard)
export class FarmStressController {
  constructor(private readonly stress: FarmStressService) {}

  @Get()
  @Requires("brief.read")
  get(@Req() req: AuthedRequest) {
    return this.stress.get(req.workspaceId!);
  }
}

/** Rotation scenarios and the season plan (S-06.03, S-06.06; Tech Design §14). */
@Controller("w/:ws/fields/:id")
@UseGuards(AuthGuard, WorkspaceGuard)
export class ScenariosController {
  constructor(
    private readonly scenarios: ScenariosService,
    private readonly yearSets: YearSetsService,
    private readonly limits: RateLimitService,
  ) {}

  /** Also the entry point of AI-proposed rotations (Gemini), so the per-user bucket is the AI cost limit too. */
  @Post("scenario-runs")
  @Requires("scenarios.explore")
  async run(
    @Param("id") id: string,
    @Body(new ZodPipe(RunBody)) body: z.infer<typeof RunBody>,
    @Req() req: AuthedRequest,
  ) {
    await this.limits.enforce(`scenario:${req.user!.id}`, COST_BUCKETS.scenarioRun);
    return this.scenarios.run(req.workspaceId!, uuid(id), body.overrides);
  }

  /** The ranking of the same options under different sets of weather years (a sensitivity analysis, not a forecast). */
  @Post("scenario-runs/year-sets")
  @Requires("scenarios.explore")
  async yearSetComparison(
    @Param("id") id: string,
    @Body(new ZodPipe(RunBody)) body: z.infer<typeof RunBody>,
    @Req() req: AuthedRequest,
  ) {
    await this.limits.enforce(`scenario:${req.user!.id}`, COST_BUCKETS.scenarioRun);
    return this.yearSets.compare(req.workspaceId!, uuid(id), body.overrides);
  }

  @Get("scenario-runs/:runId")
  @Requires("scenarios.explore")
  get(@Param("id") id: string, @Param("runId") runId: string, @Req() req: AuthedRequest) {
    return this.scenarios.get(req.workspaceId!, uuid(id), uuid(runId));
  }

  @Get("yield-range")
  @Requires("scenarios.explore")
  yieldRange(@Param("id") id: string, @Req() req: AuthedRequest) {
    return this.scenarios.yieldRange(req.workspaceId!, uuid(id));
  }

  @Get("plans/:season")
  @Requires("scenarios.explore")
  plan(@Param("id") id: string, @Param("season", ParseIntPipe) season: number, @Req() req: AuthedRequest) {
    return this.scenarios.getPlan(req.workspaceId!, uuid(id), season);
  }

  @Put("plans/:season")
  @Requires("plans.save")
  save(
    @Param("id") id: string,
    @Param("season", ParseIntPipe) season: number,
    @Body(new ZodPipe(PlanBody)) body: z.infer<typeof PlanBody>,
    @Req() req: AuthedRequest,
  ) {
    return this.scenarios.savePlan(req.workspaceId!, req.user!.id, uuid(id), season, body);
  }
}
