import { clsx } from "clsx";

export type StatusTone = "urgent" | "week" | "ok" | "info" | "muted";

const DOT: Record<StatusTone, string> = {
  urgent: "bg-urgent",
  week: "bg-week-mark",
  ok: "bg-ok",
  info: "bg-info",
  muted: "bg-ink-3",
};

/** A status dot that always carries text for screen readers: status is never colour-only. */
export function StatusDot({ tone, label, className }: { tone: StatusTone; label: string; className?: string }) {
  return (
    <span className={clsx("inline-flex items-center", className)}>
      <span aria-hidden className={clsx("inline-block size-2.5 rounded-chip", DOT[tone])} />
      <span className="sr-only">{label}</span>
    </span>
  );
}
