"use client";

import { useQuery } from "@tanstack/react-query";
import { Chip } from "@terrasight/ui";
import { Bug, ChevronRight, CloudRain, Microscope, RefreshCw, Snowflake, Sparkles, Sun } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { AiMark } from "@/components/AiMark";
import { api } from "@/lib/api";

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

/** Tabs of the field page (design 08). Overview, Work log, Rotation, Owner report. */
export function FieldTabs({ fieldId, active = 0 }: { fieldId: string; active?: 0 | 1 | 2 }) {
  const r = useTranslations("Field");
  const t = useTranslations("App");
  const tabs: Array<{ label: string; href: string | null }> = [
    { label: r("tab1"), href: `/fields/${fieldId}` },
    { label: t("tabLog"), href: `/fields/${fieldId}/log` },
    { label: r("tab3"), href: `/fields/${fieldId}/rotation` },
    { label: t("navDecisions"), href: `/decisions?field=${fieldId}` },
  ];
  return (
    <nav aria-label={r("tabs")} className="flex w-fit max-w-full gap-1 overflow-x-auto rounded-input bg-muted p-1">
      {tabs.map((tab, i) =>
        tab.href ? (
          <Link
            key={tab.label}
            href={tab.href}
            aria-current={i === active ? "page" : undefined}
            className={`focus-ring whitespace-nowrap rounded-btn px-3 py-2 text-body font-semibold sm:px-4 ${i === active ? "bg-ink text-surface" : "text-ink hover:bg-surface"}`}
          >
            {tab.label}
          </Link>
        ) : (
          <span
            key={tab.label}
            aria-disabled
            className="whitespace-nowrap rounded-btn px-3 py-2 text-body font-semibold text-ink-3 sm:px-4"
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
  // The rotation item carries the field brief's three numbers (S-04.07, Tech Design §9.2).
  const rotation = risks.find((x) => x.type === "rotation");
  const top =
    risks.find((x) => x.type !== "rotation" && (x.level === "high" || x.level === "moderate")) ??
    (rotation?.level === "moderate" ? rotation : undefined);
  const router = useRouter();
  // The assistant panel is a sibling component: fill its question box and send, or open the recommendation.
  const ask = () => {
    const input = document.querySelector<HTMLInputElement>("aside input[type=text], aside input:not([type])");
    if (!input) {
      if (top) router.push(`/recommendations/${top.id}`);
      return;
    }
    input.scrollIntoView({ behavior: "smooth", block: "center" });
    input.focus({ preventScroll: true });
    if (input.value !== "" || input.disabled) return;
    const question = top ? t("bfWhyQ", { title: top.text.title[locale] }) : t("faSugg1");
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(input, question);
    input.dispatchEvent(new Event("input", { bubbles: true }));
    setTimeout(() => input.form?.requestSubmit(), 0);
  };
  const sorted = [...seasons].sort((a, b) => b.season - a.season);
  const last = sorted[0];
  let inRow = 0;
  if (last)
    for (const s of sorted) if (s.mainCrop === last.mainCrop && s.season === last.season - inRow) inRow += 1;
  return (
    <section className="flex flex-col gap-5 rounded-hero bg-surface p-5 shadow-hero sm:p-7">
      <Chip tone="signal">{r("bf_k")}</Chip>
      <h2 className="text-h1 text-ink">{top ? top.text.title[locale] : t("fieldAllFine")}</h2>
      <div className="grid gap-4 sm:grid-cols-3 sm:gap-6">
        {rotation &&
          rotation.keyNumbers.slice(0, 3).map((k) => (
            <div key={k.id} className="border-t-2 border-ink pt-3">
              <p className="font-mono text-big-number text-ink">
                {typeof k.value === "number" && k.id === "marginVsCurrent"
                  ? `${k.value >= 0 ? "+" : "−"}$${Math.abs(k.value)}`
                  : k.value}
              </p>
              <p className="text-small text-ink-2">{t.has(`kn_${k.id}`) ? t(`kn_${k.id}`) : k.id}</p>
            </div>
          ))}
        {!rotation && last && (
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
        {!rotation &&
          top?.keyNumbers.slice(0, 2).map((k) => (
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
        <button
          type="button"
          onClick={ask}
          className="focus-ring inline-flex min-h-tap items-center gap-2 rounded-btn border border-line-strong bg-surface px-5 text-body font-semibold text-ink hover:bg-muted"
        >
          <Sparkles aria-hidden className="size-4" strokeWidth={1.7} />
          {r("bf_ask")}
        </button>
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
                <span
                  aria-hidden
                  className={`inline-flex size-10 shrink-0 items-center justify-center rounded-full ${x.level === "high" ? "bg-urgent-soft text-urgent" : x.level === "moderate" ? "bg-week-soft text-week" : "bg-muted text-ink-2"} [&>svg]:size-5 [&>svg]:stroke-[1.7]`}
                >
                  {x.type === "rotation" ? <RefreshCw /> : x.type === "disease" ? <Microscope /> : <Bug />}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-body font-semibold text-ink">
                    {x.text.title[locale]}
                    {x.textSource === "ai" && <AiMark />}
                  </span>
                  <span className="block truncate text-small text-ink-2">
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
                <span className={`sr-only text-small font-semibold sm:not-sr-only sm:w-24 ${LEVEL_TONE[x.level]}`}>
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
        <ol className="mt-4 grid grid-cols-7 gap-0.5 text-center sm:gap-1">
          {days.map((d) => {
            const frost = d.tminC !== null && d.tminC <= 0;
            const wet = (d.precipMm ?? 0) >= 1;
            return (
              <li
                key={d.date}
                title={frost ? t("frostDay") : undefined}
                className={`min-w-0 rounded-input p-1 sm:p-2 ${frost ? "bg-info-soft ring-1 ring-info" : ""}`}
              >
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
