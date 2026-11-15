"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  BottomSheet,
  Button,
  Disclosure,
  InfoHint,
  Menu,
  ProgressBar,
  SelectField,
  Skeleton,
  Surface,
  Tabs,
  TextField,
} from "@terrasight/ui";
import { AlertTriangle, Map as MapIcon, RefreshCw } from "lucide-react";
import dynamic from "next/dynamic";
import { useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";
import { QueryState } from "@/components/QueryState";
import { api, ApiError, type Problem } from "@/lib/api";
import { useActionToast } from "@/lib/useActionToast";
import { useFormat } from "@/lib/useFormat";
import { FieldTabs } from "../Overview";
import { API_UNITS, toApiRate, unitSymbol, type ApiUnit } from "./rates";
import type { FieldGeometry, Layer, NdviImage } from "./ZonesMap";

const ZonesMap = dynamic(() => import("./ZonesMap").then((m) => m.ZonesMap), {
  ssr: false,
  loading: () => <MapLoading />,
});

function MapLoading() {
  const t = useTranslations("App");
  return <Skeleton variant="map" label={t("loading")} />;
}

export type { FieldGeometry } from "./ZonesMap";

type ZoneName = "strong" | "variable" | "weak";
const ZONES: ZoneName[] = ["strong", "variable", "weak"];
type Format = "shapefile" | "geojson" | "isoxml";

interface Progress {
  phase?: "queued" | "ndvi" | "seasons" | "classify" | "done";
  done?: number;
  total?: number;
  season?: number;
}

interface ZonesResponse {
  status: "none" | "queued" | "running" | "done" | "failed";
  progress: Progress;
  error: string | null;
  builtAt: string | null;
  seasons: Array<{ season: number; used: boolean }>;
  seasonsUsed: number;
  stats: Array<{ zone: ZoneName; areaHa: number; share: number }>;
  geojson: GeoJSON.FeatureCollection | null;
}

type NdviResponse =
  | { available: false; reason: string }
  | ({
      available: true;
      date: string;
      stops: Array<{ value: number; rgb: [number, number, number] }>;
    } & NdviImage);

const ZONE_CLASS: Record<ZoneName, string> = {
  strong: "bg-ok",
  variable: "bg-week-mark",
  weak: "bg-urgent",
};

/** Field tab "Zones": the map first, a short summary, then one action: create a rate map (FR-ZN-1..3). */
export function ZonesClient({
  workspaceId,
  fieldId,
  fieldName,
  geometry,
  country,
  canEdit,
}: {
  workspaceId: string;
  fieldId: string;
  fieldName: string;
  geometry: FieldGeometry;
  /** ISO country of the field: US fields see ac and lb/ac, the rest ha and kg/ha. */
  country?: string | null;
  canEdit: boolean;
}) {
  const t = useTranslations("App");
  const w = useTranslations("Zones");
  const fmt = useFormat({ country: country ?? undefined });
  const qc = useQueryClient();
  const toast = useActionToast();
  const base = `/api/w/${workspaceId}/fields/${fieldId}`;
  const [layer, setLayer] = useState<Layer>("zones");
  const [picked, setPicked] = useState<ZoneName | null>(null);
  const [sheet, setSheet] = useState(false);

  const zones = useQuery({
    queryKey: ["field", workspaceId, fieldId, "zones"],
    queryFn: () => api<ZonesResponse>(`${base}/zones`),
    refetchInterval: (q) =>
      q.state.data?.status === "queued" || q.state.data?.status === "running" ? 3000 : false,
  });
  const ndvi = useQuery({
    queryKey: ["field", workspaceId, fieldId, "ndvi"],
    queryFn: () => api<NdviResponse>(`${base}/ndvi-latest`),
    staleTime: 10 * 60_000,
  });
  const build = useMutation({
    onError: (e) => toast.fail(e, w("zz5_whatBuild"), () => build.mutate()),
    mutationFn: () => api<ZonesResponse>(`${base}/zones/build`, { method: "POST" }),
    onSuccess: (d) =>
      qc.setQueryData(["field", workspaceId, fieldId, "zones"], (old: ZonesResponse | undefined) => ({
        ...old,
        ...d,
      })),
  });

  // A finished build also refreshes the NDVI layer and the zones.
  const status = zones.data?.status;
  const prev = useRef(status);
  useEffect(() => {
    if (prev.current && prev.current !== "done" && status === "done") {
      void qc.invalidateQueries({ queryKey: ["field", workspaceId, fieldId, "ndvi"] });
    }
    prev.current = status;
  }, [status, qc, workspaceId, fieldId]);

  const z = zones.data;
  const running = z?.status === "queued" || z?.status === "running";
  const ready = z?.status === "done" && !!z.geojson;
  const nd = ndvi.data?.available ? ndvi.data : null;

  const progressText = (p: Progress) =>
    p.phase === "seasons"
      ? t("zzProgress_seasons", { season: p.season ?? 0, done: p.done ?? 0, total: p.total ?? 0 })
      : t(
          `zzProgress_${p.phase === "ndvi" || p.phase === "classify" ? p.phase : "queued"}` as "zzProgress_queued",
        );

  const buildLabel = running ? t("zzBuilding") : z?.status === "done" ? t("zzRebuild") : t("zzBuild");

  return (
    <div className="flex flex-col gap-5">
      <header className="flex flex-col gap-3">
        <h1 className="text-h1 text-ink">{fieldName}</h1>
        <FieldTabs fieldId={fieldId} active={3} />
      </header>

      <QueryState query={zones} skeletonVariant="map" what={w("zz5_whatZones")}>
        {(zd) => {
          // Not built, nothing running, nothing failed: one sentence and one action instead of a bare photo.
          const notBuilt =
            !zd.geojson && zd.status !== "queued" && zd.status !== "running" && zd.status !== "failed";
          const failed = zd.status === "failed";
          return (
            <Surface as="section" className="flex flex-col gap-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="max-w-[640px]">
                  <h2 className="text-h2 text-ink">
                    {t("zzTitle")} <InfoHint label={t("hintLabel")}>{t("zzMethod")}</InfoHint>
                  </h2>
                  <p className="mt-1 text-small text-ink-2">{w("zz5_intro")}</p>
                </div>
                {canEdit && !notBuilt && !failed && (
                  <div className="flex items-center gap-2">
                    {ready && !running ? (
                      <>
                        <Button
                          variant="primary"
                          icon={<MapIcon aria-hidden />}
                          onClick={() => setSheet(true)}
                        >
                          {w("zz5_createRate")}
                        </Button>
                        <Menu
                          label={w("zz5_more")}
                          items={[
                            {
                              id: "rebuild",
                              label: t("zzRebuild"),
                              icon: <RefreshCw />,
                              onSelect: () => build.mutate(),
                            },
                          ]}
                        />
                      </>
                    ) : (
                      <Button
                        variant="primary"
                        icon={<RefreshCw aria-hidden />}
                        disabled={running || build.isPending}
                        onClick={() => build.mutate()}
                      >
                        {buildLabel}
                      </Button>
                    )}
                  </div>
                )}
              </div>
              {!canEdit && !notBuilt && <p className="text-small text-ink-2">{w("zz5_readOnly")}</p>}

              {notBuilt ? (
                <div className="flex flex-col items-start gap-3 rounded-input bg-surface-2 p-4">
                  <p className="text-h3 text-ink">{w("zz6_emptyTitle")}</p>
                  <p className="max-w-[560px] text-body text-ink-2">
                    {canEdit ? w("zz6_emptyBody") : w("zz6_emptyReadOnly")}
                  </p>
                  {canEdit && (
                    <Button
                      variant="primary"
                      icon={<RefreshCw aria-hidden />}
                      disabled={build.isPending}
                      onClick={() => build.mutate()}
                    >
                      {buildLabel}
                    </Button>
                  )}
                </div>
              ) : (
                <>
                  <Tabs
                    label={t("zzLayers")}
                    value={layer}
                    onChange={(id) => setLayer(id as Layer)}
                    items={[
                      { id: "zones", label: t("zzLayerZones") },
                      { id: "ndvi", label: t("zzLayerNdvi") },
                    ]}
                  />

                  <div role="tabpanel" className="flex flex-col gap-4">
                    <ZonesMap
                      geometry={geometry}
                      zones={zd.geojson ?? null}
                      ndvi={nd ? { image: nd.image, corners: nd.corners } : null}
                      layer={layer}
                      label={t("zzMapLabel")}
                      onZone={setPicked}
                    />

                    {running && (
                      <div role="status" aria-live="polite" className="flex flex-col gap-2">
                        <p className="text-small font-semibold text-ink">{progressText(zd.progress)}</p>
                        <ProgressBar
                          value={zd.progress.done ?? 0}
                          max={Math.max(1, zd.progress.total ?? 1)}
                          label={w("zz5_buildingLabel")}
                        />
                        <p className="text-caption text-ink-2">{w("zz5_runningNote")}</p>
                      </div>
                    )}
                    {zd.status === "failed" && (
                      <div
                        role="alert"
                        className="flex flex-wrap items-center justify-between gap-3 rounded-input bg-urgent-soft p-3"
                      >
                        <p className="flex items-start gap-2 text-small text-ink">
                          <AlertTriangle
                            aria-hidden
                            className="mt-0.5 size-4 shrink-0 text-urgent"
                            strokeWidth={2}
                          />
                          <span>
                            <span className="block font-semibold">{w("zz5_failedTitle")}</span>
                            {zd.error && <span className="block text-ink-2">{zd.error}</span>}
                          </span>
                        </p>
                        {canEdit && (
                          <Button variant="outline" disabled={build.isPending} onClick={() => build.mutate()}>
                            {w("zz5_tryAgain")}
                          </Button>
                        )}
                      </div>
                    )}

                    {layer === "zones" ? (
                      zd.geojson ? (
                        <ZoneSummary zd={zd} picked={picked} onPick={setPicked} fmt={fmt} />
                      ) : null
                    ) : nd ? (
                      <div className="flex flex-col gap-2">
                        <p className="text-small font-semibold text-ink">
                          {t("zzNdviDate", { date: fmt.date(nd.date, "full") })}
                        </p>
                        <div className="flex items-center gap-3 text-caption text-ink-2">
                          <span>{t("zzNdviLow")}</span>
                          <span
                            aria-hidden
                            className="h-3 w-48 max-w-[40%] rounded-chip"
                            style={{
                              background: `linear-gradient(to right, ${nd.stops.map((s) => `rgb(${s.rgb.join(",")}) ${Math.round((s.value / 0.95) * 100)}%`).join(", ")})`,
                            }}
                          />
                          <span>{t("zzNdviHigh")}</span>
                        </div>
                      </div>
                    ) : ndvi.isError ? (
                      <QueryState query={ndvi} what={w("zz5_whatNdvi")}>
                        {() => null}
                      </QueryState>
                    ) : ndvi.isPending ? (
                      <Skeleton variant="text" rows={2} label={w("zz5_ndviLoading")} />
                    ) : (
                      <p className="text-small text-ink-2">{t("zzNdviNone")}</p>
                    )}
                  </div>
                </>
              )}

              <Disclosure summary={w("zz5_details")}>
                <div className="flex flex-col gap-1 pb-2 text-caption text-ink-2">
                  {zd.geojson && (
                    <p>
                      {t("zzSeasons", {
                        list: zd.seasons
                          .filter((s) => s.used)
                          .map((s) => s.season)
                          .join(", "),
                      })}
                      {zd.seasons.some((s) => !s.used) &&
                        ` · ${t("zzSeasonsSkipped", {
                          list: zd.seasons
                            .filter((s) => !s.used)
                            .map((s) => s.season)
                            .join(", "),
                        })}`}
                      {zd.builtAt && ` · ${t("zzBuiltAt", { date: fmt.date(zd.builtAt, "full") })}`}
                    </p>
                  )}
                  <p>{t("zzSource")}</p>
                  <p>{t("zzIsoxmlNote")}</p>
                </div>
              </Disclosure>
            </Surface>
          );
        }}
      </QueryState>

      {canEdit && ready && z && (
        <RateSheet
          open={sheet}
          onClose={() => setSheet(false)}
          base={base}
          stats={z.stats}
          imperial={fmt.units === "imperial"}
        />
      )}
    </div>
  );
}

/** Summary line, legend (colour + label, tap to select) and the selected zone's meaning. */
function ZoneSummary({
  zd,
  picked,
  onPick,
  fmt,
}: {
  zd: ZonesResponse;
  picked: ZoneName | null;
  onPick: (z: ZoneName | null) => void;
  fmt: ReturnType<typeof useFormat>;
}) {
  const w = useTranslations("Zones");
  const present = ZONES.filter((n) => zd.stats.some((s) => s.zone === n));
  const total = zd.stats.reduce((a, s) => a + s.areaHa, 0);
  const sel = picked ? zd.stats.find((s) => s.zone === picked) : undefined;
  return (
    <div className="flex flex-col gap-3">
      <p className="text-body text-ink">
        {w("zz5_summary", { zones: present.length, area: fmt.area(total), seasons: zd.seasonsUsed })}
      </p>
      <ul aria-label={w("zz5_legend")} className="grid gap-2 sm:grid-cols-3">
        {ZONES.map((name) => {
          const s = zd.stats.find((x) => x.zone === name);
          return (
            <li key={name}>
              <button
                type="button"
                aria-pressed={picked === name}
                disabled={!s}
                onClick={() => onPick(picked === name ? null : name)}
                className={`focus-ring flex min-h-11 w-full items-center gap-3 rounded-input border bg-surface-2 p-3 text-left ${
                  picked === name ? "border-ink" : "border-line"
                }`}
              >
                <span aria-hidden className={`size-4 shrink-0 rounded-chip ${ZONE_CLASS[name]}`} />
                <span>
                  <span className="block text-body font-semibold text-ink">{w(`zz5_zone_${name}`)}</span>
                  <span className="text-small text-ink-2">
                    {s
                      ? w("zz5_share", { share: fmt.percent(s.share), area: fmt.area(s.areaHa) })
                      : w("zz5_absent")}
                  </span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      <p role="status" className="min-h-5 text-small text-ink-2">
        {picked && sel
          ? w("zz5_selected", {
              zone: w(`zz5_zone_${picked}`),
              desc: w(`zz5_desc_${picked}`),
              share: fmt.percent(sel.share),
              area: fmt.area(sel.areaHa),
            })
          : w("zz5_tapZone")}
      </p>
    </div>
  );
}

/** The agronomist types every rate; nothing is prefilled or suggested (PD §3, FR-ZN-3). One sheet, one download. */
function RateSheet({
  open,
  onClose,
  base,
  stats,
  imperial,
}: {
  open: boolean;
  onClose: () => void;
  base: string;
  stats: ZonesResponse["stats"];
  imperial: boolean;
}) {
  const w = useTranslations("Zones");
  const toast = useActionToast();
  const units = imperial ? "imperial" : "metric";
  const [rates, setRates] = useState<Record<ZoneName, string>>({ strong: "", variable: "", weak: "" });
  const [unit, setUnit] = useState<ApiUnit>("kg/ha");
  const [product, setProduct] = useState("");
  const [format, setFormat] = useState<Format>("shapefile");
  const [error, setError] = useState<string | null>(null);

  const present = ZONES.filter((n) => stats.some((s) => s.zone === n));
  const parsed = (n: ZoneName) => toApiRate(rates[n], unit, units);
  const complete = present.every((n) => Number.isFinite(parsed(n)));
  const symbol = unitSymbol(unit, units);
  const isoxmlBlocked = format === "isoxml" && unit === "seeds/ha";

  const exp = useMutation({
    mutationFn: async () => {
      const body = {
        format,
        unit,
        product: product.trim() || undefined,
        // Zones absent from the field carry no area; the API still needs a number for them.
        rates: Object.fromEntries(ZONES.map((n) => [n, present.includes(n) ? parsed(n) : 0])),
      };
      const res = await fetch(`${base}/zones/export`, {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json", "X-Requested-With": "XMLHttpRequest" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const problem = (await res.json().catch(() => null)) as Problem | null;
        throw new ApiError(problem ?? { type: "about:blank", title: res.statusText, status: res.status });
      }
      const name =
        /filename="([^"]+)"/.exec(res.headers.get("content-disposition") ?? "")?.[1] ?? "rate-zones";
      const url = URL.createObjectURL(await res.blob());
      const a = document.createElement("a");
      a.href = url;
      a.download = name;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
    },
    onMutate: () => setError(null),
    onSuccess: () => onClose(),
    onError: (e) => {
      if (e instanceof ApiError && e.code === "isoxml-unit") setError(w("zz5_isoxmlUnit"));
      else toast.fail(e, w("zz5_whatExport"), () => exp.mutate());
    },
  });

  return (
    <BottomSheet
      open={open}
      title={w("zz5_sheetTitle")}
      primaryLabel={w("zz5_download")}
      cancelLabel={w("zz5_cancel")}
      primaryDisabled={!complete || exp.isPending || isoxmlBlocked}
      onPrimary={() => exp.mutate()}
      onClose={onClose}
    >
      <div className="flex max-h-[60dvh] flex-col gap-4 overflow-y-auto pr-1">
        <p className="text-small text-ink-2">{w("zz5_sheetIntro")}</p>
        {present.map((n) => (
          <TextField
            key={n}
            label={w("zz5_rateFor", { zone: w(`zz5_zone_${n}`) })}
            inputMode="decimal"
            value={rates[n]}
            onChange={(e) => setRates({ ...rates, [n]: e.target.value })}
            placeholder={w(`zz5_unit_${symbol}` as "zz5_unit_kg/ha")}
          />
        ))}
        <SelectField
          label={w("zz5_unit")}
          value={unit}
          onChange={(e) => setUnit(e.target.value as ApiUnit)}
          options={API_UNITS.map((u) => ({
            value: u,
            label: w(`zz5_unit_${unitSymbol(u, units)}` as "zz5_unit_kg/ha"),
          }))}
        />
        <SelectField
          label={w("zz5_format")}
          value={format}
          onChange={(e) => setFormat(e.target.value as Format)}
          options={(["shapefile", "geojson", "isoxml"] as const).map((f) => ({
            value: f,
            label: w(`zz5_format_${f}`),
          }))}
        />
        <TextField
          label={w("zz5_product")}
          hint={w("zz5_productHint")}
          value={product}
          maxLength={60}
          onChange={(e) => setProduct(e.target.value)}
        />
        {imperial && <p className="text-caption text-ink-2">{w("zz5_convert")}</p>}
        {!complete && <p className="text-caption text-ink-2">{w("zz5_fill")}</p>}
        {isoxmlBlocked && <p className="text-caption text-ink-2">{w("zz5_isoxmlUnit")}</p>}
        {error && (
          <p role="alert" className="flex items-start gap-2 text-small text-urgent">
            <AlertTriangle aria-hidden className="mt-0.5 size-4 shrink-0" />
            {error}
          </p>
        )}
      </div>
    </BottomSheet>
  );
}
