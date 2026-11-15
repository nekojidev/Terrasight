"use client";

import { useQuery } from "@tanstack/react-query";
import { Button, Chip, Kicker, Surface, type ChipTone } from "@terrasight/ui";
import {
  AlertTriangle,
  Bug,
  Check,
  ChevronRight,
  CloudRain,
  HelpCircle,
  Leaf,
  CalendarDays,
  Microscope,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
  Snowflake,
  Sparkles,
  Sprout,
  Sun,
  TriangleAlert,
  X,
  Droplet,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { useState } from "react";
import { AiMark } from "@/components/AiMark";
import { useAssistantBus } from "@/components/AssistantBus";
import { QueryState } from "@/components/QueryState";
import { StatusMark } from "@/components/TodayWindows";
import type { LandStatus } from "@/components/LandSuitability";
import { api } from "@/lib/api";
import { useFormat } from "@/lib/useFormat";
import { OPERATIONS, workWindowsKey, type WindowStatus, type WorkWindowsView } from "@/lib/work-windows";
import { fieldFormatOptions } from "./fieldFormat";

type Localised = { en: string; uk: string };
interface Risk {
  id: string;
  type?: string;
  level: "high" | "moderate" | "low" | "none" | "unknown";
  status: string;
  deadline: string | null;
  planning: boolean;
  keyNumbers: Array<{ id: string; value: number | string; unit?: string; weight: number }>;
  text: { title: Localised; action: Localised };
  textSource?: "ai" | "template" | "edited";
  aiSuggested?: boolean;
}
interface Weather {
  days: Array<{
    date: string;
    tminC: number | null;
    tmaxC: number | null;
    precipMm: number | null;
    uncertain: boolean;
  }>;
  origin: "live" | "cache" | "stale" | null;
  attribution: string | null;
  ageHours: number | null;
}
interface Season {
  season: number;
  mainCrop: string;
  secondCrop: string | null;
}

const LEVEL_TONE = {
  high: "text-urgent",
  moderate: "text-week",
  low: "text-ok",
  none: "text-ok",
  unknown: "text-ink-2",
} as const;
const BARS = { high: 3, moderate: 2, low: 1, none: 0, unknown: 0 } as const;
const LEVEL_ORDER = { high: 0, moderate: 1, low: 2, none: 3, unknown: 4 } as const;

/**
 * Section tabs of the field page as links, for the sub-pages (Work log, Zones, Rotation) that sit under a field.
 * `active` keeps its old meaning: 0 overview, 1 work log, 2 rotation, 3 zones; the log and zones belong to "Data & history".
 */
export function FieldTabs({ fieldId, active = 0 }: { fieldId: string; active?: 0 | 1 | 2 | 3 }) {
  const r = useTranslations("Field");
  const current = active === 0 ? 0 : active === 2 ? 2 : 3;
  const tabs = [
    { label: r("tabOverview"), href: `/fields/${fieldId}` },
    { label: r("tabSeason"), href: `/fields/${fieldId}?tab=season` },
    { label: r("tabPlan"), href: `/fields/${fieldId}/rotation` },
    { label: r("tabData"), href: `/fields/${fieldId}?tab=data` },
  ];
  return (
    <nav aria-label={r("tabs")} className="flex max-w-full gap-1 overflow-x-auto border-b border-line [scrollbar-width:none]">
      {tabs.map((tab, i) => (
        <Link
          key={tab.href}
          href={tab.href}
          aria-current={i === current ? "page" : undefined}
          className={`focus-ring -mb-px inline-flex min-h-tap shrink-0 items-center border-b-2 px-4 text-body font-semibold whitespace-nowrap ${i === current ? "border-ink text-ink" : "border-transparent text-ink-2 hover:text-ink"}`}
        >
          {tab.label}
        </Link>
      ))}
    </nav>
  );
}

/**
 * "The main thing on this field" (S-04.07): the top risk and numbers that need no degree days, with the sources the
 * numbers come from. The rotation numbers arrive with the scenario engine (S-06.03).
 */
export function FieldBrief({
  fieldId,
  risks,
  seasons,
  cropName,
  sources,
  country,
  units,
}: {
  fieldId: string;
  risks: Risk[];
  seasons: Season[];
  cropName: (id: string) => string;
  /** Names of the data sources actually behind the page (from the field's history). */
  sources: string[];
  country?: string | null;
  units: "metric" | "imperial";
}) {
  const t = useTranslations("App");
  const r = useTranslations("Field");
  const locale = useLocale() as "en" | "uk";
  const fmt = useFormat(fieldFormatOptions(country, units));
  const rotation = risks.find((x) => x.type === "rotation");
  const top =
    risks.find((x) => x.type !== "rotation" && (x.level === "high" || x.level === "moderate")) ??
    (rotation?.level === "moderate" ? rotation : undefined);
  const router = useRouter();
  // The assistant panel listens on the bus; with no panel (or a conversation already open) open the recommendation.
  const bus = useAssistantBus();
  const ask = () => {
    const question = top ? t("bfWhyQ", { title: top.text.title[locale] }) : t("faSugg1");
    if (!bus.ask(question) && top) router.push(`/recommendations/${top.id}`);
  };
  const sorted = [...seasons].sort((a, b) => b.season - a.season);
  const last = sorted[0];
  let inRow = 0;
  if (last)
    for (const s of sorted) if (s.mainCrop === last.mainCrop && s.season === last.season - inRow) inRow += 1;
  const num = (k: { id: string; value: number | string }) =>
    typeof k.value === "number"
      ? k.id === "marginVsCurrent"
        ? `${k.value >= 0 ? "+" : "−"}${fmt.money(Math.abs(k.value), "USD")}`
        : fmt.number(k.value)
      : k.value;
  return (
    <Surface tone="hero" pad="lg" className="flex flex-col gap-5">
      <Kicker>{r("bf_k")}</Kicker>
      <h2 className="text-h1 text-ink">{top ? top.text.title[locale] : t("fieldAllFine")}</h2>
      <div className="grid gap-4 sm:grid-cols-3 sm:gap-6">
        {rotation &&
          rotation.keyNumbers.slice(0, 3).map((k) => (
            <div key={k.id} className="border-t-2 border-ink pt-3">
              <p className="font-mono text-big-number text-ink">{num(k)}</p>
              <p className="text-caption text-ink-2">{t.has(`kn_${k.id}`) ? t(`kn_${k.id}`) : "—"}</p>
            </div>
          ))}
        {!rotation && last && (
          <div className="border-t-2 border-ink pt-3">
            <p className="font-mono text-big-number text-ink">{fmt.number(inRow)}</p>
            <p className="text-caption text-ink-2">
              {t("fieldInRow", {
                crop: cropName(last.mainCrop),
                from: last.season - inRow + 1,
                to: last.season,
              })}
            </p>
          </div>
        )}
        {!rotation &&
          top?.keyNumbers.slice(0, 2).map((k) => (
            <div key={k.id} className="border-t-2 border-ink pt-3">
              <p className="font-mono text-big-number text-ink">{num(k)}</p>
              <p className="text-caption text-ink-2">{t.has(`kn_${k.id}`) ? t(`kn_${k.id}`) : "—"}</p>
            </div>
          ))}
      </div>
      {top && <p className="text-body text-ink">{top.text.action[locale]}</p>}
      {sources.length > 0 && <p className="text-caption text-ink-2">{r("sourcesLine", { sources: sources.join(", ") })}</p>}
      <div className="flex flex-wrap items-center gap-3">
        <Link
          href={`/fields/${fieldId}/rotation`}
          className="focus-ring inline-flex h-11 min-h-tap items-center gap-2 rounded-btn bg-ink px-4 text-body font-semibold text-surface hover:opacity-90"
        >
          <RefreshCw aria-hidden className="size-5" strokeWidth={1.7} />
          {r("bf_cta")}
        </Link>
        <Button variant="outline" icon={<Sparkles />} onClick={ask}>
          {r("bf_ask")}
        </Button>
      </div>
    </Surface>
  );
}

/** Status chips: crop, plan, irrigation, land suitability and how many risks need attention. Words and icons, not colour. */
export function StatusChips({
  crop,
  plan,
  irrigation,
  land,
  attention,
  country,
  units,
}: {
  crop: string | null;
  plan: { season: number; crop: string | null; agreed: boolean } | null;
  irrigation: "irrigated" | "dryland" | "unknown";
  land: { status: LandStatus; overridden: boolean } | null;
  attention: number;
  country?: string | null;
  units: "metric" | "imperial";
}) {
  const t = useTranslations("App");
  const r = useTranslations("Field");
  const fmt = useFormat(fieldFormatOptions(country, units));
  const landTone: ChipTone = land
    ? land.status === "suitable"
      ? "ok"
      : land.status === "unknown"
        ? "neutral"
        : land.status === "limited" || land.overridden
          ? "week"
          : "urgent"
    : "neutral";
  const landWord = land
    ? land.status === "unsuitable" && land.overridden
      ? t("landChip_overridden")
      : t(`landStatus_${land.status}`)
    : null;
  return (
    <ul aria-label={r("statusLabel")} className="flex flex-wrap gap-2">
      {crop && (
        <li>
          <Chip tone="neutral" icon={<Leaf />}>
            {r("chipCrop", { crop })}
          </Chip>
        </li>
      )}
      {plan?.crop && (
        <li>
          <Chip tone={plan.agreed ? "ok" : "info"} icon={<Sprout />}>
            {r("chipPlan", { season: plan.season, crop: plan.crop })} · {plan.agreed ? t("fcAgreed") : t("fcNotAgreed")}
          </Chip>
        </li>
      )}
      {irrigation !== "unknown" && (
        <li>
          <Chip tone="info" icon={<Droplet />}>
            {t(irrigation)}
          </Chip>
        </li>
      )}
      {land && landWord && (
        <li>
          <Chip
            tone={landTone}
            icon={
              land.status === "suitable" ? (
                <ShieldCheck />
              ) : land.status === "limited" ? (
                <TriangleAlert />
              ) : land.status === "unknown" ? (
                <HelpCircle />
              ) : (
                <ShieldAlert />
              )
            }
          >
            {landWord}
          </Chip>
        </li>
      )}
      <li>
        {attention > 0 ? (
          <Chip tone="week" icon={<AlertTriangle />}>
            {fmt.plural(attention, {
              one: r.raw("chipRisks_one") as string,
              few: r.raw("chipRisks_few") as string,
              many: r.raw("chipRisks_many") as string,
              other: r.raw("chipRisks_other") as string,
            })}
          </Chip>
        ) : (
          <Chip tone="ok" icon={<Check />}>
            {r("chipRisks0")}
          </Chip>
        )}
      </li>
    </ul>
  );
}

/** Top 3 risks as links to their recommendations; "Show all N" reveals the rest in place. */
export function RisksCard({ risks }: { risks: Risk[] }) {
  const r = useTranslations("Field");
  const t = useTranslations("App");
  const locale = useLocale() as "en" | "uk";
  const [all, setAll] = useState(false);
  const sorted = [...risks].sort((a, b) => LEVEL_ORDER[a.level] - LEVEL_ORDER[b.level]);
  const shown = all ? sorted : sorted.slice(0, 3);
  return (
    <Surface as="section" aria-labelledby="risks-title">
      <h2 id="risks-title" className="text-h2 text-ink">
        {r("risks_t")}
      </h2>
      {risks.length === 0 ? (
        <p className="mt-2 text-caption text-ink-2">{t("fieldNoRisks")}</p>
      ) : (
        <>
          <ul className="mt-2 flex flex-col divide-y divide-line">
            {shown.map((x) => (
              <li key={x.id}>
                <Link
                  href={`/recommendations/${x.id}`}
                  className="focus-ring flex min-h-tap items-center gap-3 py-3 hover:bg-muted"
                >
                  <span
                    aria-hidden
                    className={`inline-flex size-10 shrink-0 items-center justify-center rounded-full ${x.level === "high" ? "bg-urgent-soft text-urgent" : x.level === "moderate" ? "bg-week-soft text-week" : "bg-muted text-ink-2"} [&>svg]:size-5 [&>svg]:stroke-[1.7]`}
                  >
                    {x.type === "rotation" ? <RefreshCw /> : x.type === "disease" ? <Microscope /> : <Bug />}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-body font-semibold text-ink">
                      {x.text.title[locale]}
                      {x.textSource === "ai" && <AiMark />}
                    </span>
                    <span className="line-clamp-2 block text-caption text-ink-2">
                      {x.aiSuggested ? `${t("aiWatchChip")} · ` : ""}
                      {x.text.action[locale]}
                    </span>
                  </span>
                  <span aria-hidden className="flex items-end gap-0.5">
                    {[1, 2, 3].map((n) => (
                      <span
                        key={n}
                        className={`block w-1.5 rounded-[2px] ${n <= BARS[x.level] ? "bg-current" : "bg-line"} ${LEVEL_TONE[x.level]}`}
                        style={{ height: 6 + n * 4 }}
                      />
                    ))}
                  </span>
                  <span className="w-20 text-caption font-semibold text-ink">{t(`recLevel_${x.level}`)}</span>
                  <ChevronRight aria-hidden className="size-4 text-ink-3" />
                </Link>
              </li>
            ))}
          </ul>
          {risks.length > 3 && (
            <Button variant="link" className="mt-2 min-h-tap" aria-expanded={all} onClick={() => setAll((v) => !v)}>
              {all ? r("risksLess") : r("risksAll", { n: risks.length })}
            </Button>
          )}
        </>
      )}
    </Surface>
  );
}

const STATUS_RANK: Record<WindowStatus, number> = { good: 3, marginal: 2, no: 1, unknown: 0 };

/** Icon and word for one day's field-work status. */
function DayWork({ status }: { status: WindowStatus | null }) {
  const t = useTranslations("App");
  const r = useTranslations("Field");
  if (!status) return <span className="text-caption text-ink-3">—</span>;
  const Icon = status === "good" ? Check : status === "marginal" ? AlertTriangle : status === "unknown" ? HelpCircle : X;
  const tone =
    status === "good" ? "text-ok" : status === "marginal" ? "text-week" : status === "no" ? "text-urgent" : "text-ink-2";
  return (
    <span
      title={r("workDay", { status: t(`wwSt_${status}`) })}
      className={`inline-flex items-center gap-1 text-caption font-semibold ${tone}`}
    >
      <Icon aria-hidden className="size-4" strokeWidth={2} />
      {t(`wwSt_${status}`)}
    </span>
  );
}

/** "Next 7 days": the forecast and the field-work windows in one strip, plus today's window per operation. */
export function NextDays({
  workspaceId,
  fieldId,
  units,
  country,
}: {
  workspaceId: string;
  fieldId: string;
  units: "metric" | "imperial";
  country?: string | null;
}) {
  const r = useTranslations("Field");
  const t = useTranslations("App");
  const fmt = useFormat(fieldFormatOptions(country, units));
  const w = useQuery({
    queryKey: ["field", workspaceId, fieldId, "weather"],
    queryFn: () => api<Weather>(`/api/w/${workspaceId}/fields/${fieldId}/weather`),
  });
  const ww = useQuery({
    queryKey: workWindowsKey(workspaceId, fieldId),
    queryFn: () => api<WorkWindowsView>(`/api/w/${workspaceId}/fields/${fieldId}/work-windows?days=7`),
    staleTime: 10 * 60_000,
  });
  const days = w.data?.days.slice(0, 7) ?? [];
  const ops = (ww.data?.fields ?? []).filter((f) => f.available).flatMap((f) => f.operations).filter((o) => o.applicable);
  const bestOn = (date: string): WindowStatus | null => {
    let best: WindowStatus | null = null;
    for (const o of ops) {
      const d = o.days.find((x) => x.date === date);
      if (d && (best === null || STATUS_RANK[d.status] > STATUS_RANK[best])) best = d.status;
    }
    return best;
  };
  const today = OPERATIONS.flatMap((op) => {
    const d = ops.find((o) => o.operation === op)?.days[0];
    return d ? [{ op, status: d.status }] : [];
  });
  return (
    <Surface as="section" aria-labelledby="next7-title">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="next7-title" className="text-h2 text-ink">
          {r("next7")}
        </h2>
        {w.data?.attribution && (
          <span className="text-caption text-ink-2">
            {w.data.attribution}
            {w.data.origin === "stale" && w.data.ageHours !== null
              ? ` · ${t("forecastAge", { h: fmt.number(w.data.ageHours) })}`
              : ""}
          </span>
        )}
      </div>
      <QueryState query={w} skeletonVariant="card" what={r("next7")}>
        {() =>
          days.length === 0 ? (
            <p className="mt-2 text-caption text-ink-2">{t("noForecast")}</p>
          ) : (
            <>
              <p className="mt-1 text-caption text-ink-2">{r("next7Hint")}</p>
              <ol className="mt-3 flex snap-x gap-2 overflow-x-auto pb-1 [scrollbar-width:none] sm:grid sm:grid-cols-7">
                {days.map((d, i) => {
                  const frost = d.tminC !== null && d.tminC <= 0;
                  const wet = (d.precipMm ?? 0) >= 1;
                  return (
                    <li
                      key={d.date}
                      className={`flex w-24 shrink-0 snap-start flex-col items-center gap-1 rounded-input p-2 text-center sm:w-auto ${frost ? "bg-info-soft ring-1 ring-info" : "bg-surface-2"}`}
                    >
                      <span className="text-caption font-semibold text-ink-2">
                        {i === 0 ? r("today") : fmt.date(d.date, "dayMonth", { timeZone: "UTC" })}
                      </span>
                      <span aria-hidden className="flex justify-center">
                        {frost ? (
                          <Snowflake className="size-5 text-info" />
                        ) : wet ? (
                          <CloudRain className="size-5 text-info" />
                        ) : (
                          <Sun className="size-5 text-week" />
                        )}
                      </span>
                      {frost && <span className="sr-only">{t("frostDay")}</span>}
                      <span className="font-mono text-body text-ink">{d.tmaxC === null ? "—" : fmt.temp(d.tmaxC)}</span>
                      <span className="font-mono text-caption text-ink-2">
                        {d.tminC === null ? "—" : fmt.temp(d.tminC)}
                      </span>
                      <DayWork status={bestOn(d.date)} />
                    </li>
                  );
                })}
              </ol>
            </>
          )
        }
      </QueryState>
      {today.length > 0 && (
        <div className="mt-4 flex flex-col gap-2">
          <Kicker>{r("next7Work")}</Kicker>
          <ul className="flex flex-wrap gap-2">
            {today.map((x) => (
              <li key={x.op} className="flex items-center gap-2 text-caption text-ink">
                {t(`wwOp_${x.op}`)}
                <StatusMark status={x.status} label={t(`wwSt_${x.status}`)} />
              </li>
            ))}
          </ul>
        </div>
      )}
      <Link href="/work-windows" className="focus-ring mt-3 inline-flex min-h-tap items-center gap-1 text-body font-semibold text-ink underline underline-offset-4">
        <CalendarDays aria-hidden className="size-4" strokeWidth={1.7} />
        {t("wwSeeWeek")}
      </Link>
    </Surface>
  );
}

export type { Risk };
