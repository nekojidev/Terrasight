export type ZoneName = "strong" | "variable" | "weak";
export const ZONE_ORDER: ZoneName[] = ["strong", "variable", "weak"];
export type RateUnit = "kg/ha" | "seeds/ha" | "l/ha";

/** A zone as stored: GeoJSON MultiPolygon coordinates, [lon, lat]. */
export interface ExportZone {
  zone: ZoneName;
  areaHa: number;
  share: number;
  coordinates: number[][][][];
}

export interface RateInput {
  rates: Record<ZoneName, number>;
  unit: RateUnit;
  /** Free-text label only; never interpreted. */
  product?: string;
}

export interface ExportField {
  name: string;
  /** Field outline, GeoJSON MultiPolygon coordinates. */
  coordinates: number[][][][];
  areaHa: number;
}

export interface ExportFile {
  filename: string;
  contentType: string;
  body: Buffer;
}

/** Plain label: control characters removed, trimmed, bounded. */
export function cleanLabel(s: string | undefined, max = 60): string {
  return Array.from(s ?? "", (ch) => (ch.charCodeAt(0) < 32 || ch.charCodeAt(0) === 127 ? " " : ch))
    .join("")
    .trim()
    .slice(0, max);
}

/** File-name-safe slug of the field name. */
export function slug(s: string): string {
  const out = s
    .normalize("NFKD")
    .replace(/[^\w.-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40);
  return out || "field";
}
