"use client";

import "maplibre-gl/dist/maplibre-gl.css";
import { Map as MLMap, NavigationControl, type GeoJSONSource, type ImageSource } from "maplibre-gl";
import { useEffect, useRef } from "react";
import { mapStyle, token } from "@/lib/map-style";

export type Layer = "zones" | "ndvi";

export interface FieldGeometry {
  type: "Polygon" | "MultiPolygon";
  coordinates: number[][][] | number[][][][];
}

export interface NdviImage {
  image: string;
  /** [NW, NE, SE, SW] as [lon, lat]. */
  corners: [number, number][];
}

/** Zone colours come from the design tokens (read at runtime, MapLibre paint needs literals). */
export const ZONE_TOKEN = {
  strong: "--ts-ok",
  variable: "--ts-week-mark",
  weak: "--ts-urgent",
} as const;

function bounds(g: FieldGeometry): [[number, number], [number, number]] {
  const polys = (g.type === "Polygon" ? [g.coordinates] : g.coordinates) as number[][][][];
  let w = 180,
    s = 90,
    e = -180,
    n = -90;
  for (const p of polys)
    for (const [x, y] of p[0]!) {
      w = Math.min(w, x!);
      e = Math.max(e, x!);
      s = Math.min(s, y!);
      n = Math.max(n, y!);
    }
  return [
    [w, s],
    [e, n],
  ];
}

/** Satellite basemap with the field outline, the zones layer and the latest-NDVI layer; the switch only toggles visibility. */
export function ZonesMap(props: {
  geometry: FieldGeometry;
  zones: GeoJSON.FeatureCollection | null;
  ndvi: NdviImage | null;
  layer: Layer;
  label: string;
  /** Tap on a zone (or on empty ground: null). */
  onZone?: (zone: "strong" | "variable" | "weak" | null) => void;
}) {
  const container = useRef<HTMLDivElement>(null);
  const map = useRef<MLMap | null>(null);
  const latest = useRef(props);
  latest.current = props;

  const sync = () => {
    const m = map.current;
    if (!m || !m.isStyleLoaded()) return;
    const { zones, ndvi, layer } = latest.current;
    (m.getSource("zones") as GeoJSONSource | undefined)?.setData(
      zones ?? { type: "FeatureCollection", features: [] },
    );
    const src = m.getSource("ndvi") as ImageSource | undefined;
    if (ndvi) {
      const coordinates = ndvi.corners as [[number, number], [number, number], [number, number], [number, number]];
      if (src) src.updateImage({ url: ndvi.image, coordinates });
      else {
        m.addSource("ndvi", { type: "image", url: ndvi.image, coordinates });
        m.addLayer(
          {
            id: "ndvi",
            type: "raster",
            source: "ndvi",
            paint: { "raster-resampling": "nearest", "raster-fade-duration": 0, "raster-opacity": 0.95 },
          },
          "field-line",
        );
      }
    }
    m.setLayoutProperty("zones-fill", "visibility", layer === "zones" ? "visible" : "none");
    if (m.getLayer("ndvi")) m.setLayoutProperty("ndvi", "visibility", layer === "ndvi" ? "visible" : "none");
  };

  useEffect(() => {
    if (!container.current) return;
    const m = new MLMap({
      container: container.current,
      style: mapStyle(),
      bounds: bounds(props.geometry),
      fitBoundsOptions: { padding: 40, maxZoom: 17 },
      attributionControl: { compact: true },
    });
    m.addControl(new NavigationControl({ showCompass: false }), "bottom-right");
    m.on("load", () => {
      m.addSource("zones", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
      m.addSource("field", {
        type: "geojson",
        data: { type: "Feature", properties: {}, geometry: props.geometry as GeoJSON.Geometry },
      });
      m.addLayer({
        id: "zones-fill",
        type: "fill",
        source: "zones",
        paint: {
          "fill-opacity": 0.6,
          "fill-color": [
            "match",
            ["get", "zone"],
            "strong",
            token(ZONE_TOKEN.strong),
            "variable",
            token(ZONE_TOKEN.variable),
            token(ZONE_TOKEN.weak),
          ],
        },
      });
      m.addLayer({
        id: "field-line",
        type: "line",
        source: "field",
        paint: { "line-color": token("--ts-surface"), "line-width": 2.5 },
      });
      m.on("click", (e) => {
        const hit = m.queryRenderedFeatures(e.point, { layers: ["zones-fill"] })[0];
        const zone = hit?.properties?.zone;
        latest.current.onZone?.(zone === "strong" || zone === "variable" || zone === "weak" ? zone : null);
      });
      m.on("mousemove", "zones-fill", () => (m.getCanvas().style.cursor = "pointer"));
      m.on("mouseleave", "zones-fill", () => (m.getCanvas().style.cursor = ""));
      sync();
    });
    const observer = new MutationObserver(() => {
      if (!m.getLayer("zones-fill")) return;
      m.setPaintProperty("zones-fill", "fill-color", [
        "match",
        ["get", "zone"],
        "strong",
        token(ZONE_TOKEN.strong),
        "variable",
        token(ZONE_TOKEN.variable),
        token(ZONE_TOKEN.weak),
      ]);
      m.setPaintProperty("field-line", "line-color", token("--ts-surface"));
    });
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    map.current = m;
    return () => {
      observer.disconnect();
      m.remove();
      map.current = null;
    };
    // Created once; later props reach the map through `sync`.
  }, []);

  useEffect(() => {
    const m = map.current;
    if (!m) return;
    if (m.isStyleLoaded()) sync();
    else m.once("load", sync);
  }, [props.zones, props.ndvi, props.layer]);

  return (
    <div
      ref={container}
      role="application"
      aria-label={props.label}
      className="h-[46dvh] min-h-64 w-full overflow-hidden rounded-hero sm:h-[460px]"
    />
  );
}
