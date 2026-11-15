"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Button,
  Chip,
  FieldThumb,
  InfoHint,
  SeasonLabel,
  SelectField,
  TextField,
  cropColour,
} from "@terrasight/ui";
import {
  AlertTriangle,
  CalendarDays,
  Check,
  Droplet,
  Info,
  Leaf,
  Loader2,
  Minus,
  ShieldCheck,
  Sprout,
  Sun,
} from "lucide-react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { useState, type FormEvent } from "react";
import { api } from "@/lib/api";
import { useWorkspaceEvents } from "@/lib/events";
import { FieldAssistant } from "@/components/FieldAssistant";
import { TodayWindows } from "@/components/TodayWindows";
import { YieldCard } from "./YieldCard";
import { GatherFocus, isFirstBuild } from "./GatherFocus";
import { FieldBrief, FieldTabs, RisksCard, WeatherCard, type Risk } from "./Overview";

export interface FieldView {
  id: string;
  name: string;
  areaHa: number;
  countyName: string | null;
  tier: "A" | "B" | "C";
  irrigation: "irrigated" | "dryland" | "unknown";
  irrigationSource: string;
  thumb?: string | null;
}

type TaskStatus = "queued" | "running" | "done" | "partial" | "failed" | "cached";
interface GatherStatus {
  status: string;
  startedAt?: string | null;
  sources: Array<{
    source: string;
    label: string;
    status: TaskStatus;
    reason: string | null;
    dataDate: string | null;
  }>;
}

interface History {
  built: { at: string; provisional: boolean } | null;
  seasons: Array<{
    season: number;
    mainCrop: string;
    secondCrop: string | null;
    confidence: number;
    source: string;
    isOverride: boolean;
  }>;
  stressYears: Array<{ season: number; reasons: string[] }>;
  irrigation: {
    value: FieldView["irrigation"];
    source: string;
    detection: { status: string; method: string; confidence: number } | null;
  };
  currentRotation: { label: string; share: number; rotationId: string | null } | null;
  cropNames: Record<string, { en: string; uk: string }>;
}

interface Resolved<T> {
  value: T | null;
  source: "confirmed" | "plan" | "estimate" | "regional" | "unknown";
}
interface SeasonRecord {
  season: number;
  crop: Resolved<string>;
  sowingDate: Resolved<string>;
  emergenceDate: Resolved<string>;
  tillage: Resolved<string>;
  missing: string[];
}

const HA_TO_AC = 2.471054;

