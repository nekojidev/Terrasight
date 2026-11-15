import type { StyleSpecification } from "maplibre-gl";

export type LngLat = [number, number];

/**
 * Satellite basemap for outlining fields. Default: EOX Sentinel-2 cloudless 2016 (CC BY 4.0; later EOX years are
 * non-commercial). Override with NEXT_PUBLIC_BASEMAP_TILES (an XYZ template) for another provider.
 */
export const BASEMAP =
  process.env.NEXT_PUBLIC_BASEMAP_TILES ??
  "https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless_3857/default/g/{z}/{y}/{x}.jpg";
export const ATTRIBUTION =
  process.env.NEXT_PUBLIC_BASEMAP_ATTRIBUTION ??
  'Sentinel-2 cloudless — <a href="https://s2maps.eu" target="_blank" rel="noreferrer">s2maps.eu</a> by EOX IT Services GmbH (contains modified Copernicus Sentinel data 2016)';

/** The one style (basemap + attribution) shared by the outline, scouting and zones maps. Type-only import: no maplibre in this chunk. */
export function mapStyle(): StyleSpecification {
  return {
    version: 8,
    sources: {
      sat: { type: "raster", tiles: [BASEMAP], tileSize: 256, attribution: ATTRIBUTION, maxzoom: 15 },
    },
    layers: [{ id: "sat", type: "raster", source: "sat" }],
  };
}

/** MapLibre paint needs literal colours: read them from design/tokens.css at runtime. */
export function token(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}
