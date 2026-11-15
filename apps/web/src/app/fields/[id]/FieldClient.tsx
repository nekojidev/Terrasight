"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Button,
  Chip,
  ConfirmDialog,
  FieldThumb,
  InfoHint,
  Menu,
  ProgressBar,
  Skeleton,
  Surface,
  Tabs,
} from "@terrasight/ui";
import { Archive, CalendarRange, Check, ChevronRight, Droplet, Info, NotebookPen, ShieldCheck, Sun } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { useState } from "react";
import { api } from "@/lib/api";
import { useWorkspaceEvents } from "@/lib/events";
import { useActionToast } from "@/lib/useActionToast";
import { useFormat } from "@/lib/useFormat";
import { QueryState } from "@/components/QueryState";
import { FieldAssistant } from "@/components/FieldAssistant";
import { YieldCard } from "./YieldCard";
import { OutlookCard } from "./OutlookCard";
import { SeasonPlanner } from "./SeasonPlanner";
import { SeasonHistory } from "./SeasonHistory";
import { GatherFocus, ICON as TASK_ICON, isFirstBuild } from "./GatherFocus";
import { FieldBrief, NextDays, RisksCard, StatusChips, type Risk } from "./Overview";
import { fieldFormatOptions } from "./fieldFormat";
import { cropLabel, type GatherStatus, type History } from "./fieldTypes";
import { LandSuitabilityCard, type LandView } from "@/components/LandSuitability";

export interface FieldView {
  id: string;
  name: string;
  areaHa: number;
  countyName: string | null;
  /** ISO country code of the field; units, dates and numbers follow it. */
  country?: string | null;
  tier: "A" | "B" | "C";
  irrigation: "irrigated" | "dryland" | "unknown";
  irrigationSource: string;
  thumb?: string | null;
  /** Land suitability (can the field be cropped at all?): null until the history is built. */
  suitability?: LandView | null;
}

type TabId = "overview" | "season" | "plan" | "data";

