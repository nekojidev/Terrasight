"use client";

import type { ClimateMetric, ClimateMetricId, ClimateShift } from "@terrasight/shared";
import { Button, Disclosure, InfoHint, Kicker, Skeleton, Surface } from "@terrasight/ui";
import { ChevronRight } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useFormat } from "@/lib/useFormat";
import { DeltaBadge } from "./DeltaBadge";

export interface ClimateShiftCardProps {
  data: ClimateShift | undefined;
  isLoading: boolean;
  isError: boolean;
  onRetry: () => void;
  /** ISO country code of the field; "US" shows °F, inches. */
  country?: string;
  /** Unit system when the country is unknown (workspace setting). */
  units?: "metric" | "imperial";
  /** "How far can you trust this" link. */
  trustHref?: string;
  /** Headline, the three strongest significant changes and the full table behind a disclosure. */
  compact?: boolean;
}

/** Order in which a second sentence is picked for the headline. The growing-season temperature always goes first. */
const HEADLINE_ORDER: ClimateMetricId[] = [
  "hotDaysFlowering",
  "seasonPrecip",
  "longestDrySpell",
  "lastSpringFrost",
  "firstAutumnFrost",
  "frostFreeDays",
  "gdd",
];

/** A metric the headline may state: the trend test passed, and the period difference agrees with the trend slope. */
export function isClearChange(m: ClimateMetric): boolean {
  const slope = m.trend.slopePerDecade;
  return (
    m.trend.significant &&
    m.delta !== null &&
    m.delta !== 0 &&
    slope !== null &&
    slope !== 0 &&
    Math.sign(slope) === Math.sign(m.delta)
  );
}

/**
 * Fixed rules, no AI: only metrics the data marks as a clear trend (and that still show a non-zero change as printed)
 * can be named. Season temperature first, then at most one more; without season temperature, at most two.
 * An empty result means "no clear climate trend".
 */
export function pickHeadlineMetrics(metrics: ClimateMetric[], visible: (m: ClimateMetric) => boolean): ClimateMetric[] {
  const ok = (m: ClimateMetric | undefined): m is ClimateMetric => m !== undefined && isClearChange(m) && visible(m);
  const temp = metrics.find((m) => m.id === "seasonTemp");
  const others = HEADLINE_ORDER.map((id) => metrics.find((m) => m.id === id)).filter(ok);
  return ok(temp) ? [temp, ...others.slice(0, 1)] : others.slice(0, 2);
}

const round1 = (n: number) => Math.round(n * 10) / 10;
const KNOWN_REASONS = { "weather-missing": "weatherMissing", "too-few-years": "tooFewYears", "outside-coverage": "outsideCoverage" } as const;

