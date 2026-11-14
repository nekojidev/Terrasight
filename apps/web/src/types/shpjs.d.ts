declare module "shpjs" {
  /** Parses a zipped Shapefile (ArrayBuffer) into GeoJSON FeatureCollection(s). */
  export default function shp(input: ArrayBuffer): Promise<unknown>;
}
