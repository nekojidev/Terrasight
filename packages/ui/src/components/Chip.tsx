import { clsx } from "clsx";
import type { ReactNode } from "react";

export type ChipTone = "urgent" | "week" | "ok" | "signal" | "source" | "neutral" | "info" | "estimate";

const TONE: Record<ChipTone, string> = {
  urgent: "bg-urgent-soft text-urgent",
  week: "bg-week-soft text-week",
  ok: "bg-ok-soft text-ok",
  info: "bg-info-soft text-info",
  // Lime is a fill only; the text stays ink (design/README §1.3).
  signal: "bg-signal text-on-signal",
  source: "bg-muted text-ink-2 font-mono text-[12px] tracking-normal",
  neutral: "bg-muted text-ink",
  // Estimate = not measured: dashed outline, no fill, ink text. Deliberately not orange (design/README v6 colour table).
  estimate: "border border-dashed border-line-control bg-transparent text-ink-2",
};

export interface ChipProps {
  tone?: ChipTone;
  icon?: ReactNode;
  children: ReactNode;
  className?: string;
  /** Makes the chip a button (44 px tap area, visual size unchanged). */
  onClick?: () => void;
  /** Pressed state for toggle chips (filters). */
  pressed?: boolean;
}

export function Chip({ tone = "neutral", icon, children, className, onClick, pressed }: ChipProps) {
  const Tag = onClick ? "button" : "span";
  return (
    <Tag
      {...(onClick ? { type: "button" as const, onClick, "aria-pressed": pressed } : {})}
      className={clsx(
        "inline-flex min-h-7 items-center gap-1.5 rounded-chip px-3 py-1 text-small font-semibold whitespace-nowrap",
        TONE[tone],
        onClick &&
          "focus-ring relative cursor-pointer after:absolute after:inset-x-0 after:top-1/2 after:h-11 after:-translate-y-1/2 after:content-['']",
        className,
      )}
    >
      {icon && (
        <span aria-hidden className="inline-flex [&>svg]:size-4 [&>svg]:stroke-[1.7]">
          {icon}
        </span>
      )}
      {children}
    </Tag>
  );
}
