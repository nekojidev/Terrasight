import type { SoilGridsSummary } from "./others.js";

/** USDA texture class from clay / sand / silt percent (the standard triangle). */
export function textureClass(clay: number, sand: number, silt: number): string {
  if (silt + 1.5 * clay < 15) return "sand";
  if (silt + 1.5 * clay < 30 && silt + 2 * clay >= 15) return "loamy sand";
  if (clay >= 7 && clay < 20 && sand > 52 && silt + 2 * clay >= 30) return "sandy loam";
  if (clay < 7 && silt < 50 && silt + 2 * clay >= 30) return "sandy loam";
  if (clay >= 7 && clay < 27 && silt >= 28 && silt < 50 && sand <= 52) return "loam";
  if ((silt >= 50 && clay >= 12 && clay < 27) || (silt >= 50 && silt < 80 && clay < 12)) return "silt loam";
  if (silt >= 80 && clay < 12) return "silt";
  if (clay >= 20 && clay < 35 && silt < 28 && sand > 45) return "sandy clay loam";
  if (clay >= 27 && clay < 40 && sand > 20 && sand <= 45) return "clay loam";
  if (clay >= 27 && clay < 40 && sand <= 20) return "silty clay loam";
  if (clay >= 35 && sand > 45) return "sandy clay";
  if (clay >= 40 && silt >= 40) return "silty clay";
  return "clay";
}

type Hsg = "A" | "B" | "C" | "D";
const TEXTURE: Record<string, { awsMmPerM: number; hydrologicGroup: Hsg }> = {
  sand: { awsMmPerM: 60, hydrologicGroup: "A" },
  "loamy sand": { awsMmPerM: 80, hydrologicGroup: "A" },
  "sandy loam": { awsMmPerM: 110, hydrologicGroup: "A" },
  loam: { awsMmPerM: 170, hydrologicGroup: "B" },
  "silt loam": { awsMmPerM: 200, hydrologicGroup: "B" },
  silt: { awsMmPerM: 200, hydrologicGroup: "B" },
  "sandy clay loam": { awsMmPerM: 130, hydrologicGroup: "C" },
  "clay loam": { awsMmPerM: 160, hydrologicGroup: "C" },
  "silty clay loam": { awsMmPerM: 170, hydrologicGroup: "D" },
  "sandy clay": { awsMmPerM: 120, hydrologicGroup: "D" },
  "silty clay": { awsMmPerM: 150, hydrologicGroup: "D" },
  clay: { awsMmPerM: 140, hydrologicGroup: "D" },
};

/**
 * Tier B/C soil inputs from SoilGrids texture: class-typical available water per metre of root zone and a hydrologic
 * soil group (rough; the app labels it an estimate). Null when texture is missing.
 */
export function soilFromTexture(
  s: SoilGridsSummary,
): { textureClass: string; awsMmPerM: number; hydrologicGroup: Hsg } | null {
  if (s.clayPct == null || s.sandPct == null || s.siltPct == null) return null;
  const cls = textureClass(s.clayPct, s.sandPct, s.siltPct);
  return { textureClass: cls, ...TEXTURE[cls]! };
}
