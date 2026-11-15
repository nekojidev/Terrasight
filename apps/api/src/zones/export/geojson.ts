import { cleanLabel, ZONE_ORDER, type ExportFile, type ExportZone, type RateInput } from "./types.js";

/** RFC 7946 FeatureCollection, one feature per zone with the agronomist's rate in `RATE`. */
export function geojsonFile(zones: ExportZone[], input: RateInput, fieldName: string, base: string): ExportFile {
  const product = cleanLabel(input.product);
  const features = ZONE_ORDER.flatMap((z) => {
    const zone = zones.find((x) => x.zone === z);
    if (!zone) return [];
    return [
      {
        type: "Feature" as const,
        properties: {
          ZONE: z,
          RATE: input.rates[z],
          UNIT: input.unit,
          PRODUCT: product || null,
          AREA_HA: Math.round(zone.areaHa * 1000) / 1000,
          SHARE: Math.round(zone.share * 10_000) / 10_000,
        },
        geometry: { type: "MultiPolygon" as const, coordinates: zone.coordinates },
      },
    ];
  });
  const body = JSON.stringify({ type: "FeatureCollection", name: fieldName, features });
  return { filename: `${base}.geojson`, contentType: "application/geo+json", body: Buffer.from(body, "utf8") };
}
