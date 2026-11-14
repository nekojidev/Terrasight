"use client";

import { clsx } from "clsx";
import { AlertTriangle, Check, Loader2, Minus } from "lucide-react";
import { Button } from "./Button";

export type FieldRunStatus = "waiting" | "running" | "done" | "no_data";

export interface AnalysisPanelProps {
  title: string;
  fields: Array<{ id: string; name: string; status: FieldRunStatus; note?: string }>;
  /** Localised status words. */
  statusLabels: Record<FieldRunStatus, string>;
  /** "What we check in November" lines. */
  seasonTitle: string;
  seasonChecks: string[];
  retryLabel: string;
  onRetry: (fieldId: string) => void;
  className?: string;
}

const ICON = {
  waiting: <Minus className="size-4 text-ink-3" />,
  running: <Loader2 className="size-4 animate-spin text-ink" />,
  done: <Check className="size-4 text-ok" />,
  no_data: <AlertTriangle className="size-4 text-urgent" />,
} as const;

/** Per-field progress of an analysis run (RFC §10.2): waiting / running / done / No data + Retry. */
export function AnalysisPanel(p: AnalysisPanelProps) {
  const finished = p.fields.filter((f) => f.status === "done" || f.status === "no_data").length;
  const pct = p.fields.length ? finished / p.fields.length : 0;
  return (
    <section className={clsx("rounded-card border border-line bg-surface p-5", p.className)}>
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="text-h2 text-ink">{p.title}</h2>
        <span className="font-mono text-small text-ink-2">
          {finished}/{p.fields.length}
        </span>
      </div>
      <div
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={p.fields.length}
        aria-valuenow={finished}
        className="mb-4 h-1.5 overflow-hidden rounded-chip bg-muted"
      >
        <span
          className="block h-full origin-left bg-ink transition-transform duration-bar ease-ts"
          style={{ transform: `scaleX(${pct})` }}
        />
      </div>
      <ul aria-live="polite" className="flex flex-col divide-y divide-line">
        {p.fields.map((f) => (
          <li key={f.id} className="flex min-h-tap items-center gap-3 py-2">
            <span aria-hidden className="[&>svg]:stroke-[1.7]">
              {ICON[f.status]}
            </span>
            <span className="flex-1 text-body text-ink">
              {f.name}
              {f.note && <span className="block text-small text-ink-2">{f.note}</span>}
            </span>
            <span
              className={clsx(
                "text-small",
                f.status === "no_data" ? "font-semibold text-urgent" : "text-ink-2",
              )}
            >
              {p.statusLabels[f.status]}
            </span>
            {f.status === "no_data" && (
              <Button variant="outline" onClick={() => p.onRetry(f.id)}>
                {p.retryLabel}
              </Button>
            )}
          </li>
        ))}
      </ul>
      {p.seasonChecks.length > 0 && (
        <div className="mt-4 rounded-input bg-surface-2 p-4">
          <h3 className="text-micro mb-2 text-ink-2">{p.seasonTitle}</h3>
          <ul className="list-disc pl-5 text-small text-ink-2">
            {p.seasonChecks.map((c) => (
              <li key={c}>{c}</li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
