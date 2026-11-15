"use client";

import "maplibre-gl/dist/maplibre-gl.css";
import {
  LngLatBounds,
  Map as MLMap,
  Marker,
  NavigationControl,
  getVersion,
  setWorkerUrl,
  type ExpressionSpecification,
  type GeoJSONSource,
} from "maplibre-gl";
import { useEffect, useRef } from "react";
import { mapStyle, token } from "@/lib/map-style";

if (typeof window !== "undefined") setWorkerUrl(`/maplibre-gl-worker.mjs?v=${getVersion()}`);

export interface ExploreOutline {
  id: string;
  /** Short label drawn on the map. */
  name: string;
  /** Accessible name of the label button. */
  label: string;
  centroid: { lon: number; lat: number };
  feature: GeoJSON.Feature;
}

export interface ExploreMapProps {
  outlines: ExploreOutline[];
  selectedId: string | null;
  point: { lon: number; lat: number } | null;
  onPickPoint: (lon: number, lat: number) => void;
  onPickOutline: (id: string) => void;
  label: string;
  markerLabel: string;
}

const EMPTY: GeoJSON.FeatureCollection = { type: "FeatureCollection", features: [] };

/** The public page's map: ready outlines drawn and labelled, a click or tap picks a point. Same basemap as the app. */
export function ExploreMap(props: ExploreMapProps) {
  const container = useRef<HTMLDivElement>(null);
  const map = useRef<MLMap | null>(null);
  const handlers = useRef(props);
  handlers.current = props;
  const labels = useRef<Marker[]>([]);
  const pin = useRef<Marker | null>(null);
  const fitted = useRef(false);

  useEffect(() => {
    if (!container.current) return;
    const m = new MLMap({
      container: container.current,
      style: mapStyle(),
      center: [-101.5, 39.5],
      zoom: 4,
      doubleClickZoom: false,
      attributionControl: { compact: true },
    });
    m.addControl(new NavigationControl({ showCompass: false }), "bottom-right");
    m.on("load", () => {
      m.addSource("outlines", { type: "geojson", data: EMPTY });
      const [signal, ink, surface] = [token("--ts-signal"), token("--ts-ink"), token("--ts-surface")];
      m.addLayer({
        id: "outline-fill",
        type: "fill",
        source: "outlines",
        paint: { "fill-color": signal, "fill-opacity": 0.35 },
      });
      m.addLayer({
        id: "outline-casing",
        type: "line",
        source: "outlines",
        paint: { "line-color": surface, "line-width": 5 },
      });
      m.addLayer({
        id: "outline-line",
        type: "line",
        source: "outlines",
        paint: { "line-color": ink, "line-width": 2.5 },
      });
    });
    m.on("click", (e) => handlers.current.onPickPoint(e.lngLat.lng, e.lngLat.lat));
    const repaint = () => {
      if (!m.getLayer("outline-fill")) return;
      m.setPaintProperty("outline-fill", "fill-color", token("--ts-signal"));
      m.setPaintProperty("outline-casing", "line-color", token("--ts-surface"));
      m.setPaintProperty("outline-line", "line-color", token("--ts-ink"));
    };
    const observer = new MutationObserver(repaint);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    map.current = m;
    return () => {
      observer.disconnect();
      labels.current.forEach((x) => x.remove());
      pin.current?.remove();
      m.remove();
    };
  }, []);

  // Outlines and their labels (real buttons: keyboard and screen readers reach them too).
  useEffect(() => {
    const m = map.current;
    if (!m) return;
    const draw = () => {
      (m.getSource("outlines") as GeoJSONSource | undefined)?.setData({
        type: "FeatureCollection",
        features: props.outlines.map((o) => o.feature),
      });
      labels.current.forEach((x) => x.remove());
      labels.current = props.outlines.map((o) => {
        const el = document.createElement("button");
        el.type = "button";
        el.textContent = o.name;
        el.setAttribute("aria-label", o.label);
        el.setAttribute("aria-pressed", String(o.id === handlers.current.selectedId));
        el.dataset.outline = o.id;
        el.className =
          "focus-ring min-h-11 rounded-chip border border-line-control bg-surface px-3 text-small font-semibold text-ink shadow-sm aria-pressed:bg-ink aria-pressed:text-surface";
        el.addEventListener("click", (ev) => {
          ev.stopPropagation();
          handlers.current.onPickOutline(o.id);
        });
        return new Marker({ element: el, anchor: "bottom", offset: [0, -4] })
          .setLngLat([o.centroid.lon, o.centroid.lat])
          .addTo(m);
      });
      if (props.outlines.length && !fitted.current) {
        fitted.current = true;
        const b = new LngLatBounds();
        for (const o of props.outlines) b.extend([o.centroid.lon, o.centroid.lat]);
        m.fitBounds(b, { padding: 80, maxZoom: 7, duration: 0 });
      }
    };
    if (m.getSource("outlines")) draw();
    else m.once("load", draw);
  }, [props.outlines]);

  // The chosen outline: thicker line, filled label.
  useEffect(() => {
    labels.current.forEach((el) => {
      const node = el.getElement();
      node.setAttribute("aria-pressed", String(node.dataset.outline === props.selectedId));
    });
    const m = map.current;
    if (!m) return;
    const apply = () => {
      const sel: ExpressionSpecification = ["==", ["get", "id"], props.selectedId ?? ""];
      m.setPaintProperty("outline-line", "line-width", ["case", sel, 4.5, 2.5]);
      m.setPaintProperty("outline-fill", "fill-opacity", ["case", sel, 0.6, 0.35]);
    };
    if (m.getLayer("outline-line")) apply();
    else m.once("load", apply);
    const chosen = props.outlines.find((o) => o.id === props.selectedId);
    if (chosen) m.flyTo({ center: [chosen.centroid.lon, chosen.centroid.lat], zoom: 14 });
  }, [props.selectedId, props.outlines]);

  // The marker of a clicked point and the move to a chosen place.
  useEffect(() => {
    const m = map.current;
    if (!m) return;
    pin.current?.remove();
    pin.current = null;
    const target = props.point;
    if (!target) return;
    const el = document.createElement("div");
    el.setAttribute("role", "img");
    el.setAttribute("aria-label", handlers.current.markerLabel);
    // A ringed cross: readable on any colour, not by colour alone.
    el.innerHTML =
      '<svg width="32" height="32" viewBox="0 0 32 32" aria-hidden="true"><circle cx="16" cy="16" r="11" fill="none" stroke="var(--ts-surface)" stroke-width="5"/><circle cx="16" cy="16" r="11" fill="none" stroke="var(--ts-ink)" stroke-width="2.5"/><path d="M16 9v14M9 16h14" stroke="var(--ts-ink)" stroke-width="2.5"/></svg>';
    pin.current = new Marker({ element: el }).setLngLat([target.lon, target.lat]).addTo(m);
    const bounds = m.getBounds();
    if (!bounds.contains([target.lon, target.lat])) m.easeTo({ center: [target.lon, target.lat] });
  }, [props.point]);

  return (
    <div
      ref={container}
      role="application"
      aria-label={props.label}
      className="h-[46dvh] min-h-72 w-full overflow-hidden rounded-hero border border-line md:h-[520px]"
      style={{ cursor: "crosshair" }}
    />
  );
}
