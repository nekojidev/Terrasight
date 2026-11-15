"use client";

import { Button, ConfirmDialog, Disclosure, ProgressBar, Segmented, Skeleton, Surface, TextField } from "@terrasight/ui";
import {
  ArrowRight,
  Calendar,
  Check,
  Circle,
  Droplet,
  Layers,
  Undo2,
  Trash2,
  Satellite,
  Search,
  Sun,
  TriangleAlert,
  Upload,
  Info,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import dynamic from "next/dynamic";
import type { FieldMapHandle } from "@/components/FieldMap";
import { reasonText, type LandView } from "@/components/LandSuitability";
import { NoticeStack } from "@/components/NoticeStack";
import type { LngLat } from "@/lib/map-style";
import { api, ApiError } from "@/lib/api";
import {
  parseCoordinates,
  readAddFieldMode,
  ringFromFile,
  UploadError,
  writeAddFieldMode,
  type UploadErrorCode,
} from "@/lib/upload";
import { useActionToast } from "@/lib/useActionToast";
import { useFormat } from "@/lib/useFormat";

function LoadingMap() {
  const a = useTranslations("App");
  return <Skeleton variant="map" label={a("mapLoading")} className="h-[520px]" />;
}

const FieldMap = dynamic(() => import("@/components/FieldMap").then((m) => m.FieldMap), {
  ssr: false,
  loading: () => <LoadingMap />,
});

interface Preview {
  areaHa: number;
  placeLabel: string | null;
  regionId: string | null;
  hasRotationLibrary: boolean;
  tier: "A" | "B" | "C";
  sources: string[];
  suitability?: LandView | null;
}

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

type Mode = "file" | "draw";
type Translate = (key: string, values?: Record<string, string | number>) => string;

const UPLOAD_KEY: Record<UploadErrorCode, string> = {
  format: "err_format",
  "too-big": "err_too_big",
  unreadable: "err_unreadable",
  "no-polygon": "err_no_polygon",
  "too-few": "err_too_few",
  "self-intersect": "err_self_intersect",
};

/** One line of the checklist: a done mark or an open circle, a title, and what it says. */
function Step({
  state,
  title,
  children,
}: {
  state: "done" | "todo" | "warn";
  title: string;
  children: ReactNode;
}) {
  return (
    <li className="flex gap-3">
      <span
        aria-hidden
        className={`mt-0.5 inline-flex size-6 shrink-0 items-center justify-center rounded-chip ${state === "done" ? "bg-ok text-surface" : state === "warn" ? "bg-week-soft text-week" : "border border-line-control text-ink-3"}`}
      >
        {state === "done" ? (
          <Check className="size-4" strokeWidth={2} />
        ) : state === "warn" ? (
          <TriangleAlert className="size-4" strokeWidth={1.7} />
        ) : (
          <Circle className="size-3" strokeWidth={1.7} />
        )}
      </span>
      <div className="min-w-0 flex-1">
        <h3 className="text-body font-semibold text-ink">
          {title}
        </h3>
        <div className="mt-1 flex flex-col gap-2 text-small text-ink-2">{children}</div>
      </div>
    </li>
  );
}

/** Design 13 (S-02.01): choose how to give the outline → checklist fills in → add; the gather starts on the field page. */
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
  const land = a as unknown as Translate;
  const router = useRouter();
  const fmt = useFormat({ units });
  const { fail } = useActionToast();
  const mapRef = useRef<FieldMapHandle>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const formRef = useRef<HTMLFormElement>(null);

  const [mode, setMode] = useState<Mode>("file");
  const [ring, setRing] = useState<LngLat[]>([]);
  const [fromFile, setFromFile] = useState(false);
  const [closed, setClosed] = useState(false);
  const [drawing, setDrawing] = useState(false);
  const fitAfterShow = useRef<[number, number, number, number] | null>(null);
  const [query, setQuery] = useState("");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [retry, setRetry] = useState(0);
  const [irrigated, setIrrigated] = useState<"yes" | "no" | "unknown">("unknown");
  const [name, setName] = useState(suggestedName);
  const [outlineError, setOutlineError] = useState<string | null>(null);
  const [hits, setHits] = useState<Hit[]>([]);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  const [pending, setPending] = useState<LngLat[] | null>(null);

  // The last mode of this visit (not saved across visits); read after mount so the server and client agree.
  useEffect(() => {
    if (readAddFieldMode() === "draw") {
      setMode("draw");
      setDrawing(true);
    }
  }, []);

  const showMap = mode === "draw" || ring.length > 0;
  // A loaded outline appears on a map that was not on screen yet: fit it as soon as the map exists.
  useEffect(() => {
    if (!showMap || !fitAfterShow.current) return;
    const box = fitAfterShow.current;
    let tries = 0;
    const id = window.setInterval(() => {
      if (mapRef.current) {
        mapRef.current.fitBounds(box);
        fitAfterShow.current = null;
        window.clearInterval(id);
      } else if (++tries > 40) window.clearInterval(id);
    }, 100);
    return () => window.clearInterval(id);
  }, [showMap, ring]);

  const geometry =
    closed && ring.length >= 3 ? { type: "Polygon" as const, coordinates: [[...ring, ring[0]!]] } : null;

  useEffect(() => {
    if (!geometry) {
      setPreview(null);
      setPreviewing(false);
      return;
    }
    let cancelled = false;
    setPreviewing(true);
    api<Preview>(`/api/w/${workspaceId}/fields/preview`, { body: { geometry } })
      .then((p) => {
        if (cancelled) return;
        setPreview(p);
        setOutlineError(null);
        setPreviewing(false);
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setPreview(null);
        setPreviewing(false);
        const geometryProblem = e instanceof ApiError && (e.code === "invalid-geometry" || e.code === "field-size");
        if (geometryProblem) setOutlineError(`${e.problem.detail ?? e.message} ${t("err_size_do")}`);
        fail(e, t("whatPreview"), geometryProblem ? undefined : () => setRetry((n) => n + 1));
      });
    return () => {
      cancelled = true;
    };
    // geometry is derived from ring/closed
  }, [ring, closed, workspaceId, retry]);

  async function find(e: FormEvent) {
    e.preventDefault();
    const coords = parseCoordinates(query);
    if (coords) {
      mapRef.current?.flyTo(coords[0], coords[1], 14);
      setHits([]);
      return;
    }
    try {
      const r = await api<{ results: Hit[] }>(`/api/geocode?q=${encodeURIComponent(query.trim())}`);
      if (!r.results[0]) {
        setHits([]);
        return fail(new Error(a("placeNotFound")), t("whatSearch"));
      }
      goTo(r.results[0]);
      setHits(r.results.length > 1 ? r.results : []);
    } catch {
      fail(new Error(a("placeSearchDown")), t("whatSearch"), () => void find(e));
    }
  }

  function goTo(hit: Hit) {
    if (hit.bbox) mapRef.current?.fitBounds(hit.bbox);
    else mapRef.current?.flyTo(hit.lon, hit.lat, 13);
  }

  function undo() {
    setRing((r) => r.slice(0, -1));
    setClosed(false);
    setDrawing(true);
    chooseMode("draw");
  }
  function clear() {
    setRing([]);
    setFromFile(false);
    setClosed(false);
    setDrawing(true);
    chooseMode("draw");
    setOutlineError(null);
  }

  /** Switching never throws points away: drawing resumes where it stopped, a loaded outline stays editable. */
  function chooseMode(m: Mode) {
    setMode(m);
    writeAddFieldMode(m);
    if (m === "draw") {
      setDrawing(true);
      if (closed) setClosed(false);
    } else {
      setDrawing(false);
    }
  }

  function applyRing(r: LngLat[]) {
    setRing(r);
    setFromFile(true);
    setClosed(true);
    setDrawing(false);
    setOutlineError(null);
    const lons = r.map((p) => p[0]);
    const lats = r.map((p) => p[1]);
    const box: [number, number, number, number] = [Math.min(...lons), Math.min(...lats), Math.max(...lons), Math.max(...lats)];
    if (mapRef.current) mapRef.current.fitBounds(box);
    else fitAfterShow.current = box;
  }

  async function upload(file: File | undefined) {
    if (!file) return;
    setMode("file");
    setProgress(0);
    try {
      const r = await ringFromFile(file, setProgress);
      // Points the user placed by hand are never replaced silently.
      if (ring.length > 0 && !fromFile) setPending(r);
      else applyRing(r);
    } catch (err) {
      const key = err instanceof UploadError ? UPLOAD_KEY[err.code] : "err_unreadable";
      const msg = t(key as "err_format");
      setOutlineError(msg);
      fail(new Error(msg), t("whatUpload"), () => fileRef.current?.click());
    } finally {
      setProgress(null);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!geometry) return;
    setBusy(true);
    try {
      const f = await api<{ id: string }>(`/api/w/${workspaceId}/fields`, {
        body: { name, geometry, irrigated },
      });
      router.push(`/fields/${f.id}`);
    } catch (err) {
      fail(err, t("whatCreate"), () => formRef.current?.requestSubmit());
      setBusy(false);
    }
  }

  const liveHa = preview ? preview.areaHa : ring.length >= 3 ? ringAreaHa(ring) : null;
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
    ...(sources?.includes("cropland")
      ? [{ icon: <Calendar />, title: a("asFindCropT"), sub: a("asFindCropS") }]
      : []),
    ...(has("openet") && sources ? [{ icon: <Droplet />, title: t("d4"), sub: t("d4s") }] : []),
    ...(sources?.includes("wapor")
      ? [{ icon: <Droplet />, title: a("asFindWaterT"), sub: a("asFindWaterS") }]
      : []),
    ...(sources?.includes("wapor")
      ? [{ icon: <Layers />, title: a("asFindYieldT"), sub: a("asFindYieldS") }]
      : []),
    ...(sources?.includes("sentinel2")
      ? [{ icon: <Satellite />, title: a("asFindS2T"), sub: a("asFindS2S") }]
      : []),
  ];
  const suit = preview?.suitability ?? null;
  const limited = suit && (suit.status === "limited" || suit.status === "unsuitable");

  return (
    <div className={`flex flex-col gap-6 ${preview ? "max-lg:pb-24" : ""}`}>
      <div>
        <h1 className="text-h1 text-ink">{t("title")}</h1>
        <p className="mt-2 text-body text-ink-2">{t("sub")}</p>
      </div>

      {outlineError && (
        <NoticeStack notices={[{ id: "outline", tone: "urgent", title: outlineError }]} />
      )}

      <Segmented
        label={t("mode_label")}
        value={mode}
        onChange={chooseMode}
        options={[
          { value: "file", label: t("mode_file") },
          { value: "draw", label: t("mode_draw") },
        ]}
      />

      <div className="grid gap-6 lg:grid-cols-[1fr_410px]">
        <div className="flex flex-col gap-4">
          {mode === "file" && (
            <Surface tone="inset" pad="sm" className="flex flex-col gap-3">
              <p className="text-small text-ink-2">{t("file_hint")}</p>
              <Button
                variant="outline"
                size={48}
                icon={<Upload />}
                className="w-fit"
                disabled={progress !== null}
                onClick={() => fileRef.current?.click()}
              >
                {t("file_choose")}
              </Button>
              {progress !== null && (
                <div role="status" className="flex flex-col gap-1">
                  <ProgressBar value={Math.round(progress * 100)} label={t("file_progress")} />
                  <span className="text-caption text-ink-2">{t("file_progress")}…</span>
                </div>
              )}
            </Surface>
          )}
          <input
            ref={fileRef}
            type="file"
            accept=".geojson,.json,.kml,.zip"
            className="hidden"
            aria-label={t("tool_file")}
            tabIndex={-1}
            onChange={(e) => void upload(e.target.files?.[0])}
          />
          {showMap && (
          <div className="relative">
            {drawing && !closed && mode === "draw" && (
              <p
                role="status"
                className="z-10 mb-2 flex items-center gap-2 rounded-card bg-ink px-4 py-3 text-body text-surface lg:absolute lg:inset-x-0 lg:bottom-6 lg:mx-auto lg:mb-0 lg:w-fit lg:max-w-[calc(100%-2rem)] lg:rounded-chip lg:px-5"
              >
                <Info aria-hidden className="size-5 shrink-0 text-signal dark:text-on-signal" strokeWidth={1.7} />
                {t("hint")}
              </p>
            )}
            <FieldMap
              mapRef={mapRef}
              ring={ring}
              closed={closed}
              drawing={drawing}
              label={a("mapLabel")}
              onAddPoint={(p) => {
                if (closed) return;
                setFromFile(false);
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
          </div>
          )}
        </div>

        <form ref={formRef} onSubmit={submit} className="h-fit">
          <Surface pad="lg" className="flex flex-col gap-5">
            <h2 className="text-h2 text-ink">{t("cl_title")}</h2>
            <ol className="flex flex-col gap-5">
              <Step state={closed && liveHa !== null ? "done" : outlineError ? "warn" : "todo"} title={t("cl_outline")}>
                {closed && liveHa !== null ? (
                  <p className="flex items-baseline gap-2">
                    <span className="text-big-number text-ink">
                      {`${preview ? "" : "≈ "}${fmt.area(liveHa)}`}
                    </span>
                  </p>
                ) : (
                  <p>{ring.length > 0 ? t("cl_outline_open") : t("cl_outline_todo")}</p>
                )}
              </Step>

              <Step state={limited ? "warn" : preview ? "done" : "todo"} title={t("cl_check")}>
                {preview ? (
                  <>
                    {preview.placeLabel && <p className="text-ink">{preview.placeLabel}</p>}
                    <p>{t(`tierLine_${preview.tier}`)}</p>
                    {!preview.hasRotationLibrary && <p className="text-week">{a("noRotationLibrary")}</p>}
                    {!suit || suit.status === "unknown" ? (
                      <p>{t("cl_land_unknown")}</p>
                    ) : limited ? (
                      <div role="alert" className="flex flex-col gap-2">
                        <p className="font-semibold text-ink">
                          {land(`landPreviewTitle_${suit.status as "limited" | "unsuitable"}`)}
                        </p>
                        <ul className="flex flex-col gap-2">
                          {suit.reasons.map((r) => (
                            <li key={`${r.code}:${r.level}`} className="flex items-start gap-2 text-ink">
                              <TriangleAlert aria-hidden className="mt-0.5 size-4 shrink-0 text-week" />
                              {reasonText(land, r)}
                            </li>
                          ))}
                        </ul>
                        <p>{land("landPreviewKeep")}</p>
                      </div>
                    ) : (
                      <p>{t("cl_land_ok")}</p>
                    )}
                    <fieldset className="flex flex-col gap-2">
                      <legend className="mb-1 text-small text-ink-2">{t("cl_irr_short")}</legend>
                      <div className="grid grid-cols-2 gap-2">
                        {(["yes", "no"] as const).map((v) => (
                          <button
                            key={v}
                            type="button"
                            aria-pressed={irrigated === v}
                            onClick={() => setIrrigated(irrigated === v ? "unknown" : v)}
                            className={`focus-ring flex min-h-13 items-center justify-center gap-2 rounded-btn border text-body font-semibold text-ink ${irrigated === v ? "border-ink bg-muted" : "border-line-control"}`}
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
                      <p>{t("cl_irr_todo")}</p>
                    </fieldset>
                  </>
                ) : previewing ? (
                  <Skeleton variant="text" rows={2} label={t("cl_checking")} />
                ) : (
                  <p>{t("cl_check_todo")}</p>
                )}
              </Step>

              <Step state={name.trim() ? "done" : "todo"} title={t("cl_name")}>
                <TextField
                  label={t("name_label")}
                  name="name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  hint={t("name_note")}
                  required
                  maxLength={80}
                />
              </Step>
            </ol>

            <Disclosure summary={t("find")}>
              <ul className="flex flex-col gap-3 pb-2 pt-2">
                {finds.map((f) => (
                  <li key={f.title} className="flex items-center gap-3">
                    <span
                      aria-hidden
                      className="inline-flex size-11 shrink-0 items-center justify-center rounded-chip bg-muted [&>svg]:size-5 [&>svg]:stroke-[1.7]"
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
            </Disclosure>

            <div
              className={
                preview
                  ? "max-lg:fixed max-lg:inset-x-0 max-lg:bottom-[calc(var(--ts-tabbar)+env(safe-area-inset-bottom))] max-lg:z-30 max-lg:border-t max-lg:border-line max-lg:bg-surface max-lg:p-3 max-lg:shadow-sheet"
                  : undefined
              }
            >
              <Button
                type="submit"
                size={56}
                icon={<ArrowRight />}
                className="w-full justify-center"
                disabled={!preview || busy || !name.trim()}
                aria-busy={busy}
              >
                {t("go")}
              </Button>
            </div>
            <Button variant="link" className="self-center" onClick={() => router.push("/")}>
              {t("cancel")}
            </Button>
          </Surface>
        </form>
      </div>

      <ConfirmDialog
        open={pending !== null}
        title={t("replace_title")}
        confirmLabel={t("replace_yes")}
        cancelLabel={t("replace_no")}
        onConfirm={() => {
          if (pending) applyRing(pending);
          setPending(null);
        }}
        onCancel={() => setPending(null)}
      >
        {t("replace_body", { n: ring.length })}
      </ConfirmDialog>
    </div>
  );
}
