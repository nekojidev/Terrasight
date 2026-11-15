"use client";

import { Button, Chip, TextField } from "@terrasight/ui";
import {
  ArrowRight,
  Calendar,
  Check,
  Droplet,
  Layers,
  Pencil,
  Undo2,
  Trash2,
  Satellite,
  Search,
  ShieldCheck,
  Sun,
  Upload,
  Info,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { FieldMap, type FieldMapHandle, type LngLat } from "@/components/FieldMap";
import { api, ApiError } from "@/lib/api";
import { parseCoordinates, ringFromFile } from "@/lib/upload";

interface Preview {
  areaHa: number;
  placeLabel: string | null;
  regionId: string | null;
  hasRotationLibrary: boolean;
  tier: "A" | "B" | "C";
  sources: string[];
}

const HA_TO_AC = 2.471054;

/** Spherical polygon area in hectares (equal-area approximation; fine for fields), shown while drawing. */
function ringAreaHa(ring: LngLat[]): number {
  if (ring.length < 3) return 0;
  const R = 6371008.8;
  const rad = Math.PI / 180;
  let sum = 0;
  for (let i = 0; i < ring.length; i++) {
    const [lon1, lat1] = ring[i]!;
    const [lon2, lat2] = ring[(i + 1) % ring.length]!;
    sum += (lon2 - lon1) * rad * (2 + Math.sin(lat1 * rad) + Math.sin(lat2 * rad));
  }
  return (Math.abs(sum) * R * R) / 2 / 10_000;
}

interface Hit {
  label: string;
  lon: number;
  lat: number;
  bbox: [number, number, number, number] | null;
}

/** Design 13 (S-02.01): find the place → outline → check, then the gather starts on the field page. */
export function AddFieldClient({
  workspaceId,
  units,
  suggestedName,
}: {
  workspaceId: string;
  units: "metric" | "imperial";
  suggestedName: string;
}) {
  const t = useTranslations("AddField");
  const a = useTranslations("App");
  const router = useRouter();
  const mapRef = useRef<FieldMapHandle>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const [ring, setRing] = useState<LngLat[]>([]);
  const [closed, setClosed] = useState(false);
  const [drawing, setDrawing] = useState(true);
  const [placeFound, setPlaceFound] = useState(false);
  const [query, setQuery] = useState("");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [irrigated, setIrrigated] = useState<"yes" | "no" | "unknown">("unknown");
  const [message, setMessage] = useState<string | null>(null);
  const [hits, setHits] = useState<Hit[]>([]);
  const [busy, setBusy] = useState(false);

  const step = closed ? 3 : placeFound || ring.length > 0 ? 2 : 1;
  const geometry =
    closed && ring.length >= 3 ? { type: "Polygon" as const, coordinates: [[...ring, ring[0]!]] } : null;

  useEffect(() => {
    if (!geometry) {
      setPreview(null);
      return;
    }
    let cancelled = false;
    api<Preview>(`/api/w/${workspaceId}/fields/preview`, { body: { geometry } })
      .then((p) => !cancelled && (setPreview(p), setMessage(null)))
      .catch((e: unknown) => {
        if (cancelled) return;
        setPreview(null);
        setMessage(
          e instanceof ApiError && (e.code === "invalid-geometry" || e.code === "field-size")
            ? (e.problem.detail ?? a("errGeneric"))
            : a("errGeneric"),
        );
      });
    return () => {
      cancelled = true;
    };
    // geometry is derived from ring/closed
  }, [ring, closed, workspaceId]);

  async function find(e: FormEvent) {
    e.preventDefault();
    const coords = parseCoordinates(query);
    if (coords) {
      mapRef.current?.flyTo(coords[0], coords[1], 14);
      setPlaceFound(true);
      setHits([]);
      return;
    }
    try {
      const r = await api<{ results: Hit[] }>(`/api/geocode?q=${encodeURIComponent(query.trim())}`);
      if (!r.results[0]) {
        setHits([]);
        return setMessage(a("placeNotFound"));
      }
      goTo(r.results[0]);
      setHits(r.results.length > 1 ? r.results : []);
      setMessage(null);
    } catch {
      setMessage(a("placeSearchDown"));
    }
  }

  function goTo(hit: Hit) {
    if (hit.bbox) mapRef.current?.fitBounds(hit.bbox);
    else mapRef.current?.flyTo(hit.lon, hit.lat, 13);
    setPlaceFound(true);
  }

  function undo() {
    setRing((r) => r.slice(0, -1));
    setClosed(false);
    setDrawing(true);
  }
  function clear() {
    setRing([]);
    setClosed(false);
    setDrawing(true);
  }

  async function upload(file: File | undefined) {
    if (!file) return;
    try {
      const r = await ringFromFile(file);
      setRing(r);
      setClosed(true);
      setDrawing(false);
      const lons = r.map((p) => p[0]);
      const lats = r.map((p) => p[1]);
      mapRef.current?.fitBounds([Math.min(...lons), Math.min(...lats), Math.max(...lons), Math.max(...lats)]);
    } catch {
      setMessage(a("fileNoPolygon"));
    }
  }

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!geometry) return;
    const name = String(new FormData(e.currentTarget).get("name") ?? "");
    setBusy(true);
    try {
      const f = await api<{ id: string }>(`/api/w/${workspaceId}/fields`, {
        body: { name, geometry, irrigated },
      });
      router.push(`/fields/${f.id}`);
    } catch (err) {
      setMessage(err instanceof ApiError ? (err.problem.detail ?? a("errGeneric")) : a("errGeneric"));
      setBusy(false);
    }
  }

  const liveHa = preview ? preview.areaHa : ring.length >= 3 ? ringAreaHa(ring) : null;
  const area = liveHa === null ? null : units === "imperial" ? liveHa * HA_TO_AC : liveHa;
  const sources = preview?.sources;
  const has = (id: string) => !sources || sources.includes(id);
  const finds = [
    { icon: <Sun />, title: t("d1"), sub: t("d1s") },
    sources?.includes("cdl")
      ? { icon: <Calendar />, title: t("d2"), sub: t("d2s") }
      : { icon: <Calendar />, title: a("asFindVegT"), sub: a("asFindVegS") },
    {
      icon: <Layers />,
      title: t("d3"),
      sub: !sources || sources.includes("ssurgo") ? t("d3s") : a("asFindSoilS"),
    },
    ...(has("openet") && sources ? [{ icon: <Droplet />, title: t("d4"), sub: t("d4s") }] : []),
    ...(sources?.includes("sentinel2")
      ? [{ icon: <Satellite />, title: a("asFindS2T"), sub: a("asFindS2S") }]
      : []),
  ];

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-h1 text-ink">{t("title")}</h1>
        <p className="mt-2 text-body text-ink-2">{t("sub")}</p>
      </div>

      <ol aria-label={t("steps")} className="grid gap-3 md:grid-cols-3">
        {[t("s1"), t("s2"), t("s3")].map((label, i) => {
          const n = i + 1;
          const state = n < step ? "done" : n === step ? "now" : "next";
          return (
            <li
              key={label}
              aria-current={state === "now" ? "step" : undefined}
              className={`flex items-center gap-3 rounded-card border p-4 ${state === "now" ? "border-ink bg-muted" : "border-line bg-surface"}`}
            >
              <span
                className={`inline-flex size-10 shrink-0 items-center justify-center rounded-chip text-body font-bold ${state === "done" ? "bg-ok text-surface" : state === "now" ? "bg-ink text-surface" : "border border-line-strong text-ink-2"}`}
              >
                {state === "done" ? <Check aria-hidden className="size-5" /> : n}
              </span>
              <span>
                <span className="block text-body font-semibold text-ink">{label}</span>
                {state !== "next" && (
                  <span className={`block text-small ${state === "done" ? "text-ok" : "text-ink-2"}`}>
                    {state === "done" ? t("step_done") : t("step_now")}
                  </span>
                )}
              </span>
            </li>
          );
        })}
      </ol>

      <div className="grid gap-6 lg:grid-cols-[1fr_410px]">
        <div className="relative">
          <FieldMap
            ref={mapRef}
            ring={ring}
            closed={closed}
            drawing={drawing}
            label={a("mapLabel")}
            onAddPoint={(p) => {
              if (closed) return;
              setRing((r) => [...r, p]);
            }}
            onFinish={() =>
              setRing((r) => {
                if (r.length >= 3) {
                  setClosed(true);
                  setDrawing(false);
                }
                return r;
              })
            }
          />
          <div className="absolute inset-x-4 top-4 flex flex-col gap-2">
            <form
              onSubmit={find}
              role="search"
              className="flex items-center gap-3 rounded-input bg-surface px-4 shadow-sheet"
            >
              <Search aria-hidden className="size-5 text-ink-2" strokeWidth={1.7} />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                aria-label={t("search_label")}
                placeholder={t("map_search")}
                className="min-h-13 flex-1 bg-transparent text-body text-ink outline-none placeholder:text-ink-3"
              />
            </form>
            {hits.length > 0 && (
              <ul
                aria-label={a("asResults")}
                className="max-h-56 overflow-y-auto rounded-input bg-surface shadow-sheet"
              >
                {hits.map((h) => (
                  <li key={`${h.lon},${h.lat}`}>
                    <button
                      type="button"
                      onClick={() => {
                        goTo(h);
                        setHits([]);
                      }}
                      className="focus-ring min-h-tap w-full px-4 py-2 text-left text-small text-ink hover:bg-muted"
                    >
                      {h.label}
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <div className="flex w-fit gap-1 rounded-input bg-surface p-1 shadow-sheet">
              <Button
                size={44}
                variant={drawing ? "primary" : "ghost"}
                icon={<Pencil />}
                onClick={clear}
              >
                {t("tool_draw")}
              </Button>
              <Button size={44} variant="ghost" icon={<Upload />} onClick={() => fileRef.current?.click()}>
                {t("tool_file")}
              </Button>
              <input
                ref={fileRef}
                type="file"
                accept=".geojson,.json,.kml,.zip"
                className="hidden"
                onChange={(e) => void upload(e.target.files?.[0])}
              />
            </div>
            {ring.length > 0 && (
              <div className="flex w-fit gap-1 rounded-input bg-surface p-1 shadow-sheet">
                <Button size={44} variant="ghost" icon={<Undo2 />} onClick={undo}>
                  {a("asUndo")}
                </Button>
                <Button size={44} variant="ghost" icon={<Trash2 />} onClick={clear}>
                  {a("asClear")}
                </Button>
              </div>
            )}
          </div>
          {drawing && !closed && (
            <p
              role="status"
              className="absolute inset-x-0 bottom-6 mx-auto flex w-fit items-center gap-2 rounded-chip bg-ink px-5 py-3 text-body text-surface"
            >
              <Info aria-hidden className="size-5 text-signal dark:text-on-signal" strokeWidth={1.7} />
              {t("hint")}
            </p>
          )}
        </div>

        <form
          onSubmit={submit}
          className="flex flex-col gap-5 rounded-card border border-line bg-surface p-7"
        >
          <h2 className="text-h2 text-ink">{t("your_field")}</h2>
          <TextField
            label={t("name_label")}
            name="name"
            defaultValue={suggestedName}
            hint={t("name_note")}
            required
            maxLength={80}
          />
          <p className="flex items-baseline gap-3 text-body text-ink-2">
            {t("area")}
            <span className="text-big-number text-ink">
              {area === null
                ? "—"
                : `${preview ? "" : "≈ "}${area.toLocaleString(undefined, { maximumFractionDigits: 1 })}`}
            </span>
            {units === "imperial" ? t("area_u") : "ha"}
          </p>
          {preview?.placeLabel && <p className="-mt-3 text-small text-ink-2">{preview.placeLabel}</p>}
          <fieldset className="flex flex-col gap-3">
            <legend className="mb-3 text-body font-semibold text-ink">{a("irrOptional")}</legend>
            <div className="grid grid-cols-2 gap-2">
              {(["yes", "no"] as const).map((v) => (
                <button
                  key={v}
                  type="button"
                  aria-pressed={irrigated === v}
                  onClick={() => setIrrigated(irrigated === v ? "unknown" : v)}
                  className={`focus-ring flex min-h-13 items-center justify-center gap-2 rounded-btn border text-body font-semibold ${irrigated === v ? "border-ink bg-muted" : "border-line-strong"}`}
                >
                  {v === "yes" ? (
                    <Droplet aria-hidden className="size-5" strokeWidth={1.7} />
                  ) : (
                    <Sun aria-hidden className="size-5" strokeWidth={1.7} />
                  )}
                  {t(v)}
                </button>
              ))}
            </div>
            <p className="text-small text-ink-2">{a("irrigationDetectHint")}</p>
            <p className="text-small text-ink-2">{a("irrWhy")}</p>
          </fieldset>
          <hr className="border-line" />
          <div>
            <h3 className="mb-3 text-body font-semibold text-ink">{t("find")}</h3>
            <ul className="flex flex-col gap-3">
              {finds.map((f) => (
                <li key={f.title} className="flex items-center gap-3">
                  <span
                    aria-hidden
                    className="inline-flex size-11 items-center justify-center rounded-chip bg-muted [&>svg]:size-5 [&>svg]:stroke-[1.7]"
                  >
                    {f.icon}
                  </span>
                  <span>
                    <span className="block text-body font-semibold text-ink">{f.title}</span>
                    <span className="block text-small text-ink-2">{f.sub}</span>
                  </span>
                </li>
              ))}
            </ul>
          </div>
          {preview && (
            <div className="flex flex-col gap-2">
              <Chip
                tone={preview.tier === "A" ? "ok" : preview.tier === "B" ? "info" : "week"}
                icon={<ShieldCheck />}
              >
                {preview.tier === "A" ? t("tier") : t(`tier_${preview.tier}`)}
              </Chip>
              <p className="text-small text-ink-2">{a(`asTier_${preview.tier}`)}</p>
            </div>
          )}
          {preview && !preview.hasRotationLibrary && (
            <p className="text-small text-week">{a("noRotationLibrary")}</p>
          )}
          {message && (
            <p role="alert" className="rounded-input bg-urgent-soft px-4 py-3 text-small text-urgent">
              {message}
            </p>
          )}
          <Button
            type="submit"
            size={56}
            icon={<ArrowRight />}
            className="w-full justify-center"
            disabled={!preview || busy}
            aria-busy={busy}
          >
            {t("go")}
          </Button>
          <Button variant="link" className="self-center" onClick={() => router.push("/")}>
            {t("cancel")}
          </Button>
        </form>
      </div>
    </div>
  );
}
