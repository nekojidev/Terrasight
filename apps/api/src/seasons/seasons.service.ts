import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Inject, Injectable } from "@nestjs/common";
import { ENV, type Env } from "../config/config.js";
import { PrismaService } from "../db/prisma.service.js";
import type { ValueSource } from "../generated/prisma/enums.js";
import { ProblemException } from "../http/problem.js";
import { assertNotBlocked } from "../suitability/suitability.js";

/** data/crop-calendar.json: typical sowing dates per region and crop (rules of thumb, `verify: true`). */
interface CropCalendar {
  regions: Record<
    string,
    {
      verify: boolean;
      sowing: Record<string, string>;
      /** Recommended sowing window per crop, [from, to] as MM-DD (v2). */
      windows?: Record<string, [string, string]>;
    }
  >;
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
  /** What dependent models will report as missing: ids `crop`, `sowingDate`, `emergenceDate`, `irrigation` (the UI localises them). */
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

  private readonly planFirstSeason: number;

  constructor(
    private readonly prisma: PrismaService,
    @Inject(ENV) env: Env,
  ) {
    this.planFirstSeason = env.PLAN_FIRST_SEASON;
    this.calendar = JSON.parse(
      readFileSync(join(env.DATA_DIR, "crop-calendar.json"), "utf8"),
    ) as CropCalendar;
  }

  /**
   * The saved plan for a season. The plan horizon is fixed (PLAN_FIRST_SEASON, RFC §7.7: 2026–2030); while the calendar
   * season is already past its first season, the plan for the first season stands in for it (decision 2026-11-14).
   */
  async planFor(fieldId: string, season: number) {
    const exact = await this.prisma.db.plan.findUnique({
      where: { fieldId_season: { fieldId, season } },
    });
    if (exact || season <= this.planFirstSeason) return exact;
    return this.prisma.db.plan.findUnique({
      where: { fieldId_season: { fieldId, season: this.planFirstSeason } },
    });
  }

  /** The region's typical sowing dates, crop → "MM-DD" (crop calendar). */
  sowingCalendar(regionId: string | null): Record<string, string> {
    return (regionId && this.calendar.regions[regionId]?.sowing) || {};
  }

  /** Recommended sowing windows of a region, crop → [from, to] as MM-DD; empty when the calendar has none. */
  sowingWindows(regionId: string | null): Record<string, [string, string]> {
    return (regionId && this.calendar.regions[regionId]?.windows) || {};
  }

  /** true when the region's calendar is still a rule of thumb (`verify: true`). */
  calendarUnverified(regionId: string | null): boolean {
    return !regionId || this.calendar.regions[regionId]?.verify !== false;
  }

  /** Typical sowing date of a crop in a region for a harvest year (crop calendar, `regional`); autumn sowing falls in the year before. */
  typicalSowing(regionId: string | null, crop: string | null, season: number): string | null {
    const mmdd = regionId && crop ? this.calendar.regions[regionId]?.sowing[crop] : undefined;
    if (!mmdd) return null;
    const year = Number(mmdd.slice(0, 2)) >= 8 ? season - 1 : season;
    return `${year}-${mmdd}`;
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
      this.prisma.db.seasonRecord.findUnique({ where: { fieldId_season: { fieldId, season } } }),
      this.planFor(fieldId, season),
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
      ? {
          value: record.tillage,
          source: record.tillageSource === "unknown" ? "confirmed" : record.tillageSource,
        }
      : { value: null, source: "unknown" };

    const missing = [
      ...(crop.value ? [] : ["crop"]),
      ...(sowingDate.value ? [] : ["sowingDate"]),
      ...(emergenceDate.value ? [] : ["emergenceDate"]),
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
      /** A value saved untouched from a recommendation keeps its origin (`plan`, `estimate`, `regional`) instead of `confirmed`. */
      sources?: Partial<
        Record<
          "crop" | "sowingDate" | "emergenceDate" | "tillage",
          Exclude<ValueSource, "confirmed" | "unknown">
        >
      >;
    },
  ): Promise<SeasonRecordView> {
    const field = await this.prisma.db.field.findFirst({
      where: { id: fieldId, workspaceId, archivedAt: null },
      select: { id: true, suitability: true, suitabilityOverride: true },
    });
    if (!field) throw new ProblemException(404, "not-found");
    if (input.crop) assertNotBlocked(field.suitability, field.suitabilityOverride); // choosing a crop on unsuitable land
    const date = (v: string | null | undefined) =>
      v === undefined ? undefined : v === null ? null : new Date(`${v}T00:00:00Z`);
    const src = (k: "crop" | "sowingDate" | "emergenceDate" | "tillage", has: boolean): ValueSource =>
      has ? (input.sources?.[k] ?? "confirmed") : "unknown";
    const data = {
      ...(input.crop !== undefined ? { crop: input.crop, cropSource: src("crop", !!input.crop) } : {}),
      ...(input.sowingDate !== undefined
        ? {
            sowingDate: date(input.sowingDate),
            sowingSource: src("sowingDate", !!input.sowingDate),
          }
        : {}),
      ...(input.emergenceDate !== undefined
        ? {
            emergenceDate: date(input.emergenceDate),
            emergenceSource: src("emergenceDate", !!input.emergenceDate),
          }
        : {}),
      ...(input.irrigated !== undefined ? { irrigated: input.irrigated } : {}),
      ...(input.tillage !== undefined
        ? { tillage: input.tillage, tillageSource: src("tillage", !!input.tillage) }
        : {}),
      updatedBy: userId,
    };
    await this.prisma.db.seasonRecord.upsert({
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