export function FieldClient({
  workspaceId,
  units,
  canEdit,
  initial,
}: {
  workspaceId: string;
  units: "metric" | "imperial";
  canEdit: boolean;
  initial: FieldView;
}) {
  const t = useTranslations("App");
  const f = useTranslations("Field");
  const id = initial.id;
  const base = `/api/w/${workspaceId}/fields/${id}`;
  // SSE topic `field:<id>` invalidates every query under ["field", ws, id] (lib/events defaultTopicKeys).
  useWorkspaceEvents(workspaceId, [`field:${id}`]);

  const field = useQuery({
    queryKey: ["field", workspaceId, id, "info"],
    queryFn: () => api<FieldView>(base),
    initialData: initial,
  });
  const gather = useQuery({
    queryKey: ["field", workspaceId, id, "gather"],
    queryFn: () => api<GatherStatus | null>(`${base}/gather`),
    refetchInterval: (q) => (q.state.data?.status === "running" ? 10_000 : false),
  });
  const locale = useLocale();
  const risks = useQuery({
    queryKey: ["field", workspaceId, id, "risks"],
    queryFn: () => api<Risk[]>(`${base}/recommendations`),
  });
  const history = useQuery({
    queryKey: ["field", workspaceId, id, "history"],
    queryFn: () => api<History>(`${base}/history`),
  });
  const building = isFirstBuild(gather.data, history.isLoading || Boolean(history.data?.built));
  const record = useQuery({
    queryKey: ["field", workspaceId, id, "season"],
    queryFn: () => api<SeasonRecord>(`${base}/season-records/current`),
  });
  const rotations = useQuery({
    queryKey: ["rotations", workspaceId],
    queryFn: () =>
      api<{
        season: number;
        fields: Array<{
          fieldId: string;
          plan: { crop: string } | null;
          recommendation: { firstCrop: string | null } | null;
        }>;
      }>(`/api/w/${workspaceId}/rotations`),
  });
  const mine = rotations.data?.fields.find((x) => x.fieldId === id);
  const planInfo = rotations.data
    ? {
        season: rotations.data.season,
        crop: mine?.plan?.crop ?? mine?.recommendation?.firstCrop ?? null,
        agreed: Boolean(mine?.plan),
      }
    : null;

  const area = units === "imperial" ? initial.areaHa * HA_TO_AC : initial.areaHa;
  const irrigationWord = field.data.irrigation === "unknown" ? null : t(field.data.irrigation);
  const meta = [
    `${area.toLocaleString(undefined, { maximumFractionDigits: 1 })} ${units === "imperial" ? "ac" : "ha"}`,
    irrigationWord,
    field.data.countyName,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_380px]">
      <div className="flex min-w-0 flex-col gap-6">
        <header className="flex flex-col gap-2">
          <div className="flex items-center gap-4">
            <FieldThumb
              name={field.data.name}
              outline={field.data.thumb ?? null}
              crop={history.data?.seasons.at(-1)?.mainCrop ?? null}
              size={64}
            />
            <h1 className="text-h1 text-ink">{field.data.name}</h1>
          </div>
          <p className="flex flex-wrap items-center gap-3 text-body text-ink-2">
            {meta}
            <Chip
              tone={initial.tier === "A" ? "ok" : initial.tier === "B" ? "info" : "week"}
              icon={<ShieldCheck />}
            >
              {f(`tier_${initial.tier}`)}
            </Chip>
            <InfoHint label={t("hintLabel")}>{t(`hintTier_${initial.tier}` as "hintTier_A")}</InfoHint>
          </p>
        </header>
        <FieldTabs fieldId={id} />
        <GatherFocus
          status={gather.data}
          building={building}
          fieldName={field.data.name}
          outline={field.data.thumb ?? null}
          canEdit={canEdit}
          onRetry={(source) =>
            void api(`${base}/gather/sources/${source}/retry`, { method: "POST" }).then(() => gather.refetch())
          }
        />
        <div
          inert={building}
          aria-hidden={building || undefined}
          className={`flex min-w-0 flex-col gap-6 transition-opacity duration-rise ease-ts ${building ? "pointer-events-none select-none opacity-40" : ""}`}
        >

        {history.data && (
          <FieldBrief
            fieldId={id}
            risks={risks.data ?? []}
            seasons={history.data.seasons}
            cropName={(c) => cropLabel(history.data!.cropNames, locale, c)}
          />
        )}
        {history.data && (
          <StatCards
            history={history.data}
            record={record.data ?? null}
            plan={planInfo}
            cropName={(c) => cropLabel(history.data!.cropNames, locale, c)}
          />
        )}
        <YieldCard workspaceId={workspaceId} fieldId={id} units={units} />
        <RisksCard risks={risks.data ?? []} />
        <WeatherCard workspaceId={workspaceId} fieldId={id} units={units} />
        <TodayWindows workspaceId={workspaceId} fieldId={id} units={units} />
        {history.data && <HistoryCard history={history.data} fieldId={id} />}

        {gather.data && !building && (
          <GatherPanel
            status={gather.data}
            base={base}
            canEdit={canEdit}
            onRetried={() => void gather.refetch()}
          />
        )}
        {history.data && (
          <IrrigationCard
            history={history.data}
            field={field.data}
            base={base}
            canEdit={canEdit}
            workspaceId={workspaceId}
          />
        )}
        {history.data && (
          <SeasonCard
            base={base}
            canEdit={canEdit}
            cropNames={history.data.cropNames}
            workspaceId={workspaceId}
            fieldId={id}
          />
        )}
        </div>
      </div>
      {canEdit && (
        <aside className="min-w-0 xl:sticky xl:top-6 xl:self-start">
          <FieldAssistant workspaceId={workspaceId} fieldId={id} fieldName={field.data.name} />
        </aside>
      )}
    </div>
  );
}

