"use client";

import { Tabs } from "@terrasight/ui";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { useFormat } from "@/lib/useFormat";

export interface ModelVsActualSeries {
  id: string;
  label: string;
  /** One value per year (same order as `years`); null = no data that year (a gap, never interpolated). */
  values: Array<number | null>;
}

export interface ModelVsActualChartProps {
  years: number[];
  /** Up to three series. */
  series: ModelVsActualSeries[];
  /** Unit of the values ("% of a typical year"); shown above the axis and in the table. */
  unitLabel: string;
  /** Years drawn as a labelled vertical band (e.g. the 2022 drought). */
  highlightYears?: Array<{ year: number; label: string }>;
  /** Years the model missed: a ring marker and a note. */
  missYears?: number[];
  ariaLabel: string;
  tableCaption: string;
}

type Marker = "circle" | "square" | "triangle";
const MARKERS: Marker[] = ["circle", "square", "triangle"];
const STROKE = ["stroke-ink", "stroke-ink-2", "stroke-week"];
const FILL = ["fill-ink", "fill-ink-2", "fill-week"];
/** Dash patterns differ as well as the markers, so lines are told apart without colour. */
const DASH = [undefined, "8 4", "2 4"];

const H = 280;
const TOP = 34;
const BOTTOM = 40;
const LEFT = 60;
const RIGHT_PAD = 190;
const STEP = 38;

function MarkerShape({ kind, x, y, className }: { kind: Marker; x: number; y: number; className: string }) {
  if (kind === "square") return <rect x={x - 4.5} y={y - 4.5} width="9" height="9" className={className} />;
  if (kind === "triangle")
    return <polygon points={`${x},${y - 5.5} ${x + 5.5},${y + 4.5} ${x - 5.5},${y + 4.5}`} className={className} />;
  return <circle cx={x} cy={y} r="4.5" className={className} />;
}

/**
 * Model against actual, year by year: up to three lines told apart by marker shape, dash pattern and an end label.
 * Nulls leave gaps. A zero line, labelled bands for named years, rings for missed years. At narrow widths the chart
 * keeps its size (text stays 12 px) and scrolls sideways; the Table view lists every number.
 */
