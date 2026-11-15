"use client";

import { Button, Kicker, Surface, cropColour } from "@terrasight/ui";
import { X } from "lucide-react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useId, useRef, useState } from "react";
import { useFormat } from "@/lib/useFormat";
import { fieldFormatOptions } from "./fieldFormat";
import { cropLabel, isEstimateSeason, type History } from "./fieldTypes";

type SeasonRow = History["seasons"][number];

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

/**
 * 18-season strip (design 08): one tile per season in crop colours. Tiles are at least 44 px wide in a strip that
 * scrolls sideways and snaps (it opens at the latest season). A tile opens its details on tap and on focus; Esc and a
 * tap outside close them. Estimates carry "≈" and a legend entry; the crop is always named in words.
 */
export function SeasonHistory({
  history,
  fieldId,
  units,
  country,
  compact = false,
}: {
  history: History;
  fieldId: string;
  units: "metric" | "imperial";
  country?: string | null;
  /** Overview: just the strip and its legend. Data & history: with stress years and the detected rotation. */
  compact?: boolean;
}) {
  const t = useTranslations("App");
  const r = useTranslations("Field");
  const locale = useLocale();
  const fmt = useFormat(fieldFormatOptions(country, units));
  const [open, setOpen] = useState<number | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const strip = useRef<HTMLOListElement>(null);
  const panelId = useId();

  const stress = new Map(history.stressYears.map((s) => [s.season, s.reasons]));
  const stats = new Map(
    (history.seasonStats ?? []).map((s) => [
      s.season,
      { precipMm: num(s.precipMm), heatDays: num(s.heatDays), ndviPeak: num(s.peak) },
    ]),
  );
  const bySeason = new Map(history.seasons.map((s) => [s.season, s]));
  // Always 18 slots ending at the last known season, so a season without data shows as "unknown", not as a gap.
  const lastKnown = history.seasons.reduce((m, s) => Math.max(m, s.season), 0);
  const slots = lastKnown ? Array.from({ length: 18 }, (_, i) => lastKnown - 17 + i) : [];
  const hasEstimate = history.seasons.some((s) => isEstimateSeason(s));
  const hasUnknown = slots.some((y) => !bySeason.has(y));
  const name = (id: string) => cropLabel(history.cropNames, locale, id);
  const cropText = (s: SeasonRow) => `${name(s.mainCrop)}${s.secondCrop ? ` + ${name(s.secondCrop)}` : ""}`;
  const sourceWord = (s: SeasonRow) =>
    s.isOverride
      ? t("hs_user")
      : s.source === "cdl"
        ? "USDA CDL"
        : s.source === "ndvi"
          ? `MODIS NDVI · ${t("src_estimate")}`
          : s.source;

  // Opens on the latest season: on a phone the strip is wider than the screen.
  useEffect(() => {
    const el = strip.current;
    if (el) el.scrollLeft = el.scrollWidth;
  }, [slots.length]);

  // A tap outside the strip and its details closes them.
  useEffect(() => {
    if (open === null) return;
    const onDown = (e: Event) => {
      if (root.current && !root.current.contains(e.target as Node)) setOpen(null);
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [open]);

  const crops = [...new Set(history.seasons.flatMap((s) => [s.mainCrop, ...(s.secondCrop ? [s.secondCrop] : [])]))];
  const sel = open !== null ? bySeason.get(open) : undefined;
  const selStat = open !== null ? stats.get(open) : undefined;
  const selReasons = open !== null ? (stress.get(open) ?? []) : [];

  return (
    <Surface as="section" aria-labelledby="hist-title">
      <div className="flex items-baseline justify-between gap-3">
        <h2 id="hist-title" className="text-h2 text-ink">
          {t("historyTitle")}
        </h2>
        <Link
          href={`/fields/${fieldId}/rotation`}
          className="focus-ring inline-flex min-h-tap shrink-0 items-center text-body font-semibold text-ink underline underline-offset-4"
        >
          {t("historyDetails")}
        </Link>
      </div>
      {history.built?.provisional && <p className="mt-1 text-caption text-week">{t("historyProvisional")}</p>}
      {!compact && history.stressYears.length > 0 && (
        <p className="mt-1 text-body text-ink-2">
          {t("stressTitle")}: {history.stressYears.map((s) => s.season).join(", ")}
        </p>
      )}
      {slots.length === 0 ? (
        <p className="mt-3 text-caption text-ink-2">{t("historyUnknown")}</p>
      ) : (
        <div
          ref={root}
          onKeyDown={(e) => {
            if (e.key === "Escape") setOpen(null);
          }}
        >
          <p className="mt-1 text-caption text-ink-2">{r("histHint")}</p>
          <ol
            ref={strip}
            aria-label={slots
              .map((y) => {
                const s = bySeason.get(y);
                return s
                  ? `${y}: ${cropText(s)} (${sourceWord(s)})`
                  : `${y}: ${t("historyUnknownTile")}`;
              })
              .join(", ")}
            className="mt-3 flex snap-x snap-mandatory gap-1 overflow-x-auto pb-2 [scrollbar-width:thin]"
          >
            {slots.map((y) => {
              const s = bySeason.get(y);
              const estimate = isEstimateSeason(s);
              return (
                <li key={y} className="flex min-w-11 flex-[1_0_44px] snap-start flex-col items-center gap-1">
                  <div className="relative w-full">
                    <button
                      type="button"
                      aria-label={`${t("hsSeason", { year: y })}: ${s ? cropText(s) : t("historyUnknownTile")}${estimate ? ` (${t("src_estimate")})` : ""}`}
                      aria-expanded={open === y}
                      aria-controls={panelId}
                      onFocus={() => setOpen(y)}
                      onClick={() => setOpen(y)}
                      className={`focus-ring relative block aspect-square min-h-11 w-full rounded-btn ${open === y ? "ring-2 ring-ink" : ""}`}
                    >
                      {s ? (
                        <span
                          className={`flex size-full overflow-hidden rounded-btn ${estimate ? "outline-dashed outline-1 -outline-offset-1 outline-ink-3" : ""}`}
                          style={{ opacity: s.confidence < 0.5 ? 0.55 : 1 }}
                        >
                          <span className="flex-1" style={{ backgroundColor: cropColour(s.mainCrop) }} />
                          {s.secondCrop && (
                            <span className="w-1/3" style={{ backgroundColor: cropColour(s.secondCrop) }} />
                          )}
                        </span>
                      ) : (
                        <span className="flex size-full items-center justify-center rounded-btn border border-dashed border-line-control bg-muted font-mono text-caption text-ink-2">
                          ?
                        </span>
                      )}
                      {estimate && (
                        <span
                          aria-hidden
                          className="absolute bottom-0.5 left-0.5 rounded-[4px] bg-surface px-1 text-caption leading-4 font-semibold text-ink"
                        >
                          ≈
                        </span>
                      )}
                    </button>
                    {stress.has(y) && (
                      <span
                        aria-hidden
                        className="pointer-events-none absolute -right-0.5 -top-0.5 size-3 rounded-chip border-2 border-surface bg-urgent"
                      />
                    )}
                  </div>
                  <span className="font-mono text-caption text-ink-2">{y}</span>
                </li>
              );
            })}
          </ol>

          {open !== null && (
            <div
              id={panelId}
              role="region"
              aria-label={t("hsSeason", { year: open })}
              className="animate-fade mt-2 rounded-input border border-line bg-surface-2 p-4"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <Kicker>{t("hsSeason", { year: open })}</Kicker>
                  <p className="mt-1 text-body font-semibold text-ink">
                    <span className="sr-only">{r("histCrop")}: </span>
                    {sel ? `${isEstimateSeason(sel) ? "≈ " : ""}${cropText(sel)}` : t("historyUnknownTile")}
                  </p>
                  {sel && (
                    <p className="text-caption text-ink-2">
                      {sourceWord(sel)} · {t("hsConfidence", { n: fmt.number(Math.round(sel.confidence * 100)) })}
                    </p>
                  )}
                </div>
                <Button variant="icon" label={r("histClose")} icon={<X />} onClick={() => setOpen(null)} />
              </div>
              {selStat && (selStat.precipMm !== null || selStat.heatDays !== null || selStat.ndviPeak !== null) && (
                <dl className="mt-3 grid grid-cols-[1fr_auto] gap-x-3 gap-y-1 text-caption">
                  {selStat.precipMm !== null && (
                    <>
                      <dt className="text-ink-2">{t("hsRain")}</dt>
                      <dd className="text-right font-mono text-ink">{fmt.rain(selStat.precipMm)}</dd>
                    </>
                  )}
                  {selStat.heatDays !== null && (
                    <>
                      <dt className="text-ink-2">{t("hsHeat", { t: fmt.temp(35) })}</dt>
                      <dd className="text-right font-mono text-ink">{fmt.number(selStat.heatDays)}</dd>
                    </>
                  )}
                  {selStat.ndviPeak !== null && (
                    <>
                      <dt className="text-ink-2">{t("hsNdvi")}</dt>
                      <dd className="text-right font-mono text-ink">
                        {fmt.number(selStat.ndviPeak, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </dd>
                    </>
                  )}
                </dl>
              )}
              {selReasons.length > 0 && (
                <p className="mt-3 flex items-start gap-2 text-caption font-semibold text-ink">
                  <span aria-hidden className="mt-1.5 size-2.5 shrink-0 rounded-chip bg-urgent" />
                  {selReasons.map((x) => (t.has(`hsStress_${x}`) ? t(`hsStress_${x}`) : "—")).join(" · ")}
                </p>
              )}
              {selStat && <p className="mt-3 text-caption text-ink-3">{t("hsSources")}</p>}
            </div>
          )}
        </div>
      )}
      {slots.length > 0 && (
        <div className="mt-3 flex flex-col gap-2 text-caption text-ink-2">
          <Kicker>{r("histLegend")}</Kicker>
          <ul aria-label={r("histLegendCrops")} className="flex flex-wrap gap-x-4 gap-y-1">
            {crops.map((c) => (
              <li key={c} className="inline-flex items-center gap-1.5">
                <span aria-hidden className="size-3 rounded-[3px]" style={{ backgroundColor: cropColour(c) }} />
                {name(c)}
              </li>
            ))}
          </ul>
          <ul className="flex flex-col gap-1">
            {hasEstimate && <li>{r("histLegendEstimate")}</li>}
            {stress.size > 0 && <li>{r("histLegendStress")}</li>}
            {hasUnknown && <li>{r("histLegendUnknown")}</li>}
          </ul>
        </div>
      )}
      {!compact && history.currentRotation && history.currentRotation.label !== "none" && (
        <p className="mt-3 text-caption text-ink-2">
          {t("currentRotation")}: {t("detectedFromHistory")} ·{" "}
          {fmt.percent(history.currentRotation.share)}
        </p>
      )}
    </Surface>
  );
}