/** Crop · This season · Plan (design 08): the field's state at a glance, from its history, season record and plan. */
function StatCards({
  history,
  record,
  plan,
  cropName,
}: {
  history: History;
  record: SeasonRecord | null;
  plan: { season: number; crop: string | null; agreed: boolean } | null;
  cropName: (c: string) => string;
}) {
  const t = useTranslations("App");
  const locale = useLocale();
  const last = [...history.seasons].sort((a, b) => b.season - a.season)[0];
  const day = (iso: string) =>
    new Intl.DateTimeFormat(locale === "uk" ? "uk-UA" : "en-US", {
      timeZone: "UTC",
      day: "numeric",
      month: "long",
    }).format(new Date(`${iso}T12:00:00Z`));
  const cards = [
    {
      icon: <Leaf />,
      tone: "bg-week-soft text-week",
      k: t("fcCrop"),
      v: record?.crop.value ? cropName(record.crop.value) : last ? cropName(last.mainCrop) : "—",
      s: record?.crop.value
        ? t("fcSeason", { season: record.season })
        : last
          ? t("fcLastSeason", { season: last.season })
          : "",
    },
    {
      icon: <CalendarDays />,
      tone: "bg-info-soft text-info",
      k: t("fcSowing"),
      v: record?.sowingDate.value ? day(record.sowingDate.value) : "—",
      s: record?.sowingDate.value ? t(`fcSrc_${record.sowingDate.source}`) : t("fcNoSowing"),
    },
    {
      icon: <Sprout />,
      tone: "bg-ok-soft text-ok",
      k: plan ? t("fcPlan", { season: plan.season }) : t("fcPlanNone"),
      v: plan?.crop ? cropName(plan.crop) : "—",
      s: plan ? (plan.agreed ? t("fcAgreed") : t("fcNotAgreed")) : "",
    },
  ];
  return (
    <div className="grid gap-4 md:grid-cols-3">
      {cards.map((c) => (
        <section key={c.k} className="flex gap-3 rounded-card border border-line bg-surface p-5">
          <span
            aria-hidden
            className={`inline-flex size-10 shrink-0 items-center justify-center rounded-full ${c.tone} [&>svg]:size-5 [&>svg]:stroke-[1.7]`}
          >
            {c.icon}
          </span>
          <span className="min-w-0">
            <span className="block text-small text-ink-2">{c.k}</span>
            <span className="block text-[22px] leading-7 font-bold text-ink">{c.v}</span>
            {c.s && <span className="block text-small text-ink-2">{c.s}</span>}
          </span>
        </section>
      ))}
    </div>
  );
}

const TASK_ICON: Record<TaskStatus, React.ReactNode> = {
  queued: <Minus aria-hidden className="size-4 text-ink-3" />,
  running: <Loader2 aria-hidden className="size-4 animate-spin text-ink" />,
  done: <Check aria-hidden className="size-4 text-ok" />,
  cached: <Check aria-hidden className="size-4 text-ok" />,
  partial: <AlertTriangle aria-hidden className="size-4 text-week" />,
  failed: <AlertTriangle aria-hidden className="size-4 text-urgent" />,
};

