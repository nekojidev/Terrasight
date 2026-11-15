"use client";

import { useTranslations } from "next-intl";

export interface FocusField {
  id: string;
  name: string;
  status: "waiting" | "running" | "ok" | "stale" | "failed";
}

/** Attention strip while "Analyze fields" runs: N of M checked, the current field, a dot per field. */
export function AnalysisFocus({ fields }: { fields: FocusField[] }) {
  const t = useTranslations("App");
  const total = fields.length;
  const checked = fields.filter((f) => f.status !== "waiting" && f.status !== "running").length;
  const current = fields.find((f) => f.status === "running");
  const label = (s: FocusField["status"]) =>
    s === "ok" ? t("anOk") : s === "running" ? t("anRunning") : s === "waiting" ? t("anWaiting") : t("anProblem");
  const dot = (s: FocusField["status"]) =>
    s === "ok"
      ? "bg-ok"
      : s === "running"
        ? "bg-ink motion-safe:animate-pulse"
        : s === "waiting"
          ? "bg-line-strong"
          : "bg-urgent";
  return (
    <div role="status" aria-live="polite" className="rounded-card border border-line bg-info-soft p-4 shadow-hero">
      <p className="text-body text-ink">
        <span className="font-mono">{t("anProgress", { n: checked, total })}</span>
        {current && <span className="text-ink-2"> · {t("anCurrent", { name: current.name })}</span>}
      </p>
      <div
        role="progressbar"
        aria-label={t("anProgress", { n: checked, total })}
        aria-valuemin={0}
        aria-valuemax={total}
        aria-valuenow={checked}
        className="mt-2 h-2 overflow-hidden rounded-chip bg-surface"
      >
        <span
          className="block h-full origin-left bg-ink transition-transform duration-bar ease-ts"
          style={{ transform: `scaleX(${total ? Math.max(0.04, checked / total) : 0})` }}
        />
      </div>
      <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1">
        {fields.map((f) => (
          <li key={f.id} className="flex items-center gap-2 text-small text-ink-2">
            <span aria-hidden className={`size-2 rounded-chip ${dot(f.status)}`} />
            <span>
              {f.name}
              <span className="sr-only"> — {label(f.status)}</span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
