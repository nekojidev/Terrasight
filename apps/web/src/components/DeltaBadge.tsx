"use client";

import { clsx } from "clsx";
import { ArrowDown, ArrowUp, Minus } from "lucide-react";
import { useTranslations } from "next-intl";

export interface DeltaBadgeProps {
  /** The signed change, already formatted ("+1.4 °C", "8 days earlier"). */
  value: string;
  direction: "up" | "down" | "flat";
  /** Trend test passed. False is quieter, never hidden: the words "no clear trend" are always there. */
  significant: boolean;
  /** What changed (the metric name); read by screen readers before the value. */
  label: string;
  className?: string;
}

const ICON = { up: ArrowUp, down: ArrowDown, flat: Minus } as const;

/**
 * A change between two periods: value, arrow and the words "clear trend" / "no clear trend". It does not say good or
 * bad (a warmer season is not red, a wetter one not green): neutral ink only; a change without a clear trend is ink-3.
 */
export function DeltaBadge({ value, direction, significant, label, className }: DeltaBadgeProps) {
  const t = useTranslations("Field");
  const Icon = ICON[direction];
  return (
    <span
      data-significant={significant}
      className={clsx(
        "inline-flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5 text-body",
        significant ? "text-ink" : "text-ink-3",
        className,
      )}
    >
      <span className="sr-only">{label}: </span>
      <Icon aria-hidden strokeWidth={significant ? 2.2 : 1.7} className="size-4 shrink-0" />
      <span className={clsx("font-mono", significant && "font-semibold")}>{value}</span>
      <span className="sr-only">{t(`db_${direction}`)}. </span>
      <span className="text-caption">{significant ? t("db_clear") : t("db_none")}</span>
    </span>
  );
}
