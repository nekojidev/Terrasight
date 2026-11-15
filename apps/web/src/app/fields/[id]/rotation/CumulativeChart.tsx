"use client";

import { Tabs } from "@terrasight/ui";
import { useTranslations } from "next-intl";
import { useState } from "react";

export interface ChartSeries {
  letter: string;
  name: string;
  /** Cumulative margin per season, already in the display unit. */
  values: number[];
  picked: boolean;
}

const STROKE = ["stroke-ink-2", "stroke-ink", "stroke-week", "stroke-ok", "stroke-line-strong"];
const FILL = ["fill-ink-2", "fill-ink", "fill-week", "fill-ok", "fill-line-strong"];
/** Line styles differ as well as colours, so the series are told apart without colour. */
const DASH = [undefined, "8 4", "2 4", "10 3 2 3", "1 5"];

const W = 700;
const H = 260;
const LEFT = 76;
const RIGHT = 560;

/**
 * Cumulative margin lines (sum of the simulated years, no extrapolation). At 390 px the chart keeps its natural size
 * (text stays 12 px) and scrolls sideways; the "Table" view shows the same numbers as text. Series fade in one after
 * another; reduced motion keeps the end state.
 */
export function CumulativeChart({
  series,
  seasons,
  money,
  moneyCompact,
  dipLetters,
  dipLabel,
  ariaLabel,
}: {
  series: ChartSeries[];
  seasons: number[];
  money: (v: number) => string;
  moneyCompact: (v: number) => string;
  dipLetters: string[];
  dipLabel: string;
  ariaLabel: string;
}) {
  const r = useTranslations("Rotation");
  const [view, setView] = useState<"chart" | "table">("chart");
  const all = series.flatMap((s) => s.values);
  const lo = Math.min(0, ...all);
  const hi = Math.max(1, ...all);
  const X = (i: number) => LEFT + (i / Math.max(1, seasons.length - 1)) * (RIGHT - LEFT);
  const Y = (v: number) => H - 36 - ((v - lo) / (hi - lo)) * (H - 64);
  const ticks = [0, 1, 2, 3].map((k) => lo + ((hi - lo) * k) / 3);
  // End labels stay 16 px apart so they never overlap.
  const endY = (() => {
    const ys = series.map((s, k) => ({ k, y: Y(s.values.at(-1) ?? 0) + 4 })).sort((p, q) => p.y - q.y);
    for (let n = 1; n < ys.length; n++) ys[n]!.y = Math.max(ys[n]!.y, ys[n - 1]!.y + 16);
    return Object.fromEntries(ys.map((e) => [e.k, e.y]));
  })();
  const dipSeries = series.findIndex((s) => dipLetters.includes(s.letter));

  return (
    <div className="flex flex-col gap-3">
      <Tabs
        label={r("view_label")}
        value={view}
        onChange={(v) => setView(v as "chart" | "table")}
        items={[
          { id: "chart", label: r("view_chart") },
          { id: "table", label: r("view_table") },
        ]}
      />
      {view === "chart" ? (
        <div role="tabpanel" className="flex flex-col gap-2">
          <div
            role="region"
            aria-label={ariaLabel}
            tabIndex={0}
            className="focus-ring overflow-x-auto rounded-card"
          >
            <svg
              viewBox={`0 0 ${W} ${H}`}
              width={W}
              height={H}
              role="img"
              aria-label={ariaLabel}
              className="block w-full max-w-none min-w-[700px]"
            >
              {ticks.map((v) => (
                <g key={v}>
                  <line
                    x1={LEFT}
                    x2={RIGHT}
                    y1={Y(v)}
                    y2={Y(v)}
                    className="stroke-line"
                    strokeDasharray={v === 0 ? undefined : "3 4"}
                  />
                  <text x={LEFT - 8} y={Y(v) + 4} textAnchor="end" className="fill-ink-2 text-[12px]">
                    {moneyCompact(v)}
                  </text>
                </g>
              ))}
              <line x1={LEFT} x2={RIGHT} y1={Y(0)} y2={Y(0)} className="stroke-ink-3" />
              {seasons.map((y, i) => (
                <text key={y} x={X(i)} y={H - 10} textAnchor="middle" className="fill-ink-2 text-[12px]">
                  {y}
                </text>
              ))}
              {series.map((s, k) => (
                <g key={s.letter} className="animate-fade stagger" style={{ "--i": k } as React.CSSProperties}>
                  <polyline
                    fill="none"
                    strokeWidth={s.picked ? 3.5 : 2}
                    strokeDasharray={DASH[k % DASH.length]}
                    className={STROKE[k % STROKE.length]}
                    points={s.values.map((v, i) => `${X(i)},${Y(v)}`).join(" ")}
                  />
                  {s.values.map((v, i) => (
                    <circle key={i} cx={X(i)} cy={Y(v)} r="3.5" className={FILL[k % FILL.length]} />
                  ))}
                  <text x={RIGHT + 10} y={endY[k]} className="fill-ink text-[12px] font-semibold">
                    {s.letter} {money(s.values.at(-1) ?? 0)}
                  </text>
                </g>
              ))}
              {dipSeries >= 0 && (
                <g>
                  <circle
                    cx={X(0)}
                    cy={Y(series[dipSeries]!.values[0]!)}
                    r="7"
                    fill="none"
                    strokeWidth="1.5"
                    className="stroke-week"
                  />
                  <text
                    x={X(0) + 12}
                    y={Y(series[dipSeries]!.values[0]!) - 10}
                    className="fill-week text-[12px] font-semibold"
                  >
                    {dipLabel}
                  </text>
                </g>
              )}
            </svg>
          </div>
          <p className="text-caption text-ink-2">{r("chart_scroll")}</p>
          <ul aria-label={r("chart_legend")} className="flex flex-col gap-1 text-caption text-ink-2">
            {series.map((s) => (
              <li key={s.letter}>
                <span className="font-semibold text-ink">{s.letter}</span> · {s.name}
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <div role="tabpanel" className="overflow-x-auto">
          <table className="w-full text-caption">
            <caption className="sr-only">{r("chart_table_caption")}</caption>
            <thead>
              <tr className="text-left text-ink-2">
                <th scope="col" className="py-2 pr-3">
                  {r("chart_option")}
                </th>
                {seasons.map((y) => (
                  <th key={y} scope="col" className="py-2 text-right font-mono">
                    {y}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {series.map((s) => (
                <tr key={s.letter} className="border-t border-line">
                  <th scope="row" className="py-2 pr-3 text-left font-semibold text-ink">
                    {s.letter} · {s.name}
                  </th>
                  {s.values.map((v, i) => (
                    <td key={i} className="py-2 text-right font-mono text-ink">
                      {money(v)}
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
