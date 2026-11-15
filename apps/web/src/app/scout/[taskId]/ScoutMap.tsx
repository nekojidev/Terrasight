"use client";

import "maplibre-gl/dist/maplibre-gl.css";
import {
  Map as MLMap,
  Marker,
  NavigationControl,
  getVersion,
  setWorkerUrl,
  type GeoJSONSource,
  type LngLatBoundsLike,
} from "maplibre-gl";
import { useEffect, useRef } from "react";
import { mapStyle, token } from "@/lib/map-style";

/** Same worker and basemap as the outline map (FieldMap). */
if (typeof window !== "undefined") setWorkerUrl(`/maplibre-gl-worker.mjs?v=${getVersion()}`);

export interface ScoutMapProps {
  outline: { type: string; coordinates: number[][][][] | number[][][] } | null;
  points: Array<{ idx: number; lon: number; lat: number }>;
  /** Count per point; null = not checked yet. */
  counts: Array<number | null>;
  at: number;
  onSelect: (i: number) => void;
  user: { lon: number; lat: number } | null;
  label: string;
}

function polygons(o: ScoutMapProps["outline"]): number[][][][] {
  if (!o) return [];
  return o.type === "MultiPolygon" ? (o.coordinates as number[][][][]) : [o.coordinates as number[][][]];
}

/** Satellite map with the field outline, the W-route and numbered check points (design 12). */
export function ScoutMap(props: ScoutMapProps) {
  const box = useRef<HTMLDivElement>(null);
  const map = useRef<MLMap | null>(null);
  const markers = useRef<HTMLButtonElement[]>([]);
  const me = useRef<Marker | null>(null);
  const live = useRef(props);
  live.current = props;

  useEffect(() => {
    if (!box.current) return;
    const p = live.current;
    const polys = polygons(p.outline);
    const coords = [...polys.flatMap((q) => q[0] ?? []), ...p.points.map((x) => [x.lon, x.lat])];
    const m = new MLMap({
      container: box.current,
      style: mapStyle(),
      center: [coords[0]?.[0] ?? -100.88, coords[0]?.[1] ?? 37.97],
      zoom: 14,
      attributionControl: { compact: true },
    });
    m.addControl(new NavigationControl({ showCompass: false }), "bottom-right");
    if (coords.length > 0) {
      const lons = coords.map((c) => c[0]!);
      const lats = coords.map((c) => c[1]!);
      const bounds: LngLatBoundsLike = [
        [Math.min(...lons), Math.min(...lats)],
        [Math.max(...lons), Math.max(...lats)],
      ];
      m.fitBounds(bounds, { padding: 44, maxZoom: 17, duration: 0 });
    }
    m.on("load", () => {
      const signal = token("--ts-signal");
      m.addSource("outline", {
        type: "geojson",
        data: { type: "Feature", properties: {}, geometry: { type: "MultiPolygon", coordinates: polys } },
      });
      m.addLayer({
        id: "outline-fill",
        type: "fill",
        source: "outline",
        paint: { "fill-color": signal, "fill-opacity": 0.22 },
      });
      m.addLayer({
        id: "outline-line",
        type: "line",
        source: "outline",
        paint: { "line-color": signal, "line-width": 3 },
      });
      m.addSource("route", {
        type: "geojson",
        data: {
          type: "Feature",
          properties: {},
          geometry: { type: "LineString", coordinates: p.points.map((x) => [x.lon, x.lat]) },
        },
      });
      m.addLayer({
        id: "route-line",
        type: "line",
        source: "route",
        paint: { "line-color": "white", "line-width": 2, "line-dasharray": [2, 2] },
      });
    });
    markers.current = p.points.map((pt, i) => {
      const el = document.createElement("button");
      el.type = "button";
      el.textContent = String(i + 1);
      el.className =
        "flex items-center justify-center rounded-full border-2 font-mono text-small font-bold shadow-sheet";
      el.style.width = el.style.height = "32px";
      el.addEventListener("click", () => live.current.onSelect(i));
      new Marker({ element: el }).setLngLat([pt.lon, pt.lat]).addTo(m);
      return el;
    });
    map.current = m;
    return () => {
      me.current?.remove();
      me.current = null;
      m.remove();
      map.current = null;
    };
  }, []);

  // Marker state: current (signal), visited (ok), pending (surface).
  useEffect(() => {
    markers.current.forEach((el, i) => {
      const cur = i === props.at;
      const done = props.counts[i] !== null && props.counts[i] !== undefined;
      el.style.background = cur ? "var(--ts-signal)" : done ? "var(--ts-ok)" : "var(--ts-surface)";
      el.style.color = cur ? "var(--ts-on-signal)" : done ? "var(--ts-surface)" : "var(--ts-ink)";
      el.style.borderColor = cur ? "var(--ts-ink)" : "var(--ts-surface)";
      el.style.transform = cur ? "scale(1.3)" : "none";
      el.style.zIndex = cur ? "2" : "1";
      el.setAttribute("aria-current", cur ? "true" : "false");
    });
  }, [props.at, props.counts]);

  // "You are here".
  useEffect(() => {
    const m = map.current;
    if (!m) return;
    if (!props.user) {
      me.current?.remove();
      me.current = null;
      return;
    }
    if (!me.current) {
      const dot = document.createElement("div");
      dot.style.cssText =
        "width:18px;height:18px;border-radius:9999px;background:var(--ts-info);border:3px solid white;box-shadow:0 0 0 6px var(--ts-info-soft)";
      me.current = new Marker({ element: dot });
    }
    me.current.setLngLat([props.user.lon, props.user.lat]).addTo(m);
  }, [props.user]);

  // Keep the outline source in sync if the task is replaced.
  useEffect(() => {
    const src = map.current?.getSource("outline") as GeoJSONSource | undefined;
    src?.setData({
      type: "Feature",
      properties: {},
      geometry: { type: "MultiPolygon", coordinates: polygons(props.outline) },
    });
  }, [props.outline]);

  return <div ref={box} role="application" aria-label={props.label} className="h-[46dvh] min-h-64 w-full" />;
}
