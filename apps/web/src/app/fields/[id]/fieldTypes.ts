export type TaskStatus = "queued" | "running" | "done" | "partial" | "failed" | "cached";

export interface GatherStatus {
  status: string;
  startedAt?: string | null;
  sources: Array<{
    source: string;
    label: string;
    status: TaskStatus;
    reason: string | null;
    dataDate: string | null;
  }>;
}

export interface History {
  built: { at: string; provisional: boolean } | null;
  seasons: Array<{
    season: number;
    mainCrop: string;
    secondCrop: string | null;
    confidence: number;
    source: string;
    isOverride: boolean;
  }>;
  stressYears: Array<{ season: number; reasons: string[] }>;
  /** Per-season weather and greenness used for the stress years (NASA POWER, MODIS). */
  seasonStats?: Array<{
    season: number;
    precipMm?: number | null;
    heatDays?: number | null;
    /** Peak NDVI of the season (MODIS). */
    peak?: number | null;
  }>;
  irrigation: {
    value: "irrigated" | "dryland" | "unknown";
    source: string;
    detection: { status: string; method: string; confidence: number } | null;
  };
  currentRotation: { label: string; share: number; rotationId: string | null } | null;
  regionCrops?: string[];
  cropNames: Record<string, { en: string; uk: string }>;
}

interface Resolved<T> {
  value: T | null;
  source: "confirmed" | "plan" | "estimate" | "regional" | "unknown";
}
export interface SeasonRecord {
  season: number;
  crop: Resolved<string>;
  sowingDate: Resolved<string>;
  emergenceDate: Resolved<string>;
  tillage: Resolved<string>;
  missing: string[];
}

/** Localised crop name; an unknown id never reaches the screen. */
export function cropLabel(names: History["cropNames"], locale: string, id: string): string {
  const n = names[id];
  if (!n) return "—";
  return locale === "uk" ? n.uk : n.en;
}

/** True for a season whose crop was estimated from satellite greenness rather than recorded. */
export function isEstimateSeason(s: History["seasons"][number] | undefined): boolean {
  return Boolean(s && s.source === "ndvi" && !s.isOverride);
}
