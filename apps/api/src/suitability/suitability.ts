import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ProblemException } from "../http/problem.js";
import {
  blocksCrops,
  landSuitability,
  type LandCoverClass,
  type LandSuitability,
  type LandSuitabilityConfig,
  type SuitabilityInputs,
  type SuitabilityOverride,
} from "@terrasight/evaluators";
import {
  landCoverFromCdl,
  type CdlHistory,
  type CroplandHistory,
  type SoilGridsSummary,
  type SoilSummary,
} from "@terrasight/sources";

let cached: { dir: string; cfg: LandSuitabilityConfig } | undefined;

/** data/land-suitability.json (read once per data dir). */
export function loadSuitabilityConfig(dataDir: string): LandSuitabilityConfig {
  if (cached?.dir !== dataDir)
    cached = {
      dir: dataDir,
      cfg: JSON.parse(readFileSync(join(dataDir, "land-suitability.json"), "utf8")) as LandSuitabilityConfig,
    };
  return cached.cfg;
}

export interface SuitabilitySources {
  irrigated?: boolean | null;
  slopePct?: number | null;
  /** US soil (SSURGO payload). */
  ssurgo?: SoilSummary | null;
  /** SoilGrids payload (outside the US). */
  grids?: SoilGridsSummary | null;
  cdl?: CdlHistory | null;
  cropland?: CroplandHistory | null;
  /** NDVI peak per season. */
  ndviPeaks?: Array<number | null> | null;
}

/** Gathered source payloads → evaluator inputs. Each missing source just leaves its check out. */
export function buildSuitabilityInputs(s: SuitabilitySources): SuitabilityInputs {
  const croplandSeasons = (s.cropland?.seasons ?? []).flatMap((x) => (x.shares ? [{ year: x.year, shares: x.shares }] : []));
  const landCover: SuitabilityInputs["landCover"] = croplandSeasons.length
    ? { source: s.cropland!.product, seasons: croplandSeasons }
    : s.cdl?.seasons.length
      ? { source: "USDA Cropland Data Layer", seasons: landCoverFromCdl(s.cdl).sort((a, b) => a.year - b.year) }
      : null;
  return {
    irrigated: s.irrigated ?? null,
    lcc: s.ssurgo?.capability ?? null,
    landCover,
    slopePct: s.slopePct ?? null,
    soil: {
      coarseFragmentsPct: s.grids?.cfvoPct ?? null,
      ph: s.grids?.ph ?? null,
      sandPct: s.grids?.sandPct ?? null,
      ocGPerKg: s.grids?.ocGPerKg ?? null,
      bedrockDepthCm: s.ssurgo?.bedrockDepthCm ?? null,
    },
    ndviPeaks: s.ndviPeaks ?? null,
  };
}

/** What is stored in fields.suitability. */
export type StoredSuitability = LandSuitability & { computedAt: string };

export interface SuitabilityView extends Omit<StoredSuitability, "computedAt"> {
  computedAt: string | null;
  /** An agronomist's "still cropland" override, with who and when. */
  override: SuitabilityOverride | null;
  /** True while crop recommendations are stopped: unsuitable and not overridden. */
  blocked: boolean;
}

export function compute(sources: SuitabilitySources, cfg: LandSuitabilityConfig, now = new Date()): StoredSuitability {
  return { ...landSuitability(buildSuitabilityInputs(sources), cfg), computedAt: now.toISOString() };
}

/** Stored JSON columns → what the API returns; null when the check has not run yet. */
export function suitabilityView(stored: unknown, override: unknown): SuitabilityView | null {
  if (!stored || typeof stored !== "object") return null;
  const s = stored as Partial<StoredSuitability>;
  if (!s.status) return null;
  const o = override && typeof override === "object" ? (override as SuitabilityOverride) : null;
  return {
    status: s.status,
    reasons: s.reasons ?? [],
    ...(s.share ? { share: s.share } : {}),
    checked: s.checked ?? [],
    thresholdsVersion: s.thresholdsVersion ?? 0,
    computedAt: s.computedAt ?? null,
    override: o,
    blocked: blocksCrops({ status: s.status }, o),
  };
}

interface FieldReader {
  field: {
    findUnique(args: {
      where: { id: string };
      select: { suitability: true; suitabilityOverride: true };
    }): Promise<{ suitability: unknown; suitabilityOverride: unknown } | null>;
  };
}

/** The land suitability of a field as stored, or null (not computed yet / no such field). */
export async function fieldSuitability(db: FieldReader, fieldId: string): Promise<SuitabilityView | null> {
  const f = await db.field.findUnique({
    where: { id: fieldId },
    select: { suitability: true, suitabilityOverride: true },
  });
  return f ? suitabilityView(f.suitability, f.suitabilityOverride) : null;
}

/** Crop recommendations, plans and crop choices are stopped for an unsuitable field until an agronomist overrides. */
export async function fieldBlocked(db: FieldReader, fieldId: string): Promise<boolean> {
  return (await fieldSuitability(db, fieldId))?.blocked === true;
}

/** 409 when the stored columns of a field say crops are stopped (unsuitable and not overridden). */
export function assertNotBlocked(stored: unknown, override: unknown): void {
  if (suitabilityView(stored, override)?.blocked)
    throw new ProblemException(
      409,
      "land-unsuitable",
      "This land is not suitable for crops. An agronomist can mark it as cropland to continue.",
    );
}

/** The same, reading the field's columns first (endpoints that have not loaded the field yet). */
export async function assertCropAllowed(db: FieldReader, fieldId: string): Promise<void> {
  const f = await db.field.findUnique({
    where: { id: fieldId },
    select: { suitability: true, suitabilityOverride: true },
  });
  if (f) assertNotBlocked(f.suitability, f.suitabilityOverride);
}

/** For the quick check of the add-field preview: the same function on whatever was cheap to fetch. */
export function previewSuitability(
  parts: { ssurgo?: SoilSummary | null; landCover?: { year: number; shares: Partial<Record<LandCoverClass, number>> } | null },
  cfg: LandSuitabilityConfig,
): LandSuitability {
  return landSuitability(
    {
      lcc: parts.ssurgo?.capability ?? null,
      soil: { bedrockDepthCm: parts.ssurgo?.bedrockDepthCm ?? null },
      landCover: parts.landCover
        ? { source: "Esri / Impact Observatory 10 m", seasons: [{ year: parts.landCover.year, shares: parts.landCover.shares }] }
        : null,
    },
    cfg,
  );
}