/** Per-source progress (S-02.04, RFC §5.3): status, data date, reason and Retry for failed or partial sources. */
function GatherPanel({
  status,
  base,
  canEdit,
  onRetried,
}: {
  status: GatherStatus;
  base: string;
  canEdit: boolean;
  onRetried: () => void;
}) {
  const t = useTranslations("App");
  const finished = status.sources.filter((s) => !["queued", "running"].includes(s.status)).length;
  const problems = status.sources.some((s) => s.status === "failed" || s.status === "partial");
  const title =
    status.status === "running" ? t("gatherTitle") : problems ? t("gatherPartial") : t("gatherDone");
  const retry = async (source: string) => {
    await api(`${base}/gather/sources/${source}/retry`, { method: "POST" });
    onRetried();
  };
  return (
    <section
      aria-busy={status.status === "running"}
      className="rounded-card border border-line bg-surface p-5"
    >
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="text-h2 text-ink">{title}</h2>
        <span className="font-mono text-small text-ink-2">
          {finished}/{status.sources.length}
        </span>
      </div>
      <div className="mb-4 h-1.5 overflow-hidden rounded-chip bg-muted">
        <div
          className="h-full bg-ink transition-[width]"
          style={{ width: `${(finished / Math.max(1, status.sources.length)) * 100}%` }}
        />
      </div>
      <ul className="flex flex-col divide-y divide-line">
        {status.sources.map((s) => (
          <li key={s.source} className="flex items-center gap-3 py-2">
            {TASK_ICON[s.status]}
            <span className="flex-1">
              <span className="block text-body text-ink">{s.label}</span>
              {s.reason && <span className="block text-small text-ink-2">{s.reason}</span>}
            </span>
            <span className="font-mono text-small text-ink-2">{s.dataDate ?? t(`st_${s.status}`)}</span>
            {canEdit && (s.status === "failed" || s.status === "partial") && (
              <Button size={44} variant="outline" onClick={() => void retry(s.source)}>
                {t("retry")}
              </Button>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

function cropLabel(names: History["cropNames"], locale: string, id: string): string {
  const n = names[id];
  if (!n) return id.startsWith("other:") ? "—" : id;
  return locale === "uk" ? n.uk : n.en;
}

/** 18-season strip (design 08): one tile per season in crop colours, red dot on stress years. */
function HistoryCard({ history, fieldId }: { history: History; fieldId: string }) {
  const t = useTranslations("App");
  const locale = useLocale();
  const stress = new Map(history.stressYears.map((s) => [s.season, s.reasons]));
  const bySeason = new Map(history.seasons.map((s) => [s.season, s]));
  // Always 18 slots ending at the last known season, so a season without data shows as "unknown", not as a gap.
  const lastKnown = history.seasons.reduce((m, s) => Math.max(m, s.season), 0);
  const slots = lastKnown ? Array.from({ length: 18 }, (_, i) => lastKnown - 17 + i) : [];
  const first = slots[0];
  const last = slots.at(-1);
  const hasEstimate = history.seasons.some((s) => s.source === "ndvi" && !s.isOverride);
  const hasUnknown = slots.some((y) => !bySeason.has(y));
  const name = (id: string) => cropLabel(history.cropNames, locale, id);
  const sourceWord = (s: History["seasons"][number]) =>
    s.isOverride
      ? t("hs_user")
      : s.source === "cdl"
        ? "USDA CDL"
        : s.source === "ndvi"
          ? `MODIS NDVI · ${t("src_estimate")}`
          : s.source;
  return (
    <section className="rounded-card border border-line bg-surface p-5">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-h2 text-ink">{t("historyTitle")}</h2>
        <Link
          href={`/fields/${fieldId}/rotation`}
          className="focus-ring shrink-0 text-body font-semibold text-ink underline underline-offset-4"
        >
          {t("historyDetails")}
        </Link>
      </div>
      {history.built?.provisional && <p className="mt-1 text-small text-week">{t("historyProvisional")}</p>}
      {history.stressYears.length > 0 && (
        <p className="mt-1 text-body text-ink-2">
          {t("stressTitle")}: {history.stressYears.map((s) => s.season).join(", ")}
        </p>
      )}
      {slots.length === 0 ? (
        <p className="mt-3 text-small text-ink-2">{t("historyUnknown")}</p>
      ) : (
        <>
          <ol
            aria-label={slots
              .map((y) => {
                const s = bySeason.get(y);
                return s
                  ? `${y}: ${name(s.mainCrop)}${s.secondCrop ? ` + ${name(s.secondCrop)}` : ""} (${sourceWord(s)})`
                  : `${y}: ${t("historyUnknownTile")}`;
              })
              .join(", ")}
            className="mt-4 grid grid-cols-[repeat(18,minmax(0,1fr))] gap-0.5 sm:gap-1.5"
          >
            {slots.map((y) => {
              const s = bySeason.get(y);
              const estimate = s?.source === "ndvi" && !s.isOverride;
              return (
                <li
                  key={y}
                  title={
                    s
                      ? `${y}: ${name(s.mainCrop)}${s.secondCrop ? ` + ${name(s.secondCrop)}` : ""} · ${sourceWord(s)} · ${Math.round(s.confidence * 100)}%`
                      : `${y}: ${t("historyUnknownTile")}`
                  }
                  className="relative min-w-0"
                >
                  {s ? (
                    <span
                      className={`flex aspect-square overflow-hidden rounded-[4px] sm:rounded-[6px] ${estimate ? "outline-dashed outline-1 -outline-offset-1 outline-ink-3" : ""}`}
                      style={{ opacity: s.confidence < 0.5 ? 0.55 : estimate ? 0.8 : 1 }}
                    >
                      <span className="flex-1" style={{ backgroundColor: cropColour(s.mainCrop) }} />
                      {s.secondCrop && (
                        <span className="w-1/3" style={{ backgroundColor: cropColour(s.secondCrop) }} />
                      )}
                    </span>
                  ) : (
                    <span className="flex aspect-square items-center justify-center rounded-[4px] border border-dashed border-line-strong bg-muted font-mono text-[10px] text-ink-3 sm:rounded-[6px]">
                      ?
                    </span>
                  )}
                  {stress.has(y) && (
                    <span
                      aria-hidden
                      className="absolute -right-0.5 -top-0.5 size-2 rounded-chip border border-surface bg-urgent sm:size-2.5 sm:border-2"
                    />
                  )}
                </li>
              );
            })}
          </ol>
          <div className="mt-2 flex justify-between font-mono text-small text-ink-3">
            <span>{first}</span>
            <span>{last}</span>
          </div>
        </>
      )}
      {hasEstimate && <p className="mt-3 text-small text-ink-2">{t("historyEstimateHint")}</p>}
      {hasUnknown && slots.length > 0 && <p className="mt-1 text-small text-ink-2">{t("historyUnknownHint")}</p>}
      {history.currentRotation && history.currentRotation.label !== "none" && (
        <p className="mt-3 text-small text-ink-2">
          {t("currentRotation")}: {history.currentRotation.rotationId ?? t("detectedFromHistory")} ·{" "}
          {Math.round(history.currentRotation.share * 100)}%
        </p>
      )}
    </section>
  );
}

/** Irrigation: one compact row. Detected, then optionally confirmed or changed (RFC §6.2, S-02.06). */
function IrrigationCard({
  history,
  field,
  base,
  canEdit,
  workspaceId,
}: {
  history: History;
  field: FieldView;
  base: string;
  canEdit: boolean;
  workspaceId: string;
}) {
  const t = useTranslations("App");
  const client = useQueryClient();
  const [open, setOpen] = useState(false);
  const [info, setInfo] = useState(false);
  const set = useMutation({
    mutationFn: (irrigation: "irrigated" | "dryland") => api(base, { method: "PATCH", body: { irrigation } }),
    onSuccess: () => {
      setOpen(false);
      void client.invalidateQueries({ queryKey: ["field", workspaceId, field.id] });
    },
  });
  const d = history.irrigation.detection;
  const known = field.irrigation !== "unknown";
  const confirmed = field.irrigationSource === "confirmed";
  const value = known ? t(field.irrigation as "irrigated" | "dryland") : "";
  const summary = !known
    ? t("irrRowUnknown")
    : confirmed || !d
      ? t("irrRowConfirmed", { value })
      : t("irrRowDetected", { value, confidence: Math.round(d.confidence * 100) });
  return (
    <section className="rounded-card border border-line bg-surface px-5 py-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <h2 className="text-body font-semibold text-ink">{t("irrigationTitle")}</h2>
        <p className="text-body text-ink-2">{summary}</p>
        <button
          type="button"
          aria-label={t("irrInfoLabel")}
          aria-expanded={info}
          onClick={() => setInfo(!info)}
          className="focus-ring inline-flex size-8 items-center justify-center rounded-chip text-ink-2"
        >
          <Info aria-hidden className="size-4" strokeWidth={1.7} />
        </button>
        {canEdit && (
          <Button variant="outline" onClick={() => setOpen(!open)} aria-expanded={open}>
            {t("irrChange")}
          </Button>
        )}
      </div>
      {info && <p className="mt-2 text-small text-ink-2">{t("irrInfo")}</p>}
      {canEdit && open && (
        <div className="mt-3 flex flex-wrap gap-2">
          {known && !confirmed && (
            <Button
              icon={<Check />}
              onClick={() => set.mutate(field.irrigation as "irrigated" | "dryland")}
              disabled={set.isPending}
            >
              {t("confirm")}
            </Button>
          )}
          {(["irrigated", "dryland"] as const)
            .filter((v) => !known || confirmed || v !== field.irrigation)
            .map((v) => (
              <Button
                key={v}
                variant="outline"
                icon={v === "irrigated" ? <Droplet /> : <Sun />}
                onClick={() => set.mutate(v)}
                disabled={set.isPending}
              >
                {t(v)}
              </Button>
            ))}
        </div>
      )}
    </section>
  );
}

/** This season's record with the source of each value (RFC §6.4, S-02.08). */
function SeasonCard({
  base,
  canEdit,
  cropNames,
  workspaceId,
  fieldId,
}: {
  base: string;
  canEdit: boolean;
  cropNames: History["cropNames"];
  workspaceId: string;
  fieldId: string;
}) {
  const t = useTranslations("App");
  const locale = useLocale();
  const client = useQueryClient();
  const [saved, setSaved] = useState(false);
  const record = useQuery({
    queryKey: ["field", workspaceId, fieldId, "season"],
    queryFn: () => api<SeasonRecord>(`${base}/season-records/current`),
  });
  const save = useMutation({
    mutationFn: (body: Record<string, string | null>) =>
      api<SeasonRecord>(`${base}/season-records/${record.data!.season}`, { method: "PUT", body }),
    onSuccess: (r) => {
      client.setQueryData(["field", workspaceId, fieldId, "season"], r);
      setSaved(true);
    },
  });
  if (!record.data) return null;
  const r = record.data;
  const options = [
    { value: "", label: "—" },
    ...Object.keys(cropNames)
      .map((id) => ({ value: id, label: cropLabel(cropNames, locale, id) }))
      .sort((a, b) => a.label.localeCompare(b.label)),
  ];
  const source = (v: Resolved<unknown>) => t(`src_${v.source}`);
  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const val = (k: string) => String(fd.get(k) ?? "") || null;
    setSaved(false);
    save.mutate({
      crop: val("crop"),
      sowingDate: val("sowingDate"),
      emergenceDate: val("emergenceDate"),
      tillage: val("tillage"),
    });
  };
  return (
    <section className="rounded-card border border-line bg-surface p-5">
      <h2 className="text-h2 text-ink">
        {t("seasonTitle")} ·{" "}
        <SeasonLabel
          year={r.season}
          hintLabel={t("hintLabel")}
          hintTemplate={`${t("hintSeason")} ${t("hintSeasonNow")}`}
        />
      </h2>
      <form onSubmit={submit} className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <SelectField
          label={t("crop")}
          name="crop"
          options={options}
          defaultValue={r.crop.value ?? ""}
          hint={source(r.crop)}
          disabled={!canEdit}
        />
        <TextField
          label={t("sowing")}
          name="sowingDate"
          type="date"
          defaultValue={r.sowingDate.value ?? ""}
          hint={source(r.sowingDate)}
          disabled={!canEdit}
        />
        <TextField
          label={t("emergence")}
          name="emergenceDate"
          type="date"
          defaultValue={r.emergenceDate.value ?? ""}
          hint={source(r.emergenceDate)}
          disabled={!canEdit}
        />
        <SelectField
          label={t("tillage")}
          name="tillage"
          options={[
            { value: "", label: "—" },
            ...(["conventional", "reduced", "no_till"] as const).map((v) => ({
              value: v,
              label: t(`till_${v}`),
            })),
          ]}
          defaultValue={r.tillage.value ?? ""}
          hint={source(r.tillage)}
          disabled={!canEdit}
        />
        {r.missing.length > 0 && (
          <p className="text-small text-week md:col-span-2 xl:col-span-4">
            {t("missing", { list: r.missing.join(", ") })}
          </p>
        )}
        {canEdit && (
          <div className="flex items-center gap-3 md:col-span-2 xl:col-span-4">
            <Button type="submit" disabled={save.isPending} aria-busy={save.isPending}>
              {t("save")}
            </Button>
            {saved && (
              <span role="status" className="text-small text-ok">
                {t("saved")}
              </span>
            )}
          </div>
        )}
      </form>
    </section>
  );
}