export function ModelVsActualChart({
  years,
  series,
  unitLabel,
  highlightYears = [],
  missYears = [],
  ariaLabel,
  tableCaption,
}: ModelVsActualChartProps) {
  const t = useTranslations("Field");
  const fmt = useFormat();
  const [view, setView] = useState<"chart" | "table">("chart");
  const shown = series.slice(0, 3);
  const num = (v: number) => fmt.number(v, { maximumFractionDigits: 1 });

  const W = LEFT + Math.max(1, years.length - 1) * STEP + 24 + RIGHT_PAD;
  const RIGHT = W - RIGHT_PAD;
  const all = shown.flatMap((s) => s.values).filter((v): v is number => v !== null);
  const rawLo = Math.min(0, ...all);
  const rawHi = Math.max(0, ...all);
  const pad = (rawHi - rawLo || 1) * 0.08;
  const lo = rawLo - (rawLo < 0 ? pad : 0);
  const hi = rawHi + (rawHi > 0 ? pad : 0) || 1;
  const X = (i: number) => LEFT + (i / Math.max(1, years.length - 1)) * (RIGHT - LEFT - 24);
  const Y = (v: number) => H - BOTTOM - ((v - lo) / (hi - lo)) * (H - TOP - BOTTOM);
  const ticks = [0, 1, 2, 3].map((k) => lo + ((hi - lo) * k) / 3);
  const yearIdx = (y: number) => years.indexOf(y);

  // Contiguous runs of non-null values: a null breaks the line.
  const runs = (values: Array<number | null>) => {
    const out: Array<Array<{ i: number; v: number }>> = [];
    let cur: Array<{ i: number; v: number }> = [];
    values.forEach((v, i) => {
      if (v === null) {
        if (cur.length) out.push(cur);
        cur = [];
      } else cur.push({ i, v });
    });
    if (cur.length) out.push(cur);
    return out;
  };

  // End labels sit at the last value of each series and stay 16 px apart.
  const endY = (() => {
    const ys = shown
      .map((s, k) => {
        const last = [...s.values].reverse().find((v) => v !== null) ?? 0;
        return { k, y: Y(last) + 4 };
      })
      .sort((p, q) => p.y - q.y);
    for (let n = 1; n < ys.length; n++) ys[n]!.y = Math.max(ys[n]!.y, ys[n - 1]!.y + 16);
    return Object.fromEntries(ys.map((e) => [e.k, e.y]));
  })();
  const lastIdx = (s: ModelVsActualSeries) => {
    for (let i = s.values.length - 1; i >= 0; i--) if (s.values[i] !== null) return i;
    return -1;
  };

  const missed = missYears.filter((y) => yearIdx(y) >= 0);
  const highlighted = highlightYears.filter((h) => yearIdx(h.year) >= 0);

  return (
    <div className="flex flex-col gap-3">
      <Tabs
        label={t("mc_view")}
        value={view}
        onChange={(v) => setView(v as "chart" | "table")}
        items={[
          { id: "chart", label: t("mc_chart") },
          { id: "table", label: t("mc_table") },
        ]}
      />
      {view === "chart" ? (
        <div role="tabpanel" className="flex flex-col gap-2">
          <div role="region" aria-label={ariaLabel} tabIndex={0} className="focus-ring overflow-x-auto rounded-card">
            <svg
              viewBox={`0 0 ${W} ${H}`}
              width={W}
              height={H}
              role="img"
              aria-label={ariaLabel}
              className="block max-w-none"
              style={{ minWidth: `${Math.min(W, 700)}px`, width: "100%" }}
            >
              <text x={LEFT} y={14} className="fill-ink-2 text-[12px]">
                {unitLabel}
              </text>
              {highlighted.map((h) => {
                const x = X(yearIdx(h.year));
                return (
                  <g key={h.year}>
                    <rect x={x - STEP / 2} y={TOP - 6} width={STEP} height={H - TOP - BOTTOM + 6} className="fill-muted" />
                    <text x={x} y={TOP - 10} textAnchor="middle" className="fill-ink text-[12px] font-semibold">
                      {h.label}
                    </text>
                  </g>
                );
              })}
              {ticks.map((v, k) => (
                <g key={k}>
                  <line x1={LEFT} x2={RIGHT} y1={Y(v)} y2={Y(v)} className="stroke-line" strokeDasharray="3 4" />
                  <text x={LEFT - 8} y={Y(v) + 4} textAnchor="end" className="fill-ink-2 text-[12px]">
                    {num(v)}
                  </text>
                </g>
              ))}
              <line x1={LEFT} x2={RIGHT} y1={Y(0)} y2={Y(0)} className="stroke-ink-3" strokeWidth="1.5" />
              <text x={LEFT - 8} y={Y(0) + 4} textAnchor="end" className="fill-ink text-[12px] font-semibold">
                0
              </text>
              {years.map((y, i) => (
                <text key={y} x={X(i)} y={H - 14} textAnchor="middle" className="fill-ink-2 text-[12px]">
                  {y}
                </text>
              ))}
              {shown.map((s, k) => (
                <g key={s.id}>
                  {runs(s.values).map((run, n) =>
                    run.length > 1 ? (
                      <polyline
                        key={n}
                        fill="none"
                        strokeWidth="2"
                        strokeDasharray={DASH[k]}
                        className={STROKE[k]!}
                        points={run.map((p) => `${X(p.i)},${Y(p.v)}`).join(" ")}
                      />
                    ) : null,
                  )}
                  {s.values.map((v, i) =>
                    v === null ? null : (
                      <MarkerShape key={i} kind={MARKERS[k]!} x={X(i)} y={Y(v)} className={FILL[k]!} />
                    ),
                  )}
                  {lastIdx(s) >= 0 && (
                    <text x={X(lastIdx(s)) + 14} y={endY[k]} className="fill-ink text-[12px] font-semibold">
                      {s.label} {num(s.values[lastIdx(s)]!)}
                    </text>
                  )}
                </g>
              ))}
              {missed.map((y) => {
                const i = yearIdx(y);
                const vals = shown.map((s) => s.values[i]).filter((v): v is number => v !== null);
                const at = vals.length ? Y(vals[0]!) : Y(0);
                return (
                  <circle
                    key={y}
                    data-testid="miss-ring"
                    cx={X(i)}
                    cy={at}
                    r="10"
                    fill="none"
                    strokeWidth="2"
                    className="stroke-urgent"
                  />
                );
              })}
            </svg>
          </div>
          <p className="text-caption text-ink-2">{t("mc_scroll")}</p>
          {missed.length > 0 && <p className="text-caption text-ink">{t("mc_miss_note", { years: missed.join(", ") })}</p>}
          <ul aria-label={t("mc_legend")} className="flex flex-col gap-1 text-caption text-ink-2">
            {shown.map((s, k) => (
              <li key={s.id} className="flex items-center gap-2">
                <svg width="34" height="14" aria-hidden className="shrink-0">
                  <line x1="0" x2="34" y1="7" y2="7" strokeWidth="2" strokeDasharray={DASH[k]} className={STROKE[k]!} />
                  <MarkerShape kind={MARKERS[k]!} x={17} y={7} className={FILL[k]!} />
                </svg>
                <span className="text-ink">{s.label}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <div role="tabpanel" className="overflow-x-auto">
          <table className="w-full text-caption">
            <caption className="sr-only">
              {tableCaption} · {unitLabel}
            </caption>
            <thead>
              <tr className="text-left text-ink-2">
                <th scope="col" className="py-2 pr-3">
                  {t("mc_series")}
                </th>
                {years.map((y) => {
                  const h = highlighted.find((x) => x.year === y);
                  return (
                    <th key={y} scope="col" className="py-2 text-right font-mono">
                      {y}
                      {h && <span className="block font-sans font-semibold text-ink">{h.label}</span>}
                      {missed.includes(y) && <span className="block font-sans text-ink">{t("mc_missed")}</span>}
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {shown.map((s) => (
                <tr key={s.id} className="border-t border-line">
                  <th scope="row" className="py-2 pr-3 text-left font-semibold text-ink">
                    {s.label}
                  </th>
                  {s.values.map((v, i) => (
                    <td key={i} className="py-2 text-right font-mono text-ink">
                      {v === null ? <span className="font-sans text-ink-3">{t("mc_no_data")}</span> : num(v)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
