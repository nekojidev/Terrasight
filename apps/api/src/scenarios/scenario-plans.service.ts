import { Inject, Injectable } from "@nestjs/common";
import type { Library } from "@terrasight/library";
import { ENV, type Env } from "../config/config.js";
import { PrismaService } from "../db/prisma.service.js";
import { ProblemException } from "../http/problem.js";
import { LIBRARY } from "../library/library.module.js";

/** The season plan (S-06.06) and the rotations overview. */
@Injectable()
export class ScenarioPlansService {
  constructor(
    @Inject(ENV) private readonly env: Env,
    @Inject(LIBRARY) private readonly lib: Library,
    private readonly prisma: PrismaService,
  ) {}
  /** "Save to the 2026 plan" (S-06.06): the crop and rotation for the season; the season record reads it as "From plan". */
  async savePlan(
    workspaceId: string,
    userId: string,
    fieldId: string,
    season: number,
    body: { crop: string; rotationId?: string | null; scenarioRunId?: string | null },
  ) {
    const field = await this.prisma.db.field.findFirst({
      where: { id: fieldId, workspaceId, archivedAt: null },
      select: { id: true },
    });
    if (!field) throw new ProblemException(404, "not-found");
    if (!this.lib.rotations.crops[body.crop]) throw new ProblemException(422, "unknown-crop", "Unknown crop");
    if (body.scenarioRunId) {
      // The run must belong to this very field (and so this workspace): a foreign run id is "not found".
      const run = await this.prisma.db.scenarioRun.findFirst({
        where: { id: body.scenarioRunId, fieldId, field: { workspaceId } },
        select: { id: true },
      });
      if (!run) throw new ProblemException(404, "not-found");
    }
    const data = {
      crop: body.crop,
      rotationId: body.rotationId ?? null,
      scenarioRunId: body.scenarioRunId ?? null,
      savedBy: userId,
      savedAt: new Date(),
    };
    const plan = await this.prisma.db.plan.upsert({
      where: { fieldId_season: { fieldId, season } },
      create: { fieldId, season, ...data },
      update: data,
    });
    await this.prisma.db.auditLog.create({
      data: { workspaceId, userId, action: "plan.save", target: `${fieldId}:${season}:${body.crop}` },
    });
    return { season: plan.season, crop: plan.crop, rotationId: plan.rotationId, savedAt: plan.savedAt };
  }

  /** Rotations overview (sidebar "Rotations"): each field's plan for the first season and its rotation item. */
  async overview(workspaceId: string) {
    const season = this.env.PLAN_FIRST_SEASON;
    const fields = await this.prisma.db.field.findMany({
      where: { workspaceId, archivedAt: null },
      select: {
        id: true,
        name: true,
        aliasNo: true,
        regionId: true,
        irrigation: true,
        areaHa: true,
        countyName: true,
      },
      orderBy: { aliasNo: "asc" },
    });
    const ids = fields.map((f) => f.id);
    const [plans, recs, crops] = await Promise.all([
      this.prisma.db.plan.findMany({ where: { fieldId: { in: ids }, season } }),
      this.prisma.db.recommendation.findMany({
        where: {
          workspaceId,
          fieldId: { in: ids },
          type: "rotation",
          season,
          status: { in: ["open", "accepted", "snoozed", "in_report"] },
        },
      }),
      this.prisma.db.cropSeason.findMany({ where: { fieldId: { in: ids } }, orderBy: { season: "asc" } }),
    ]);
    return {
      season,
      horizon: [season, season + 4],
      cropNames: Object.fromEntries(
        Object.entries(this.lib.rotations.crops).map(([id, c]) => [id, { en: c.en, uk: c.uk }]),
      ),
      fields: fields.map((f) => {
        const plan = plans.find((p) => p.fieldId === f.id);
        const rec = recs.find((r) => r.fieldId === f.id);
        const drivers = ((rec?.drivers as Array<{ driver: string; value: unknown }>) ?? []).reduce<
          Record<string, unknown>
        >((a, d) => ({ ...a, [d.driver]: d.value }), {});
        return {
          fieldId: f.id,
          name: f.name,
          areaHa: f.areaHa,
          county: f.countyName,
          irrigation: f.irrigation,
          hasLibrary: Boolean(
            f.regionId && this.lib.rotations.rotations.some((r) => r.region === f.regionId),
          ),
          recent: crops
            .filter((c) => c.fieldId === f.id)
            .slice(-5)
            .map((c) => ({ season: c.season, crop: c.mainCrop })),
          plan: plan ? { crop: plan.crop, rotationId: plan.rotationId, savedAt: plan.savedAt } : null,
          recommendation: rec
            ? {
                id: rec.id,
                level: rec.level,
                firstCrop: (drivers.first_crop as string) ?? null,
                bestOption: (drivers.best_option as string) ?? null,
                deadline: rec.deadline?.toISOString().slice(0, 10) ?? null,
                keyNumbers: rec.keyNumbers,
              }
            : null,
        };
      }),
    };
  }

  async getPlan(workspaceId: string, fieldId: string, season: number) {
    const field = await this.prisma.db.field.findFirst({
      where: { id: fieldId, workspaceId },
      select: { id: true },
    });
    if (!field) throw new ProblemException(404, "not-found");
    const plan = await this.prisma.db.plan.findUnique({ where: { fieldId_season: { fieldId, season } } });
    return plan
      ? { season: plan.season, crop: plan.crop, rotationId: plan.rotationId, savedAt: plan.savedAt }
      : null;
  }
}
