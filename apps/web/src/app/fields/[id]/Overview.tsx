"use client";

import { useQuery } from "@tanstack/react-query";
import { Chip } from "@terrasight/ui";
import { ChevronRight, CloudRain, RefreshCw, Snowflake, Sun } from "lucide-react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { api } from "@/lib/api";

type Localised = { en: string; uk: string };
interface Risk {
  id: string;
  level: "high" | "moderate" | "low" | "none" | "unknown";
  status: string;
  deadline: string | null;
  planning: boolean;
  keyNumbers: Array<{ id: string; value: number | string; unit?: string; weight: number }>;
  text: { title: Localised; action: Localised };
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

/** Tabs of the field page (design 08). Only Overview exists until Zones (EP-09 mock), Rotation (EP-06), Report (EP-08). */
export function FieldTabs({ fieldId, active = 0 }: { fieldId: string; active?: 0 | 2 }) {
  const r = useTranslations("Field");
  // Zones (EP-09 mock) and the owner report tab (EP-08) come later.
  const tabs: Array<{ label: string; href: string | null }> = [
    { label: r("tab1"), href: `/fields/${fieldId}` },
    { label: r("tab2"), href: null },
    { label: r("tab3"), href: `/fields/${fieldId}/rotation` },
    { label: r("tab4"), href: null },
  ];
  return (
    <nav aria-label={r("tabs")} className="flex w-fit gap-1 rounded-input bg-muted p-1">
      {tabs.map((tab, i) =>
        tab.href ? (
          <Link
            key={tab.label}
            href={tab.href}
            aria-current={i === active ? "page" : undefined}
            className={`focus-ring rounded-btn px-4 py-2 text-body font-semibold ${i === active ? "bg-ink text-surface" : "text-ink hover:bg-surface"}`}
          >
            {tab.label}
          </Link>
        ) : (
          <span
            key={tab.label}
            aria-disabled
            className="rounded-btn px-4 py-2 text-body font-semibold text-ink-3"
          >
            {tab.label}
          </span>
        ),
      )}
    </nav>
  );
}

/**
 * "The main thing on this field" (S-04.07): the top risk and numbers that need no degree days. The rotation numbers
 * (seasons of corn after corn in the plan, margin of the alfalfa option) arrive with the scenario engine (S-06.03).
 */
export function FieldBrief({
  fieldId,
  risks,
  seasons,
  cropName,
}: {
  fieldId: string;
  risks: Risk[];
  seasons: Season[];
  cropName: (id: string) => string;
}) {
  const t = useTranslations("App");
  const r = useTranslations("Field");
  const locale = useLocale() as "en" | "uk";
  const top = risks.find((x) => x.level === "high" || x.level === "moderate");
  const sorted = [...seasons].sort((a, b) => b.season - a.season);
  const last = sorted[0];
  let inRow = 0;
  if (last)
    for (const s of sorted) if (s.mainCrop === last.mainCrop && s.season === last.season - inRow) inRow += 1;
  return (
    <section className="flex flex-col gap-5 rounded-hero bg-surface p-7 shadow-hero">
      <Chip tone="signal">{r("bf_k")}</Chip>
      <h2 className="text-h1 text-ink">{top ? top.text.title[locale] : t("fieldAllFine")}</h2>
      <div className="grid gap-6 sm:grid-cols-3">
        {last && (
          <div className="border-t-2 border-ink pt-3">
            <p className="font-mono text-big-number text-ink">{inRow}</p>
            <p className="text-small text-ink-2">
              {t("fieldInRow", {
                crop: cropName(last.mainCrop),
                from: last.season - inRow + 1,
                to: last.season,
              })}
            </p>
          </div>
        )}
        {top?.keyNumbers.slice(0, 2).map((k) => (
          <div key={k.id} className="border-t-2 border-ink pt-3">
            <p className="font-mono text-big-number text-ink">{k.value}</p>
            <p className="text-small text-ink-2">{t.has(`kn_${k.id}`) ? t(`kn_${k.id}`) : k.id}</p>
          </div>
        ))}
      </div>
      {top && <p className="text-body text-ink">{top.text.action[locale]}</p>}
      <div className="flex flex-wrap items-center gap-3">
        <Link
          href={`/fields/${fieldId}/rotation`}
          className="focus-ring inline-flex min-h-tap items-center gap-2 rounded-btn bg-ink px-5 text-body font-semibold text-surface"
        >
          <RefreshCw aria-hidden className="size-4" strokeWidth={1.7} />
          {r("bf_cta")}
        </Link>
        {top && (
          <Link
            href={`/recommendations/${top.id}`}
            className="text-body font-semibold text-ink underline underline-offset-4"
          >
            {r("bf_ask")}
          </Link>
        )}
      </div>
    </section>
  );
}

export function RisksCard({ risks }: { risks: Risk[] }) {
  const r = useTranslations("Field");
  const t = useTranslations("App");
  const locale = useLocale() as "en" | "uk";
  return (
    <section className="rounded-card border border-line bg-surface p-5">
      <h2 className="text-h2 text-ink">{r("risks_t")}</h2>
      {risks.length === 0 ? (
        <p className="mt-2 text-small text-ink-2">{t("fieldNoRisks")}</p>
      ) : (
        <ul className="mt-2 flex flex-col divide-y divide-line">
          {risks.map((x) => (
            <li key={x.id}>
              <Link href={`/recommendations/${x.id}`} className="flex items-center gap-3 py-3 hover:bg-muted">
                <span className="flex-1">
                  <span className="block text-body font-semibold text-ink">{x.text.title[locale]}</span>
                  <span className="block text-small text-ink-2">{x.text.action[locale]}</span>
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
                <span className={`w-24 text-small font-semibold ${LEVEL_TONE[x.level]}`}>
                  {t(`recLevel_${x.level}`)}
                </span>
                <ChevronRight aria-hidden className="size-4 text-ink-3" />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export function WeatherCard({
  workspaceId,
  fieldId,
  units,
}: {
  workspaceId: string;
  fieldId: string;
  units: "metric" | "imperial";
}) {
  const r = useTranslations("Field");
  const t = useTranslations("App");
  const locale = useLocale();
  const w = useQuery({
    queryKey: ["field", workspaceId, fieldId, "weather"],
    queryFn: () => api<Weather>(`/api/w/${workspaceId}/fields/${fieldId}/weather`),
  });
  const temp = (c: number | null) =>
    c === null ? "—" : units === "imperial" ? `${Math.round((c * 9) / 5 + 32)}°` : `${Math.round(c)}°`;
  const wd = (iso: string) =>
    new Intl.DateTimeFormat(locale === "uk" ? "uk-UA" : "en-US", {
      timeZone: "UTC",
      weekday: "short",
    }).format(new Date(`${iso}T12:00:00Z`));
  const days = w.data?.days.slice(0, 7) ?? [];
  return (
    <section className="rounded-card border border-line bg-surface p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-h2 text-ink">{r("week")}</h2>
        {w.data?.attribution && (
          <span className="text-small text-ink-2">
            {w.data.attribution}
            {w.data.origin === "stale" && w.data.ageHours !== null
              ? ` · ${t("forecastAge", { h: w.data.ageHours })}`
              : ""}
          </span>
        )}
      </div>
      {days.length === 0 ? (
        <p className="mt-2 text-small text-ink-2">{t("noForecast")}</p>
      ) : (
        <ol className="mt-4 grid grid-cols-7 gap-1 text-center">
          {days.map((d) => {
            const frost = d.tminC !== null && d.tminC <= 0;
            const wet = (d.precipMm ?? 0) >= 1;
            return (
              <li key={d.date} className={`rounded-input p-2 ${frost ? "bg-info-soft" : ""}`}>
                <span className="block text-small text-ink-2">{wd(d.date)}</span>
                <span aria-hidden className="my-1 flex justify-center">
                  {frost ? (
                    <Snowflake className="size-5 text-info" />
                  ) : wet ? (
                    <CloudRain className="size-5 text-info" />
                  ) : (
                    <Sun className="size-5 text-week" />
                  )}
                </span>
                <span className="block font-mono text-body text-ink">{temp(d.tmaxC)}</span>
                <span className="block font-mono text-small text-ink-2">{temp(d.tminC)}</span>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}

export type { Risk };
