"use client";

import { ProgressBar, StatusDot, Surface } from "@terrasight/ui";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { useFormat } from "@/lib/useFormat";

export interface FocusField {
  id: string;
  name: string;
  status: "waiting" | "running" | "ok" | "stale" | "failed";
}

/** Whole seconds since `startedAt` (ISO), ticking once a second while mounted. Null until mounted. */
function useElapsed(startedAt: string | undefined): number | null {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  if (now === null) return null;
  const start = startedAt ? Date.parse(startedAt) : now;
  return Math.max(0, Math.round((now - (Number.isNaN(start) ? now : start)) / 1000));
}

/**
 * The long-operation pattern while "Analyze fields" runs: progress bar, "N of M fields", elapsed time, the usual
 * duration and "safe to leave, we will notify you".
 */
export function AnalysisFocus({ fields, startedAt }: { fields: FocusField[]; startedAt?: string }) {
  const t = useTranslations("App");
  const m = useTranslations("Main");
  const f = useFormat();
  const elapsed = useElapsed(startedAt);
  const total = fields.length;
  const checked = fields.filter((x) => x.status !== "waiting" && x.status !== "running").length;
  const current = fields.find((x) => x.status === "running");
  const label = (s: FocusField["status"]) =>
    s === "ok" ? t("anOk") : s === "running" ? t("anRunning") : s === "waiting" ? t("anWaiting") : t("anProblem");
  const tone = (s: FocusField["status"]) =>
    s === "ok" ? "ok" : s === "running" ? "info" : s === "waiting" ? "muted" : "urgent";
  const clock =
    elapsed === null ? null : `${f.number(Math.floor(elapsed / 60))}:${String(elapsed % 60).padStart(2, "0")}`;
  return (
    <Surface tone="inset" pad="sm" role="status" aria-live="polite" className="animate-fade">
      <p className="flex flex-wrap items-baseline justify-between gap-x-3 text-body text-ink">
        <span className="font-semibold">{m("an_progress", { n: checked, total })}</span>
        {clock && <span className="font-mono text-caption text-ink-2">{m("an_elapsed", { time: clock })}</span>}
      </p>
      <ProgressBar
        value={checked}
        max={Math.max(total, 1)}
        label={m("an_progress", { n: checked, total })}
        className="mt-2"
      />
      {current && <p className="mt-2 text-caption text-ink-2">{t("anCurrent", { name: current.name })}</p>}
      <p className="mt-2 text-caption text-ink-2">{m("an_usual")}</p>
      <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1">
        {fields.map((x) => (
          <li key={x.id} className="flex items-center gap-2 text-caption text-ink-2">
            <StatusDot tone={tone(x.status)} label={label(x.status)} />
            <span>
              {x.name} <span className="text-ink-3">· {label(x.status)}</span>
            </span>
          </li>
        ))}
      </ul>
    </Surface>
  );
}
