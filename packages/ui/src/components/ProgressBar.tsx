import { clsx } from "clsx";

export type ProgressTone = "ink" | "ok" | "week" | "urgent";

const FILL: Record<ProgressTone, string> = { ink: "bg-ink", ok: "bg-ok", week: "bg-week-mark", urgent: "bg-urgent" };

export interface ProgressBarProps {
  value: number;
  max?: number;
  /** Accessible name; localised by the caller. */
  label: string;
  tone?: ProgressTone;
  className?: string;
}

export function ProgressBar({ value, max = 100, label, tone = "ink", className }: ProgressBarProps) {
  const pct = max > 0 ? Math.min(100, Math.max(0, (value / max) * 100)) : 0;
  return (
    <div
      role="progressbar"
      aria-valuenow={value}
      aria-valuemin={0}
      aria-valuemax={max}
      aria-label={label}
      className={clsx("h-1.5 overflow-hidden rounded-chip bg-line", className)}
    >
      <div
        className={clsx("h-full rounded-chip transition-[width] duration-bar ease-ts", FILL[tone])}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}