/** Climate shift of a place (EP-10): two periods of NASA POWER compared, the trend test next to every change. */
export function ClimateShiftCard({
  data,
  isLoading,
  isError,
  onRetry,
  country,
  units,
  trustHref,
  compact = false,
}: ClimateShiftCardProps) {
  const t = useTranslations("Field");
  const fmt = useFormat({
    ...(country ? { country } : {}),
    ...(!country && units ? { units } : {}),
  });
  const imperial = fmt.units === "imperial";
  // Dynamic message keys: the key set is fixed in design/i18n/08-Field.json.
  const tt = (key: string, values?: Record<string, string | number>) =>
    t(key as "cs_retry", values as never) as string;

  if (data?.status === "ready") return renderReady(data);

  if (data?.status === "unavailable" || (!data && isError)) {
    const reason = data?.reason && data.reason in KNOWN_REASONS ? KNOWN_REASONS[data.reason as keyof typeof KNOWN_REASONS] : "unknown";
    return (
      <Surface as="section" aria-labelledby="cs-title" className="flex flex-col gap-3">
        <h2 id="cs-title" className="text-h2 text-ink">
          {t("cs_unavail_title")}
        </h2>
        <p className="text-body text-ink-2">{tt(`cs_unavail_${reason}`)}</p>
        <div>
          <Button variant="outline" size={44} onClick={onRetry}>
            {t("cs_retry")}
          </Button>
        </div>
      </Surface>
    );
  }

  // pending, loading, or nothing yet
  void isLoading;
  return (
    <Surface as="section" aria-busy="true" aria-label={t("cs_loading")} className="flex flex-col gap-3">
      <p role="status" className="text-body text-ink-2">
        {t("cs_pending")}
      </p>
      <Skeleton variant="text" rows={3} label={t("cs_loading")} />
    </Surface>
  );

  function renderReady(data: ClimateShift) {
    const { baseline, recent } = data.periods;
    const periodText = (p: { from: number; to: number }) => `${p.from}–${p.to}`;
    const mmdd = (s: string) => fmt.date(`2023-${s}T00:00:00Z`, "dayMonth", { timeZone: "UTC" });
    const fromYear = data.source ? Number(data.source.from.slice(0, 4)) : baseline.from;
    const toYear = data.source ? Number(data.source.lastDate.slice(0, 4)) : recent.to;

    const ddFactor = imperial ? 9 / 5 : 1;
    const ddText = (value: string) => tt(imperial ? "cs_dd_f" : "cs_dd_c", { value });
    const shiftText = (d: number, digits: number) => {
      const s = fmt.dayShift(d, digits);
      if (s.direction === "same") return t("cs_same");
      return tt(s.direction === "earlier" ? "cs_earlier" : "cs_later", { days: tt("cs_days", { n: s.days }) });
    };
    const absText = (m: ClimateMetric, v: number): string => {
      switch (m.unit) {
        case "degC":
          return fmt.temp(v, 1);
        case "days":
          return tt("cs_days", { n: round1(v) });
        case "mm":
          return fmt.rain(v);
        case "degDays":
          return ddText(fmt.number(v * ddFactor, { maximumFractionDigits: 0 }));
        case "dayOfYear":
          return fmt.dayOfYear(v);
      }
    };
    const deltaText = (m: ClimateMetric, d: number, digits = 1): string => {
      switch (m.unit) {
        case "degC":
          return fmt.tempDelta(d, digits);
        case "days":
          return tt("cs_d", { value: fmt.signed(d, { maximumFractionDigits: digits }) });
        case "mm":
          return fmt.rainDelta(d);
        case "degDays":
          return ddText(fmt.signed(d * ddFactor, { maximumFractionDigits: 0 }));
        case "dayOfYear":
          return shiftText(d, digits);
      }
    };
    const directionOf = (m: ClimateMetric, d: number): "up" | "down" | "flat" => {
      if (m.unit === "dayOfYear") {
        const s = fmt.dayShift(d, 0).direction;
        return s === "same" ? "flat" : s === "earlier" ? "down" : "up";
      }
      if (!/[1-9]/.test(deltaText(m, d))) return "flat";
      return d > 0 ? "up" : "down";
    };
    /** The size of a change without its sign, for sentences ("1.4 °C", "8 days"). */
    const magnitude = (m: ClimateMetric, d: number): string => {
      if (m.unit === "dayOfYear") return tt("cs_days", { n: fmt.dayShift(d, 0).days });
      if (m.unit === "days") return tt("cs_days", { n: round1(Math.abs(d)) });
      return deltaText(m, Math.abs(d)).replace(/^\+/, "");
    };

    const picked = pickHeadlineMetrics(data.metrics, (m) => directionOf(m, m.delta ?? 0) !== "flat");
    const headline =
      picked.length === 0
        ? t("cs_headline_none", { from: fromYear, to: toYear })
        : picked
            .map((m) =>
              tt(`hl_${m.id}_${(m.delta ?? 0) > 0 ? "up" : "down"}`, {
                value: magnitude(m, m.delta ?? 0),
                baseline: periodText(baseline),
              }),
            )
            .join(". ") + ".";

    const hintOf = (m: ClimateMetric): string[] => {
      const range = { from: mmdd(data.season.from), to: mmdd(data.season.to) };
      switch (m.id) {
        case "seasonTemp":
          return [tt("h_seasonTemp", range)];
        case "hotDaysFlowering": {
          const w = data.flowering;
          const out = [tt("h_hotDaysFlowering", { threshold: fmt.temp(w.thresholdC), from: mmdd(w.from), to: mmdd(w.to) })];
          if (w.fallback) out.push(t("h_hot_fallback"));
          if (!w.verified) out.push(t("h_hot_unverified"));
          if (w.source) out.push(tt("h_hot_source", { title: w.source.title, publisher: w.source.publisher }));
          return out;
        }
        case "seasonPrecip":
          return [tt("h_seasonPrecip", range)];
        case "longestDrySpell":
          return [tt("h_longestDrySpell", { ...range, limit: fmt.rain(1) })];
        case "gdd":
          return [tt("h_gdd", { ...range, base: fmt.temp(10), cap: fmt.temp(30) })];
        case "lastSpringFrost":
          return [tt("h_lastSpringFrost", { zero: fmt.temp(0) })];
        case "firstAutumnFrost":
          return [tt("h_firstAutumnFrost", { zero: fmt.temp(0) })];
        case "frostFreeDays":
          return [t("h_frostFreeDays")];
      }
    };

    const periodYears = (p: { from: number; to: number }) => p.to - p.from + 1;
    const valueCell = (m: ClimateMetric, v: number | null, without: number | undefined, p: { from: number; to: number }) => {
      if (v === null)
        return without !== undefined
          ? { text: tt("cs_no_frost", { n: without, total: periodYears(p) }), note: null }
          : { text: "—", note: null };
      return {
        text: absText(m, v),
        note: without ? tt("cs_some_nofrost", { n: without, total: periodYears(p) }) : null,
      };
    };

    const row = (m: ClimateMetric, inlineHints?: boolean) => {
      const name = tt(`m_${m.id}`);
      const hint = hintOf(m);
      const before = valueCell(m, m.baseline, m.yearsWithout?.baseline, baseline);
      const now = valueCell(m, m.recent, m.yearsWithout?.recent, recent);
      const slope = m.trend.slopePerDecade;
      return (
        <li key={m.id} className="flex flex-col gap-2 py-3 sm:grid sm:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1.7fr)] sm:items-start sm:gap-x-4">
          <div className="min-w-0">
            <p className="flex items-center gap-2 text-body font-semibold text-ink">
              <span>{name}</span>
              {!inlineHints && (
                <InfoHint label={`${t("h_label")} ${name}`}>
                  {hint.map((h) => (
                    <span key={h} className="block">
                      {h}
                    </span>
                  ))}
                </InfoHint>
              )}
            </p>
            {inlineHints && <p className="mt-0.5 text-caption text-ink-2">{hint.join(" ")}</p>}
          </div>
          <div className="grid grid-cols-2 gap-x-4 sm:contents">
            <div className="min-w-0">
              <span className="block text-caption text-ink-2">{periodText(baseline)}</span>
              <span className="block text-body text-ink">{before.text}</span>
              {before.note && <span className="block text-caption text-ink-2">{before.note}</span>}
            </div>
            <div className="min-w-0">
              <span className="block text-caption text-ink-2">{periodText(recent)}</span>
              <span className="block text-body text-ink">{now.text}</span>
              {now.note && <span className="block text-caption text-ink-2">{now.note}</span>}
            </div>
          </div>
          <div className="min-w-0">
            {m.delta === null ? (
              <span className="text-body text-ink-3">{t("cs_delta_none")}</span>
            ) : (
              <DeltaBadge
                label={name}
                value={deltaText(m, m.delta, m.unit === "dayOfYear" ? 0 : 1)}
                direction={directionOf(m, m.delta)}
                significant={m.trend.significant}
              />
            )}
            <p className={m.trend.significant ? "mt-0.5 text-caption text-ink-2" : "mt-0.5 text-caption text-ink-3"}>
              {slope === null ? t("cs_slope_none") : tt("cs_slope", { value: deltaText(m, slope, 1) })}
            </p>
          </div>
        </li>
      );
    };

    const list = (metrics: ClimateMetric[], inlineHints?: boolean) => (
      <ul
        aria-label={tt("cs_metrics_label", { baseline: periodText(baseline), recent: periodText(recent) })}
        className="flex flex-col divide-y divide-line"
      >
        {metrics.map((m) => row(m, inlineHints))}
      </ul>
    );

    const strongest = data.metrics
      .filter((m) => m.trend.significant && m.delta !== null)
      .sort((a, b) => (a.trend.pValue ?? 1) - (b.trend.pValue ?? 1))
      .slice(0, 3);

    const gpm = data.gpm;
    const gpmText = (() => {
      if (!gpm) return null;
      if (gpm.status !== "ready" || gpm.powerChangePct === null || gpm.imergChangePct === null)
        return t("cs_gpm_unavailable");
      const values = {
        from: gpm.early?.from ?? "",
        to: gpm.late?.to ?? "",
        power: `${fmt.signed(gpm.powerChangePct, { maximumFractionDigits: 1 })}\u00A0%`,
        imerg: `${fmt.signed(gpm.imergChangePct, { maximumFractionDigits: 1 })}\u00A0%`,
      };
      return tt(gpm.agree === null ? "cs_gpm_values" : gpm.agree ? "cs_gpm_same" : "cs_gpm_opposite", values);
    })();

    return (
      <Surface as="section" aria-labelledby="cs-headline" className="flex min-w-0 flex-col gap-4">
        <div className="flex flex-col gap-1">
          <Kicker>{t("cs_kicker", { from: fromYear, to: toYear })}</Kicker>
          <h2 id="cs-headline" className="text-h2 text-ink">
            {headline}
          </h2>
        </div>
        {compact ? (
          <>
            {strongest.length > 0 && list(strongest)}
            <Disclosure summary={t("cs_all")}>
              <div className="pb-1">{list(data.metrics, true)}</div>
            </Disclosure>
          </>
        ) : (
          list(data.metrics)
        )}
        {gpmText && <p className="text-body text-ink-2">{gpmText}</p>}
        {data.skippedYears.length > 0 && (
          <p className="text-caption text-ink-2">{t("cs_skipped", { years: data.skippedYears.join(", ") })}</p>
        )}
        <div className="flex flex-col gap-2 border-t border-line pt-3">
          <p className="text-caption text-ink-2">
            {t("cs_footer", {
              km: fmt.number(data.source?.resolutionKm ?? 55, { maximumFractionDigits: 0 }),
              baseline: periodText(baseline),
              recent: periodText(recent),
              date: data.source ? fmt.date(`${data.source.lastDate.slice(0, 10)}T00:00:00Z`, "full", { timeZone: "UTC" }) : "—",
            })}
          </p>
          {trustHref && (
            <Link
              href={trustHref}
              className="focus-ring inline-flex min-h-tap items-center gap-1 self-start rounded-btn text-body font-semibold text-ink underline underline-offset-4"
            >
              {t("cs_trust")}
              <ChevronRight aria-hidden className="size-4" />
            </Link>
          )}
        </div>
      </Surface>
    );
  }
}
