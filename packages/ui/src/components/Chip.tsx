import { clsx } from "clsx";
import type { ReactNode } from "react";

export type ChipTone = "urgent" | "week" | "ok" | "signal" | "source" | "neutral" | "info";

const TONE: Record<ChipTone, string> = {
  urgent: "bg-urgent-soft text-urgent",
  week: "bg-week-soft text-week",
  ok: "bg-ok-soft text-ok",
  info: "bg-info-soft text-info",
  // Lime is a fill only; the text stays ink (design/README §1.3).
  signal: "bg-signal text-on-signal",
  source: "bg-muted text-ink-2 font-mono text-[12px] tracking-normal",
  neutral: "bg-muted text-ink",
};

export interface ChipProps {
  tone?: ChipTone;
  icon?: ReactNode;
  children: ReactNode;
  className?: string;
}

export function Chip({ tone = "neutral", icon, children, className }: ChipProps) {
  return (
    <span
      className={clsx(
        "inline-flex min-h-7 items-center gap-1.5 rounded-chip px-3 py-1 text-small font-semibold whitespace-nowrap",
        TONE[tone],
        className,
      )}
    >
      {icon && (
        <span aria-hidden className="inline-flex [&>svg]:size-4 [&>svg]:stroke-[1.7]">
          {icon}
        </span>
      )}
      {children}
    </span>
  );
}
