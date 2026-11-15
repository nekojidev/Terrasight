"use client";

import { Button, FieldThumb } from "@terrasight/ui";
import { AlertTriangle, Check, Circle, Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useRef, useState, type ReactNode } from "react";

export type GatherTaskStatus = "queued" | "running" | "done" | "partial" | "failed" | "cached";
export interface GatherFocusStatus {
  status: string;
  startedAt?: string | null;
  sources: Array<{ source: string; label: string; status: GatherTaskStatus; reason: string | null }>;
}

/** Typical durations in seconds (sources run in parallel; MODIS NDVI is the slow one, ~2 min). */
const TYPICAL_S: Record<string, number> = {
  power: 25,
  cdl: 10,
  ssurgo: 10,
  soilgrids: 15,
  modis: 120,
  dem: 10,
  sentinel2: 45,
  openet: 30,
  cropland: 10,
  wapor: 30,
};
/** Friendly step key (App.gf_<key> and gf_<key>_d). Unknown sources fall back to the API label. */
const STEP_KEY: Record<string, string> = {
  power: "power",
  cdl: "cdl",
  sentinel2: "s2",
  ssurgo: "soil",
  soilgrids: "soil",
  modis: "modis",
  openet: "openet",
  cropland: "cropland",
  wapor: "wapor",
  dem: "dem",
};

const isOpen = (s: GatherTaskStatus) => s === "queued" || s === "running";
const typical = (source: string) => TYPICAL_S[source] ?? 30;

/** True while the field's first history build is running: the page switches to the focused mode. */
export function isFirstBuild(status: GatherFocusStatus | null | undefined, built: boolean): boolean {
  return status?.status === "running" && !built;
}

/** Seconds left, from the slowest unfinished source; null when nothing is left to estimate. */
export function etaSeconds(status: GatherFocusStatus, elapsedS: number): number | null {
  const open = status.sources.filter((s) => isOpen(s.status));
  if (open.length === 0) return null;
  return Math.max(...open.map((s) => typical(s.source))) - elapsedS;
}

export function progressFraction(status: GatherFocusStatus): number {
  const total = status.sources.reduce((a, s) => a + typical(s.source), 0);
  if (total === 0) return 0;
  const done = status.sources.filter((s) => !isOpen(s.status)).reduce((a, s) => a + typical(s.source), 0);
  return done / total;
}

function fmt(s: number): string {
  const n = Math.max(0, Math.round(s));
  return `${Math.floor(n / 60)}:${String(n % 60).padStart(2, "0")}`;
}

const ICON: Record<GatherTaskStatus, ReactNode> = {
  queued: <Circle aria-hidden className="size-4 text-ink-3" />,
  running: <Loader2 aria-hidden className="size-4 text-ink motion-safe:animate-spin" />,
  done: <Check aria-hidden className="size-4 text-ok" />,
  cached: <Check aria-hidden className="size-4 text-ok" />,
  partial: <AlertTriangle aria-hidden className="size-4 text-week" />,
  failed: <AlertTriangle aria-hidden className="size-4 text-urgent" />,
};

/**
 * Hero panel for the first history build ("Building this field's history"): overall progress, per-source steps,
 * elapsed time and an ETA. After the build it shows a short success state, then disappears.
 * `building` is true while the first build runs; the caller dims the rest of the page meanwhile.
 */
export function GatherFocus({
  status,
  building,
  fieldName,
  outline,
  canEdit,
  onRetry,
}: {
  status: GatherFocusStatus | null | undefined;
  building: boolean;
  fieldName: string;
  outline: string | null;
  canEdit: boolean;
  onRetry: (source: string) => void;
}) {
  const t = useTranslations("App");
  const [elapsed, setElapsed] = useState(0);
  const [success, setSuccess] = useState(false);
  const was = useRef(false);

  const started = status?.startedAt ? new Date(status.startedAt).getTime() : null;
  useEffect(() => {
    if (!building) return;
    const tick = () => setElapsed(Math.max(0, (Date.now() - (started ?? Date.now())) / 1000));
    tick();
    const h = setInterval(tick, 1000);
    return () => clearInterval(h);
  }, [building, started]);

  useEffect(() => {
    if (was.current && !building) {
      was.current = false;
      setSuccess(true);
      const h = setTimeout(() => setSuccess(false), 5000);
      return () => clearTimeout(h);
    }
    was.current = building;
    return undefined;
  }, [building]);

  if (!status || (!building && !success)) return null;

  const problems = status.sources.filter((s) => s.status === "failed" || s.status === "partial");
  if (!building) {
    return (
      <section
        role="status"
        aria-live="polite"
        className="flex items-center gap-3 rounded-card border border-line bg-ok-soft p-5 motion-safe:animate-rise"
      >
        <Check aria-hidden className="size-5 text-ok" />
        <p className="text-body text-ink">{problems.length ? t("gfDoneProblems") : t("gfDone")}</p>
      </section>
    );
  }

  const pct = Math.max(0.04, progressFraction(status));
  const finished = status.sources.filter((s) => !isOpen(s.status)).length;
  const eta = etaSeconds(status, elapsed);
  const etaText = eta === null ? t("gfFinishing") : eta > 5 ? t("gfEta", { time: fmt(eta) }) : t("gfLonger");
  const steps = t("gfStepsOf", { n: finished, total: status.sources.length });
  return (
    <section aria-busy="true" className="rounded-card border border-line bg-surface p-5 shadow-hero">
      <div className="flex items-center gap-4">
        <FieldThumb name={fieldName} outline={outline} crop={null} size={64} />
        <div className="min-w-0 flex-1">
          <h2 className="text-h2 text-ink">{t("gfTitle")}</h2>
          <p className="text-body text-ink-2">{t("gfSub", { name: fieldName })}</p>
        </div>
      </div>
      <div
        role="progressbar"
        aria-label={t("gfTitle")}
        aria-valuemin={0}
        aria-valuemax={status.sources.length}
        aria-valuenow={finished}
        aria-valuetext={steps}
        className="mt-4 h-2 overflow-hidden rounded-chip bg-muted"
      >
        <span
          className="block h-full origin-left bg-ink transition-transform duration-bar ease-ts"
          style={{ transform: `scaleX(${pct})` }}
        />
      </div>
      <p className="mt-2 flex flex-wrap justify-between gap-2 font-mono text-small text-ink-2">
        <span role="status" aria-live="polite">
          {steps}
        </span>
        <span>
          {t("gfElapsed", { time: fmt(elapsed) })} · {etaText}
        </span>
      </p>
      <ul className="mt-3 flex flex-col divide-y divide-line">
        {status.sources.map((s) => {
          const key = STEP_KEY[s.source];
          const bad = s.status === "failed" || s.status === "partial";
          return (
            <li key={s.source} className="flex min-h-tap items-center gap-3 py-2">
              {ICON[s.status]}
              <span className="flex-1">
                <span className="block text-body text-ink">{key ? t(`gf_${key}`) : s.label}</span>
                <span className="block text-small text-ink-2">
                  {bad ? (s.reason ?? t(`st_${s.status}`)) : key ? t(`gf_${key}_d`) : ""}
                </span>
              </span>
              <span className="font-mono text-small text-ink-2">{t(`st_${s.status}`)}</span>
              {canEdit && bad && (
                <Button size={44} variant="outline" onClick={() => onRetry(s.source)}>
                  {t("retry")}
                </Button>
              )}
            </li>
          );
        })}
      </ul>
      <p className="mt-3 text-small text-ink-3">{t("gfHint")}</p>
    </section>
  );
}
