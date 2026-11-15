import { zip } from "./zip.js";
import { cleanLabel, ZONE_ORDER, type ExportField, type ExportFile, type ExportZone, type RateInput } from "./types.js";

/**
 * ISO 11783-10 (ISOXML) TASKDATA.XML, version 4.2: one task on one partfield, with one treatment zone per
 * Terrasight zone, each a polygon set and a ProcessDataVariable that carries the agronomist's setpoint.
 *
 * Only units with an exact metric conversion are exported:
 *   kg/ha -> DDI 0006 "Setpoint Mass Per Area Application Rate", mg/m2   (x 100)
 *   l/ha  -> DDI 0001 "Setpoint Volume Per Area Application Rate", mm3/m2 (x 100)
 * seeds/ha is not exported to ISOXML (its count DDI and resolution depend on the terminal), use Shapefile.
 *
 * Not validated on a real terminal: the file has no device description, so the terminal maps the setpoint.
 */
export const ISOXML_DDI = {
  "kg/ha": { ddi: "0006", factor: 100 },
  "l/ha": { ddi: "0001", factor: 100 },
} as const;

export class UnsupportedUnit extends Error {
  constructor(public readonly unit: string) {
    super(`ISOXML export does not support ${unit}`);
    this.name = "UnsupportedUnit";
  }
}

export function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

const SQM = (ha: number) => Math.round(ha * 10_000);

function lineString(ring: number[][], type: 1 | 2): string {
  // The ring is closed by implication in ISOXML, so the repeated first point is dropped.
  const pts = ring.slice(0, -1).map(([lon, lat]) => `<PNT A="2" C="${lat!.toFixed(9)}" D="${lon!.toFixed(9)}"/>`);
  return `<LSG A="${type}">${pts.join("")}</LSG>`;
}

function polygon(rings: number[][][], type: number, areaHa?: number): string {
  const [outer, ...holes] = rings;
  const area = areaHa === undefined ? "" : ` C="${SQM(areaHa)}"`;
  return `<PLN A="${type}"${area}>${lineString(outer!, 1)}${holes.map((h) => lineString(h, 2)).join("")}</PLN>`;
}

export function taskDataXml(field: ExportField, zones: ExportZone[], input: RateInput): string {
  const spec = (ISOXML_DDI as Record<string, { ddi: string; factor: number } | undefined>)[input.unit];
  if (!spec) throw new UnsupportedUnit(input.unit);
  const product = cleanLabel(input.product);
  const name = esc(cleanLabel(field.name, 60) || "Field");
  const out: string[] = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<ISO11783_TaskData VersionMajor="4" VersionMinor="2" ManagementSoftwareManufacturer="Terrasight" ManagementSoftwareVersion="1.0" DataTransferOrigin="1">',
  ];
  if (product) out.push(`<PDT A="PDT1" B="${esc(product)}"/>`);
  out.push(
    `<PFD A="PFD1" C="${name}" D="${SQM(field.areaHa)}">`,
    ...field.coordinates.map((p) => polygon(p, 1)),
    "</PFD>",
    `<TSK A="TSK1" B="${name} - rate map" F="PFD1" G="1">`,
  );
  ZONE_ORDER.forEach((z, i) => {
    const zone = zones.find((x) => x.zone === z);
    if (!zone) return;
    const value = Math.round(input.rates[z] * spec.factor);
    out.push(
      `<TZN A="${i + 1}" B="${z}">`,
      ...zone.coordinates.map((p) => polygon(p, 2, undefined)),
      `<PDV A="${spec.ddi}" B="${value}"${product ? ' C="PDT1"' : ""}/>`,
      "</TZN>",
    );
  });
  out.push("</TSK>", "</ISO11783_TaskData>");
  return out.join("\n");
}

/** ZIP with TASKDATA/TASKDATA.XML, the layout a terminal's USB stick expects. */
export function isoxmlZip(field: ExportField, zones: ExportZone[], input: RateInput, base: string): ExportFile {
  const xml = taskDataXml(field, zones, input);
  return {
    filename: `${base}-isoxml.zip`,
    contentType: "application/zip",
    body: zip([{ name: "TASKDATA/TASKDATA.XML", data: Buffer.from(xml, "utf8") }]),
  };
}