/** The data sources actually behind a field's page, from the history. */
function historySources(history: History): string[] {
  const out: string[] = [];
  if (history.seasons.some((s) => s.source === "cdl" && !s.isOverride)) out.push("USDA CDL");
  if (history.seasons.some((s) => s.source === "ndvi" && !s.isOverride)) out.push("MODIS NDVI");
  if ((history.seasonStats ?? []).length > 0) out.push("NASA POWER");
  return out;
}

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
  const { fail } = useActionToast();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const qc = useQueryClient();
  const [confirmArchive, setConfirmArchive] = useState(false);
  const archive = useMutation({
    mutationFn: () => api(base, { method: "DELETE" }),
    onSuccess: () => {
      setConfirmArchive(false);
      void qc.invalidateQueries({ queryKey: ["fields", workspaceId] });
      router.push("/fields");
      router.refresh();
    },
    onError: (e) => {
      setConfirmArchive(false);
      fail(e, f("archiveWhat"), () => archive.mutate());
    },
  });
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
    queryFn: () =>
      api<{ season: number; crop: { value: string | null } }>(`${base}/season-records/current`),
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

  const country = field.data.country ?? initial.country ?? null;
  const fmt = useFormat(fieldFormatOptions(country, units));
  const cropName = (c: string) => (history.data ? cropLabel(history.data.cropNames, locale, c) : "—");
  const lastSeason = history.data ? [...history.data.seasons].sort((a, b) => b.season - a.season)[0] : undefined;
  const currentCrop = record.data?.crop.value ?? lastSeason?.mainCrop ?? null;
  const plan = rotations.data
    ? {
        season: rotations.data.season,
        crop: mine?.plan?.crop ?? mine?.recommendation?.firstCrop ?? null,
        agreed: Boolean(mine?.plan),
      }
    : null;
  const suitability = field.data.suitability ?? null;
  const landLimited = suitability?.status === "limited" || suitability?.status === "unsuitable";
  const attention = (risks.data ?? []).filter((r) => r.level === "high" || r.level === "moderate").length;

  const tabParam = params.get("tab");
  const tab: TabId = tabParam === "season" || tabParam === "data" ? tabParam : "overview";
  const onTab = (next: string) => {
    if (next === "plan") {
      router.push(`/fields/${id}/rotation`);
      return;
    }
    router.replace(next === "overview" ? pathname : `${pathname}?tab=${next}`, { scroll: false });
  };
  const tabs = [
    { id: "overview", label: f("tabOverview") },
    { id: "season", label: f("tabSeason") },
    { id: "plan", label: f("tabPlan") },
    { id: "data", label: f("tabData") },
  ];

  const meta = [
    fmt.area(initial.areaHa),
    currentCrop && history.data ? cropName(currentCrop) : null,
    field.data.countyName,
  ]
    .filter(Boolean)
    .join(" · ");

  const retrySource = (source: string) =>
    void api(`${base}/gather/sources/${source}/retry`, { method: "POST" })
      .then(() => gather.refetch())
      .catch((e) => fail(e, f("gf_retryWhat"), () => retrySource(source)));

  const loadingHistory = (
    <QueryState query={history} skeletonVariant="card" what={t("historyTitle")}>
      {() => null}
    </QueryState>
  );

  return (
    <div className="flex min-w-0 flex-col gap-6">
      <header className="flex flex-col gap-2">
        <div className="flex items-center gap-4">
          <FieldThumb
            name={field.data.name}
            outline={field.data.thumb ?? null}
            crop={lastSeason?.mainCrop ?? null}
            size={64}
          />
          <h1 className="min-w-0 flex-1 text-h1 text-ink">{field.data.name}</h1>
          {canEdit && (
            <Menu
              label={f("more")}
              items={[
                {
                  id: "archive",
                  label: t("archiveField"),
                  icon: <Archive />,
                  danger: true,
                  onSelect: () => setConfirmArchive(true),
                },
              ]}
            />
          )}
        </div>
        <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-body text-ink-2">
          {meta}
          <Chip tone={initial.tier === "A" ? "ok" : initial.tier === "B" ? "info" : "week"} icon={<ShieldCheck />}>
            {f(`tier_${initial.tier}`)}
          </Chip>
          <InfoHint label={t("hintLabel")}>{t(`hintTier_${initial.tier}` as "hintTier_A")}</InfoHint>
        </p>
      </header>
      <ConfirmDialog
        open={confirmArchive}
        title={t("archiveTitle", { name: field.data.name })}
        confirmLabel={t("archiveConfirm")}
        cancelLabel={t("cancel")}
        busy={archive.isPending}
        onConfirm={() => archive.mutate()}
        onCancel={() => setConfirmArchive(false)}
      >
        {t("archiveBody")}
      </ConfirmDialog>

      <Tabs items={tabs} value={tab} onChange={onTab} label={f("tabs")} />

      <GatherFocus
        status={gather.data}
        building={building}
        fieldName={field.data.name}
        outline={field.data.thumb ?? null}
        canEdit={canEdit}
        onRetry={retrySource}
      />

      <div role="tabpanel" aria-label={tabs.find((x) => x.id === tab)?.label} className="flex min-w-0 flex-col gap-6">
        {building ? (
          <>
            <Skeleton variant="card" label={t("loading")} />
            <Skeleton variant="rows" rows={3} label={t("loading")} />
            <Skeleton variant="card" label={t("loading")} />
          </>
        ) : tab === "overview" ? (
          <>
            {history.data ? (
              <FieldBrief
                fieldId={id}
                risks={risks.data ?? []}
                seasons={history.data.seasons}
                cropName={cropName}
                sources={historySources(history.data)}
                country={country}
                units={units}
              />
            ) : (
              loadingHistory
            )}
            <StatusChips
              crop={currentCrop && history.data ? cropName(currentCrop) : null}
              plan={plan && plan.crop && history.data ? { ...plan, crop: cropName(plan.crop) } : null}
              irrigation={field.data.irrigation}
              land={suitability ? { status: suitability.status, overridden: Boolean(suitability.override) } : null}
              attention={attention}
              country={country}
              units={units}
            />
            {landLimited && (
              <LandSuitabilityCard
                workspaceId={workspaceId}
                fieldId={id}
                suitability={suitability}
                canEdit={canEdit}
                country={country}
              />
            )}
            <QueryState query={risks} skeletonVariant="rows" what={f("risks_t")}>
              {(r) => <RisksCard risks={r} />}
            </QueryState>
            <NextDays workspaceId={workspaceId} fieldId={id} units={units} country={country} />
            {history.data && (
              <SeasonHistory history={history.data} fieldId={id} units={units} country={country} compact />
            )}
            {canEdit && <FieldAssistant workspaceId={workspaceId} fieldId={id} fieldName={field.data.name} />}
          </>
        ) : tab === "season" ? (
          <>
            {history.data ? (
              <>
                <SeasonPlanner
                  base={base}
                  canEdit={canEdit}
                  history={{ ...history.data, suitability }}
                  workspaceId={workspaceId}
                  fieldId={id}
                  country={country}
                  units={units}
                />
                <IrrigationCard
                  history={history.data}
                  field={field.data}
                  base={base}
                  canEdit={canEdit}
                  workspaceId={workspaceId}
                />
              </>
            ) : (
              loadingHistory
            )}
          </>
        ) : (
          <>
            <YieldCard workspaceId={workspaceId} fieldId={id} units={units} country={country} />
            <OutlookCard workspaceId={workspaceId} fieldId={id} units={units} country={country} />
            {history.data ? (
              <SeasonHistory history={history.data} fieldId={id} units={units} country={country} />
            ) : (
              loadingHistory
            )}
            {gather.data && (
              <GatherPanel
                status={gather.data}
                canEdit={canEdit}
                country={country}
                units={units}
                onRetry={retrySource}
              />
            )}
            <LandSuitabilityCard
              workspaceId={workspaceId}
              fieldId={id}
              suitability={suitability}
              canEdit={canEdit}
              country={country}
            />
            <Surface as="section" aria-labelledby="more-title">
              <h2 id="more-title" className="text-h2 text-ink">
                {f("dataLinksTitle")}
              </h2>
              <ul className="mt-2 flex flex-col divide-y divide-line">
                {[
                  { href: `/fields/${id}/zones`, label: t("tabZones"), desc: f("zonesDesc"), icon: <CalendarRange /> },
                  { href: `/fields/${id}/log`, label: t("tabLog"), desc: f("logDesc"), icon: <NotebookPen /> },
                ].map((l) => (
                  <li key={l.href}>
                    <Link href={l.href} className="focus-ring flex min-h-tap items-center gap-3 py-3 hover:bg-muted">
                      <span
                        aria-hidden
                        className="inline-flex size-10 shrink-0 items-center justify-center rounded-full bg-muted text-ink-2 [&>svg]:size-5 [&>svg]:stroke-[1.7]"
                      >
                        {l.icon}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block text-body font-semibold text-ink">{l.label}</span>
                        <span className="block text-caption text-ink-2">{l.desc}</span>
                      </span>
                      <ChevronRight aria-hidden className="size-4 text-ink-3" />
                    </Link>
                  </li>
                ))}
              </ul>
            </Surface>
          </>
        )}
      </div>
    </div>
  );
}

