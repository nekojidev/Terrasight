import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Inject, Injectable } from "@nestjs/common";
import { ENV, type Env } from "../config/config.js";
import { PrismaService } from "../db/prisma.service.js";
import type { ValueSource } from "../generated/prisma/enums.js";
import { ProblemException } from "../http/problem.js";

/** data/crop-calendar.json: typical sowing dates per region and crop (rules of thumb, `verify: true`). */
interface CropCalendar {
  regions: Record<string, { verify: boolean; sowing: Record<string, string> }>;
}

export interface ResolvedValue<T> {
  value: T | null;
  source: ValueSource;
}

export interface SeasonRecordView {
  season: number;
  crop: ResolvedValue<string>;
  sowingDate: ResolvedValue<string>;
  emergenceDate: ResolvedValue<string>;
  irrigated: ResolvedValue<boolean>;
  tillage: ResolvedValue<string>;
  /** What dependent models will report as missing. */
  missing: string[];
}

const iso = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10) : null);

/**
 * Current-season record with the source of each value (RFC §6.4):
 * confirmed by the agronomist → saved plan → NDVI estimate → regional typical date → unknown.
 */
@Injectable()
export class SeasonsService {
  private readonly calendar: CropCalendar;

  constructor(
    private readonly prisma: PrismaService,
    @Inject(ENV) env: Env,
  ) {
    this.calendar = JSON.parse(
      readFileSync(join(env.DATA_DIR, "crop-calendar.json"), "utf8"),
    ) as CropCalendar;
  }

  /** The season a field is in on `date`: harvest year; autumn-sown winter crops count toward next year. */
  static currentSeason(date = new Date()): number {
    return date.getUTCMonth() >= 7 ? date.getUTCFullYear() + 1 : date.getUTCFullYear();
  }

  async get(workspaceId: string, fieldId: string, season: number): Promise<SeasonRecordView> {
    const field = await this.prisma.db.field.findFirst({
      where: { id: fieldId, workspaceId, archivedAt: null },
      select: { regionId: true, irrigation: true, irrigationSource: true },
    });
    if (!field) throw new ProblemException(404, "not-found");
    const [record, plan] = await Promise.all([
      this.prisma.system.seasonRecord.findUnique({ where: { fieldId_season: { fieldId, season } } }),
      this.prisma.system.plan.findUnique({ where: { fieldId_season: { fieldId, season } } }),
    ]);

    const crop: ResolvedValue<string> =
      record?.crop && record.cropSource === "confirmed"
        ? { value: record.crop, source: "confirmed" }
        : plan
          ? { value: plan.crop, source: "plan" }
          : record?.crop
            ? { value: record.crop, source: record.cropSource }
            : { value: null, source: "unknown" };

    const regional =
      crop.value && field.regionId ? this.calendar.regions[field.regionId]?.sowing[crop.value] : undefined;
    const regionalDate = regional
      ? `${regional.startsWith("09") || regional.startsWith("10") || regional.startsWith("11") ? season - 1 : season}-${regional}`
      : null;
    const sowingDate: ResolvedValue<string> = record?.sowingDate
      ? { value: iso(record.sowingDate), source: record.sowingSource }
      : regionalDate
        ? { value: regionalDate, source: "regional" }
        : { value: null, source: "unknown" };
    const emergenceDate: ResolvedValue<string> = record?.emergenceDate
      ? { value: iso(record.emergenceDate), source: record.emergenceSource }
      : { value: null, source: "unknown" };
    const irrigated: ResolvedValue<boolean> =
      record?.irrigated !== null && record?.irrigated !== undefined
        ? { value: record.irrigated, source: "confirmed" }
        : field.irrigation === "unknown"
          ? { value: null, source: "unknown" }
          : { value: field.irrigation === "irrigated", source: field.irrigationSource };
    const tillage: ResolvedValue<string> = record?.tillage
      ? { value: record.tillage, source: "confirmed" }
      : { value: null, source: "unknown" };

    const missing = [
      ...(crop.value ? [] : ["crop"]),
      ...(sowingDate.value ? [] : ["sowing date"]),
      ...(emergenceDate.value ? [] : ["emergence date"]),
      ...(irrigated.value === null ? ["irrigation"] : []),
    ];
    return { season, crop, sowingDate, emergenceDate, irrigated, tillage, missing };
  }

  /** The agronomist confirms or edits values; edited values become "confirmed" (S-02.08). */
  async put(
    workspaceId: string,
    userId: string,
    fieldId: string,
    season: number,
    input: {
      crop?: string | null;
      sowingDate?: string | null;
      emergenceDate?: string | null;
      irrigated?: boolean | null;
      tillage?: string | null;
    },
  ): Promise<SeasonRecordView> {
    const field = await this.prisma.db.field.findFirst({
      where: { id: fieldId, workspaceId, archivedAt: null },
      select: { id: true },
    });
    if (!field) throw new ProblemException(404, "not-found");
    const date = (v: string | null | undefined) =>
      v === undefined ? undefined : v === null ? null : new Date(`${v}T00:00:00Z`);
    const data = {
      ...(input.crop !== undefined
        ? { crop: input.crop, cropSource: (input.crop ? "confirmed" : "unknown") as ValueSource }
        : {}),
      ...(input.sowingDate !== undefined
        ? {
            sowingDate: date(input.sowingDate),
            sowingSource: (input.sowingDate ? "confirmed" : "unknown") as ValueSource,
          }
        : {}),
      ...(input.emergenceDate !== undefined
        ? {
            emergenceDate: date(input.emergenceDate),
            emergenceSource: (input.emergenceDate ? "confirmed" : "unknown") as ValueSource,
          }
        : {}),
      ...(input.irrigated !== undefined ? { irrigated: input.irrigated } : {}),
      ...(input.tillage !== undefined ? { tillage: input.tillage } : {}),
      updatedBy: userId,
    };
    await this.prisma.system.seasonRecord.upsert({
      where: { fieldId_season: { fieldId, season } },
      create: { fieldId, season, ...data },
      update: data,
    });
    await this.prisma.db.auditLog.create({
      data: { workspaceId, userId, action: "season.update", target: `${fieldId}:${season}` },
    });
    return this.get(workspaceId, fieldId, season);
  }
}
