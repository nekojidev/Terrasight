"use client";

import { useQuery } from "@tanstack/react-query";
import { InfoHint } from "@terrasight/ui";
import { CloudRain, Snowflake, Sun, Thermometer } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { api } from "@/lib/api";

export interface OutlookTerciles {
  below: number;
  near: number;
  above: number;
}
export interface OutlookMonth {
  month: string;
  precip: OutlookTerciles;
  temp: OutlookTerciles;
}
export interface OutlookSignal {
  kind:
    | "rain_below"
    | "rain_above"
    | "temp_above"
    | "temp_below"
    | "frost_higher"
    | "frost_lower"
    | "heat_higher"
    | "heat_lower";
  month: string;
  probability: number | null;
  climDays: number | null;
  ensDays: number | null;
}
export interface FieldOutlookView {
  outlook: {
    months: OutlookMonth[];
    signals: OutlookSignal[];
    members: number;
    issuedAt: string;
    climatology: { from: number; to: number };
  } | null;
  problem: string | null;
}

/** "2027-01" → "January" / "січень" (nominative: the strings never decline the month). */
export function monthName(month: string, locale: string): string {
  const [y, m] = month.split("-").map(Number) as [number, number];
  const name = new Intl.DateTimeFormat(locale === "uk" ? "uk-UA" : "en-US", {
    month: "long",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(y, m - 1, 1)));
  return name.charAt(0).toUpperCase() + name.slice(1);
}

const pct = (p: number) => `${Math.round(p * 100)}%`;

/** One stacked bar: share of ensemble members below / near / above normal. Colour is never the only cue: % labels. */
function TercileBar({
  p,
  colours,
  label,
}: {
  p: OutlookTerciles;
  colours: [string, string, string];
  label: string;
}) {
  const parts = [p.below, p.near, p.above];
  return (
    <div role="img" aria-label={label}>
      <div className="flex h-3 overflow-hidden rounded-full bg-muted">
        {parts.map((v, i) => (
          <div key={i} className={colours[i]} style={{ width: `${v * 100}%` }} />
        ))}
      </div>
      <div className="mt-1 flex justify-between font-mono text-micro text-ink-2">
        <span>{pct(p.below)}</span>
        <span>{pct(p.near)}</span>
        <span>{pct(p.above)}</span>
      </div>
    </div>
  );
}

const ICON = {
  rain_below: CloudRain,
  rain_above: CloudRain,
  temp_above: Thermometer,
  temp_below: Thermometer,
  frost_higher: Snowflake,
  frost_lower: Snowflake,
  heat_higher: Sun,
  heat_lower: Sun,
} as const;

export function OutlookCard({
  workspaceId,
  fieldId,
  units,
}: {
  workspaceId: string;
  fieldId: string;
  units: "metric" | "imperial";
}) {
  const t = useTranslations("App");
  const locale = useLocale();
  const q = useQuery({
    queryKey: ["field", workspaceId, fieldId, "outlook"],
    queryFn: () => api<FieldOutlookView>(`/api/w/${workspaceId}/fields/${fieldId}/outlook`),
    retry: false,
    staleTime: 60 * 60_000,
  });
  const o = q.data?.outlook;
  if (!o) return null;
  const date = new Intl.DateTimeFormat(locale === "uk" ? "uk-UA" : "en-US", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  }).format(new Date(`${o.issuedAt}T00:00:00Z`));
  const deg = (c: number) => (units === "imperial" ? `${Math.round((c * 9) / 5 + 32)} °F` : `${c} °C`);
  return (
    <section className="rounded-card border border-line bg-surface p-5" data-testid="outlook-card">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-h2 text-ink">{t("olTitle")}</h2>
        <span className="text-small text-ink-2">
          {t("olSource", { n: o.members, date })}
          <InfoHint label={t("hintLabel")} align="end" className="ml-2">
            {t("olHint", { from: String(o.climatology.from), to: String(o.climatology.to) })}
          </InfoHint>
        </span>
      </div>

      <div className="mt-4 grid gap-4 sm:grid-cols-3">
        {o.months.map((m) => (
          <div key={m.month} className="min-w-0">
            <h3 className="text-body font-medium text-ink">{monthName(m.month, locale)}</h3>
            <p className="mt-2 flex items-center gap-1 text-small text-ink-2">
              <CloudRain aria-hidden className="size-4" strokeWidth={1.7} />
              {t("olRain")}
            </p>
            <TercileBar
              p={m.precip}
              colours={["bg-week", "bg-line-strong", "bg-info"]}
              label={t("olBarAria", {
                what: t("olRain"),
                a: pct(m.precip.below),
                b: pct(m.precip.near),
                c: pct(m.precip.above),
                lo: t("olDry"),
                hi: t("olWet"),
              })}
            />
            <p className="mt-2 flex items-center gap-1 text-small text-ink-2">
              <Thermometer aria-hidden className="size-4" strokeWidth={1.7} />
              {t("olTemp")}
            </p>
            <TercileBar
              p={m.temp}
              colours={["bg-info", "bg-line-strong", "bg-urgent"]}
              label={t("olBarAria", {
                what: t("olTemp"),
                a: pct(m.temp.below),
                b: pct(m.temp.near),
                c: pct(m.temp.above),
                lo: t("olCool"),
                hi: t("olWarm"),
              })}
            />
          </div>
        ))}
      </div>
      <div className="mt-2 flex justify-between text-micro text-ink-3" aria-hidden>
        <span>{t("olLegendBelow")}</span>
        <span>{t("olLegendNear")}</span>
        <span>{t("olLegendAbove")}</span>
      </div>

      {o.signals.length === 0 ? (
        <p className="mt-4 text-small text-ink-2">{t("olNoSignal")}</p>
      ) : (
        <ul className="mt-4 flex flex-col gap-2">
          {o.signals.map((s) => {
            const Icon = ICON[s.kind];
            return (
              <li key={`${s.kind}${s.month}`} className="flex items-start gap-2 text-small text-ink">
                <Icon aria-hidden className="mt-0.5 size-4 shrink-0 text-ink-2" strokeWidth={1.7} />
                <span>
                  {t(`olSig_${s.kind}`, {
                    month: monthName(s.month, locale),
                    p: s.probability != null ? pct(s.probability) : "",
                    ens: s.ensDays ?? "",
                    clim: s.climDays ?? "",
                  })}
                </span>
              </li>
            );
          })}
        </ul>
      )}
      <p className="mt-3 text-small text-ink-2">
        {t("olDefs", { frost: deg(0), heat: deg(35) })}
      </p>
    </section>
  );
}