/** Per-source status of the history build (S-02.04, RFC §5.3): icon and word, data date, reason and Retry. */
function GatherPanel({
  status,
  canEdit,
  country,
  units,
  onRetry,
}: {
  status: GatherStatus;
  canEdit: boolean;
  country: string | null;
  units: "metric" | "imperial";
  onRetry: (source: string) => void;
}) {
  const t = useTranslations("App");
  const fmt = useFormat(fieldFormatOptions(country, units));
  const finished = status.sources.filter((s) => !["queued", "running"].includes(s.status)).length;
  const problems = status.sources.some((s) => s.status === "failed" || s.status === "partial");
  const title = status.status === "running" ? t("gatherTitle") : problems ? t("gatherPartial") : t("gatherDone");
  const dateOf = (d: string) => (/^\d{4}-\d{2}-\d{2}/.test(d) ? fmt.date(`${d.slice(0, 10)}T00:00:00Z`, "full", { timeZone: "UTC" }) : d);
  return (
    <Surface as="section" aria-busy={status.status === "running"}>
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="text-h2 text-ink">{title}</h2>
        <span className="font-mono text-caption text-ink-2">
          {fmt.number(finished)}/{fmt.number(status.sources.length)}
        </span>
      </div>
      <ProgressBar
        className="mb-4"
        label={title}
        value={finished}
        max={Math.max(1, status.sources.length)}
        tone={problems ? "week" : "ink"}
      />
      <ul className="flex flex-col divide-y divide-line">
        {status.sources.map((s) => (
          <li key={s.source} className="flex min-h-tap items-center gap-3 py-2">
            {TASK_ICON[s.status]}
            <span className="flex-1">
              <span className="block text-body text-ink">{s.label}</span>
              {s.reason && <span className="block text-caption text-ink-2">{s.reason}</span>}
            </span>
            <span className="text-right text-caption text-ink-2">
              <span className="block font-semibold">{t(`st_${s.status}`)}</span>
              {s.dataDate && <span className="block">{dateOf(s.dataDate)}</span>}
            </span>
            {canEdit && (s.status === "failed" || s.status === "partial") && (
              <Button size={44} variant="outline" onClick={() => onRetry(s.source)}>
                {t("retry")}
              </Button>
            )}
          </li>
        ))}
      </ul>
    </Surface>
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
  const f = useTranslations("Field");
  const fmt = useFormat();
  const client = useQueryClient();
  const { fail } = useActionToast();
  const [open, setOpen] = useState(false);
  const [info, setInfo] = useState(false);
  const set = useMutation({
    mutationFn: (irrigation: "irrigated" | "dryland") => api(base, { method: "PATCH", body: { irrigation } }),
    onError: (e, irrigation) => fail(e, f("irrWhat"), () => set.mutate(irrigation)),
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
      : t("irrRowDetected", { value, confidence: fmt.number(Math.round(d.confidence * 100)) });
  return (
    <Surface as="section" pad="sm">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <h2 className="text-body font-semibold text-ink">{t("irrigationTitle")}</h2>
        <p className="min-w-0 flex-1 text-body text-ink-2">{summary}</p>
        <Button
          variant="icon"
          label={t("irrInfoLabel")}
          icon={<Info />}
          aria-expanded={info}
          onClick={() => setInfo(!info)}
        />
        {canEdit && (
          <Button variant="outline" onClick={() => setOpen(!open)} aria-expanded={open}>
            {t("irrChange")}
          </Button>
        )}
      </div>
      {info && <p className="animate-fade mt-2 text-caption text-ink-2">{t("irrInfo")}</p>}
      {canEdit && open && (
        <div className="animate-fade mt-3 flex flex-wrap gap-2">
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
    </Surface>
  );
}
