"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, InfoHint } from "@terrasight/ui";
import { Download, Layers, RefreshCw } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";
import { api, ApiError, type Problem } from "@/lib/api";
import { FieldTabs } from "../Overview";
import { ZonesMap, type FieldGeometry, type Layer, type NdviImage } from "./ZonesMap";

export type { FieldGeometry } from "./ZonesMap";

type ZoneName = "strong" | "variable" | "weak";
const ZONES: ZoneName[] = ["strong", "variable", "weak"];
type Unit = "kg/ha" | "seeds/ha" | "l/ha";
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
  | ({ available: true; date: string; stops: Array<{ value: number; rgb: [number, number, number] }> } & NdviImage);

const ZONE_CLASS: Record<ZoneName, string> = {
  strong: "bg-ok",
  variable: "bg-week-mark",
  weak: "bg-urgent",
};

/** Field tab "Zones": stable zones and latest NDVI on one map, and the rate form for the export (FR-ZN-1..3). */
export function ZonesClient({
  workspaceId,
  fieldId,
  fieldName,
  geometry,
  canEdit,
}: {
  workspaceId: string;
  fieldId: string;
  fieldName: string;
  geometry: FieldGeometry;
  canEdit: boolean;
}) {
  const t = useTranslations("App");
  const locale = useLocale() as "en" | "uk";
  const qc = useQueryClient();
  const base = `/api/w/${workspaceId}/fields/${fieldId}`;
  const [layer, setLayer] = useState<Layer>("zones");

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
    mutationFn: () => api<ZonesResponse>(`${base}/zones/build`, { method: "POST" }),
    onSuccess: (d) => qc.setQueryData(["field", workspaceId, fieldId, "zones"], (old: ZonesResponse | undefined) => ({ ...old, ...d })),
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
  const date = (iso: string) =>
    new Intl.DateTimeFormat(locale === "uk" ? "uk-UA" : "en-US", { day: "numeric", month: "long", year: "numeric" }).format(
      new Date(iso),
    );
  const nd = ndvi.data?.available ? ndvi.data : null;
  const num = (v: number, digits = 1) =>
    new Intl.NumberFormat(locale === "uk" ? "uk-UA" : "en-US", { maximumFractionDigits: digits }).format(v);

  const progressText = (p: Progress) =>
    p.phase === "seasons"
      ? t("zzProgress_seasons", { season: p.season ?? 0, done: p.done ?? 0, total: p.total ?? 0 })
      : t(`zzProgress_${p.phase === "ndvi" || p.phase === "classify" ? p.phase : "queued"}` as "zzProgress_queued");

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-3">
        <h1 className="text-h1 text-ink">{fieldName}</h1>
        <FieldTabs fieldId={fieldId} active={3} />
      </header>

      <section className="flex flex-col gap-4 rounded-card border border-line bg-surface p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="max-w-[640px]">
            <h2 className="text-h2 text-ink">
              {t("zzTitle")} <InfoHint label={t("hintLabel")}>{t("zzMethod")}</InfoHint>
            </h2>
            <p className="mt-1 text-small text-ink-2">{t("zzIntro")}</p>
          </div>
          {canEdit && (
            <Button
              variant="primary"
              icon={<RefreshCw aria-hidden />}
              disabled={running || build.isPending}
              onClick={() => build.mutate()}
            >
              {running ? t("zzBuilding") : z?.status === "done" ? t("zzRebuild") : t("zzBuild")}
            </Button>
          )}
        </div>

        {running && (
          <div role="status" aria-live="polite" className="flex flex-col gap-2">
            <p className="text-small font-semibold text-ink">{progressText(z!.progress)}</p>
            <div className="h-2 overflow-hidden rounded-chip bg-muted">
              <span
                className="block h-full bg-ink transition-[width]"
                style={{ width: `${Math.min(100, ((z!.progress.done ?? 0) / Math.max(1, z!.progress.total ?? 1)) * 100)}%` }}
              />
            </div>
          </div>
        )}
        {z?.status === "failed" && (
          <p role="alert" className="text-small text-urgent">
            {t("zzFailed", { error: z.error ?? "" })}
          </p>
        )}
        {(zones.isError || build.isError) && <p className="text-small text-urgent">{t("errGeneric")}</p>}
        {!canEdit && <p className="text-small text-ink-2">{t("zzReadOnly")}</p>}

        <div role="group" aria-label={t("zzLayers")} className="flex w-fit gap-1 rounded-input bg-muted p-1">
          {(["zones", "ndvi"] as const).map((l) => (
            <button
              key={l}
              type="button"
              aria-pressed={layer === l}
              onClick={() => setLayer(l)}
              className={`focus-ring inline-flex items-center gap-2 whitespace-nowrap rounded-btn px-4 py-2 text-body font-semibold ${layer === l ? "bg-ink text-surface" : "text-ink hover:bg-surface"}`}
            >
              <Layers aria-hidden className="size-4" />
              {l === "zones" ? t("zzLayerZones") : t("zzLayerNdvi")}
            </button>
          ))}
        </div>

        <ZonesMap
          geometry={geometry}
          zones={z?.geojson ?? null}
          ndvi={nd ? { image: nd.image, corners: nd.corners } : null}
          layer={layer}
          label={t("zzMapLabel")}
        />

        {layer === "zones" ? (
          z?.geojson ? (
            <div className="flex flex-col gap-3">
              <ul aria-label={t("zzLegendTitle")} className="grid gap-3 sm:grid-cols-3">
                {ZONES.map((name) => {
                  const s = z.stats.find((x) => x.zone === name);
                  return (
                    <li key={name} className="flex items-center gap-3 rounded-input bg-surface-2 p-3">
                      <span aria-hidden className={`size-4 shrink-0 rounded-chip ${ZONE_CLASS[name]}`} />
                      <span>
                        <span className="block text-body font-semibold text-ink">{t(`zzZone_${name}`)}</span>
                        <span className="font-mono text-small text-ink-2">
                          {s ? t("zzShare", { pct: Math.round(s.share * 100), ha: num(s.areaHa) }) : t("zzZoneAbsent")}
                        </span>
                      </span>
                    </li>
                  );
                })}
              </ul>
              <p className="text-small text-ink-2">
                {t("zzSeasons", {
                  list: z.seasons
                    .filter((s) => s.used)
                    .map((s) => s.season)
                    .join(", "),
                })}
                {z.seasons.some((s) => !s.used) &&
                  ` · ${t("zzSeasonsSkipped", { list: z.seasons.filter((s) => !s.used).map((s) => s.season).join(", ") })}`}
                {z.builtAt && ` · ${t("zzBuiltAt", { date: date(z.builtAt) })}`}
              </p>
            </div>
          ) : (
            !running && <p className="text-small text-ink-2">{zones.isLoading ? "" : t("zzNone")}</p>
          )
        ) : nd ? (
          <div className="flex flex-col gap-2">
            <p className="text-small font-semibold text-ink">{t("zzNdviDate", { date: date(nd.date) })}</p>
            <div className="flex items-center gap-3 text-small text-ink-2">
              <span>{t("zzNdviLow")}</span>
              <span
                aria-hidden
                className="h-3 w-48 rounded-chip"
                style={{
                  background: `linear-gradient(to right, ${nd.stops.map((s) => `rgb(${s.rgb.join(",")}) ${Math.round((s.value / 0.95) * 100)}%`).join(", ")})`,
                }}
              />
              <span>{t("zzNdviHigh")}</span>
            </div>
          </div>
        ) : (
          <p className="text-small text-ink-2">{ndvi.isLoading ? t("zzNdviLoading") : t("zzNdviNone")}</p>
        )}
        <p className="text-micro text-ink-3">{t("zzSource")}</p>
      </section>

      {canEdit && z?.status === "done" && z.geojson && (
        <RateForm base={base} fieldName={fieldName} stats={z.stats} />
      )}
    </div>
  );
}

