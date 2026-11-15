"use client";

import "maplibre-gl/dist/maplibre-gl.css";
import {
  Map as MLMap,
  NavigationControl,
  getVersion,
  setWorkerUrl,
  type GeoJSONSource,
  type MapMouseEvent,
  type MapTouchEvent,
  type Point,
} from "maplibre-gl";
import { useEffect, useImperativeHandle, useRef, type Ref } from "react";
import { mapStyle, token, type LngLat } from "@/lib/map-style";

export type { LngLat };

/** The worker copied to public/ by scripts/maplibre-worker.mjs (the bundled default path does not resolve). */
if (typeof window !== "undefined") setWorkerUrl(`/maplibre-gl-worker.mjs?v=${getVersion()}`);

/** Screen distance between traced vertices. */
const TRACE_PX = 12;

export interface FieldMapHandle {
  flyTo(lon: number, lat: number, zoom?: number): void;
  fitBounds(bbox: [number, number, number, number]): void;
}

export interface FieldMapProps {
  /** Closed ring being drawn or loaded; empty when nothing yet. */
  ring: LngLat[];
  closed: boolean;
  drawing: boolean;
  onAddPoint: (p: LngLat) => void;
  onFinish: () => void;
  label: string;
  initial?: { lon: number; lat: number; zoom: number };
  /** Imperative handle (a prop, not forwardRef: next/dynamic does not forward refs). */
  mapRef?: Ref<FieldMapHandle>;
}

/** MapLibre map with click-or-trace outline drawing (design 13). */
export function FieldMap(props: FieldMapProps) {
  const container = useRef<HTMLDivElement>(null);
  const map = useRef<MLMap | null>(null);
  const handlers = useRef(props);
  handlers.current = props;

  useEffect(() => {
    if (!container.current) return;
    const init = props.initial ?? { lon: -100.88, lat: 37.97, zoom: 12 };
    const m = new MLMap({
      container: container.current,
      style: mapStyle(),
      center: [init.lon, init.lat],
      zoom: init.zoom,
      doubleClickZoom: false,
      attributionControl: { compact: true },
    });
    m.addControl(new NavigationControl({ showCompass: false }), "bottom-right");
    m.on("load", () => {
      m.addSource("field", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
      const [signal, surface, ink] = [token("--ts-signal"), token("--ts-surface"), token("--ts-ink")];
      m.addLayer({
        id: "field-fill",
        type: "fill",
        source: "field",
        filter: ["==", "$type", "Polygon"],
        paint: { "fill-color": signal, "fill-opacity": 0.35 },
      });
      m.addLayer({
        id: "field-line",
        type: "line",
        source: "field",
        paint: { "line-color": signal, "line-width": 3 },
      });
      m.addLayer({
        id: "field-points",
        type: "circle",
        source: "field",
        filter: ["==", "$type", "Point"],
        paint: {
          "circle-radius": 5,
          "circle-color": surface,
          "circle-stroke-color": ink,
          "circle-stroke-width": 1.5,
        },
      });
    });
    // Drawing (design 13): a click adds a vertex; press-and-drag traces the edge (a vertex every TRACE_PX) and
    // closes the outline on release. While drawing, one-finger/mouse panning is off so a press never drags the map;
    // zoom (wheel, pinch, +/−) still works.
    let stroke: { start: Point; last: Point; traced: number } | null = null;
    const add = (pt: Point, lngLat: { lng: number; lat: number }) => {
      const ring = handlers.current.ring;
      const prev = ring[ring.length - 1];
      if (prev && m.project(prev).dist(pt) < 3) return; // the second click of a double-click
      handlers.current.onAddPoint([lngLat.lng, lngLat.lat]);
    };
    const down = (e: MapMouseEvent | MapTouchEvent) => {
      if (!handlers.current.drawing || handlers.current.closed) return;
      if ("points" in e && e.points.length > 1) return (stroke = null); // pinch zoom
      stroke = { start: e.point, last: e.point, traced: 0 };
    };
    const move = (e: MapMouseEvent | MapTouchEvent) => {
      if (!stroke) return;
      if ("points" in e && e.points.length > 1) return (stroke = null);
      if (stroke.traced === 0 && e.point.dist(stroke.start) < TRACE_PX) return;
      if (stroke.traced === 0) {
        add(stroke.start, m.unproject(stroke.start));
        stroke.traced = 1;
      }
      if (e.point.dist(stroke.last) >= TRACE_PX) {
        add(e.point, e.lngLat);
        stroke.last = e.point;
        stroke.traced++;
      }
      e.preventDefault();
    };
    const up = (e: MapMouseEvent | MapTouchEvent) => {
      if (!stroke) return;
      const s = stroke;
      stroke = null;
      if (s.traced === 0) add(s.start, m.unproject(s.start));
      else if (s.traced >= 3) handlers.current.onFinish();
      void e;
    };
    m.on("mousedown", down);
    m.on("mousemove", move);
    m.on("mouseup", up);
    m.on("touchstart", down);
    m.on("touchmove", move);
    m.on("touchend", up);
    m.on("dblclick", (e: MapMouseEvent) => {
      if (!handlers.current.drawing) return;
      e.preventDefault();
      handlers.current.onFinish();
    });
    // Re-read the token colours when the theme attribute changes.
    const repaint = () => {
      if (!m.getLayer("field-points")) return;
      m.setPaintProperty("field-points", "circle-color", token("--ts-surface"));
      m.setPaintProperty("field-points", "circle-stroke-color", token("--ts-ink"));
    };
    const observer = new MutationObserver(repaint);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    map.current = m;
    return () => {
      observer.disconnect();
      m.remove();
    };
    // The map is created once; props reach handlers through the ref.
  }, []);

  useEffect(() => {
    const m = map.current;
    if (!m) return;
    if (props.drawing && !props.closed) m.dragPan.disable();
    else m.dragPan.enable();
  }, [props.drawing, props.closed]);

  useEffect(() => {
    const m = map.current;
    if (!m) return;
    const update = () => {
      const src = m.getSource("field") as GeoJSONSource | undefined;
      if (!src) return;
      const { ring, closed } = props;
      const features: GeoJSON.Feature[] = ring.map((p) => ({
        type: "Feature",
        properties: {},
        geometry: { type: "Point", coordinates: p },
      }));
      if (ring.length >= 2) {
        features.push(
          closed && ring.length >= 3
            ? {
                type: "Feature",
                properties: {},
                geometry: { type: "Polygon", coordinates: [[...ring, ring[0]!]] },
              }
            : { type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: ring } },
        );
      }
      src.setData({ type: "FeatureCollection", features });
    };
    if (m.isStyleLoaded()) update();
    else m.once("load", update);
  }, [props.ring, props.closed]);

  useImperativeHandle(props.mapRef, () => ({
    flyTo: (lon, lat, zoom = 14) => map.current?.flyTo({ center: [lon, lat], zoom }),
    fitBounds: (b) =>
      map.current?.fitBounds(
        [
          [b[0], b[1]],
          [b[2], b[3]],
        ],
        { padding: 60, maxZoom: 15 },
      ),
  }));

  return (
    <div
      ref={container}
      role="application"
      aria-label={props.label}
      className="h-[520px] w-full overflow-hidden rounded-hero"
      style={{ cursor: props.drawing ? "crosshair" : undefined }}
    />
  );
}