/** The agronomist types every rate; nothing is prefilled or suggested (PD §3, FR-ZN-3). */
function RateForm({ base, stats }: { base: string; fieldName: string; stats: ZonesResponse["stats"] }) {
  const t = useTranslations("App");
  const [rates, setRates] = useState<Record<ZoneName, string>>({ strong: "", variable: "", weak: "" });
  const [unit, setUnit] = useState<Unit>("kg/ha");
  const [product, setProduct] = useState("");
  const [error, setError] = useState<string | null>(null);

  const present = ZONES.filter((z) => stats.some((s) => s.zone === z));
  const parsed = (v: string) => (v.trim() === "" ? NaN : Number(v.replace(",", ".")));
  const complete = present.every((z) => Number.isFinite(parsed(rates[z])) && parsed(rates[z]) >= 0);

  const exp = useMutation({
    mutationFn: async (format: Format) => {
      const body = {
        format,
        unit,
        product: product.trim() || undefined,
        // Zones absent from the field carry no area; the API still needs a number for them.
        rates: Object.fromEntries(ZONES.map((z) => [z, present.includes(z) ? parsed(rates[z]) : 0])),
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
      const name = /filename="([^"]+)"/.exec(res.headers.get("content-disposition") ?? "")?.[1] ?? "rate-zones";
      const url = URL.createObjectURL(await res.blob());
      const a = document.createElement("a");
      a.href = url;
      a.download = name;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
    },
    onMutate: () => setError(null),
    onError: (e) => setError(e instanceof ApiError && e.code === "isoxml-unit" ? t("zzIsoxmlUnit") : t("zzExportFailed")),
  });

  const field =
    "min-h-11 w-full rounded-input border border-line-strong bg-surface px-3 text-body text-ink placeholder:text-ink-3";
  return (
    <section className="flex flex-col gap-4 rounded-card border border-line bg-surface p-6">
      <div>
        <h2 className="text-h2 text-ink">{t("zzRatesTitle")}</h2>
        <p className="mt-1 text-small font-semibold text-ink">{t("zzNoRates")}</p>
        <p className="mt-1 text-small text-ink-2">{t("zzRatesHint")}</p>
      </div>
      <div className="grid gap-4 sm:grid-cols-3">
        {present.map((z) => (
          <label key={z} className="flex flex-col gap-1 text-small font-semibold text-ink">
            <span className="flex items-center gap-2">
              <span aria-hidden className={`size-3 rounded-chip ${ZONE_CLASS[z]}`} />
              {t(`zzZone_${z}`)}
            </span>
            <input
              inputMode="decimal"
              value={rates[z]}
              onChange={(e) => setRates({ ...rates, [z]: e.target.value })}
              aria-label={t("zzRate", { zone: t(`zzZone_${z}`) })}
              placeholder={t("zzRatePlaceholder", { unit })}
              className={field}
            />
          </label>
        ))}
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="flex flex-col gap-1 text-small font-semibold text-ink">
          {t("zzUnit")}
          <select value={unit} onChange={(e) => setUnit(e.target.value as Unit)} className={field}>
            <option value="kg/ha">kg/ha</option>
            <option value="seeds/ha">{t("zzUnitSeeds")}</option>
            <option value="l/ha">l/ha</option>
          </select>
        </label>
        <label className="flex flex-col gap-1 text-small font-semibold text-ink">
          {t("zzProduct")}
          <input
            value={product}
            maxLength={60}
            onChange={(e) => setProduct(e.target.value)}
            className={field}
            aria-describedby="zz-product-hint"
          />
          <span id="zz-product-hint" className="text-micro font-normal text-ink-3">
            {t("zzProductHint")}
          </span>
        </label>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        {(["shapefile", "geojson", "isoxml"] as const).map((f) => (
          <Button
            key={f}
            variant={f === "shapefile" ? "primary" : "outline"}
            icon={<Download aria-hidden />}
            disabled={!complete || exp.isPending || (f === "isoxml" && unit === "seeds/ha")}
            onClick={() => exp.mutate(f)}
          >
            {t(`zzExport_${f}`)}
          </Button>
        ))}
      </div>
      {!complete && <p className="text-small text-ink-2">{t("zzExportFill")}</p>}
      {unit === "seeds/ha" && <p className="text-small text-ink-2">{t("zzIsoxmlUnit")}</p>}
      {error && (
        <p role="alert" className="text-small text-urgent">
          {error}
        </p>
      )}
      <p className="text-micro text-ink-3">{t("zzIsoxmlNote")}</p>
    </section>
  );
}
