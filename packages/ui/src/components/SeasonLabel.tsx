"use client";

import { clsx } from "clsx";
import { InfoHint } from "./InfoHint";

/**
 * Fills "{year}" and "{prev}" (year − 1) in a localised hint template, e.g.
 * "Season {year}: harvest in {year}. Winter crops are sown in autumn {prev}."
 */
export function seasonHintText(template: string, year: number): string {
  return template.replaceAll("{year}", String(year)).replaceAll("{prev}", String(year - 1));
}

export interface SeasonLabelProps {
  year: number;
  /** Visible text, e.g. "Season 2027". Defaults to the bare year. */
  label?: string;
  /** Localised hint template with {year} / {prev}; the caller owns the copy. */
  hintTemplate: string;
  /** Accessible name of the "i" button. */
  hintLabel: string;
  align?: "start" | "end";
  className?: string;
}

/** A season (named by harvest year) with a hint that explains what the number means. */
export function SeasonLabel({ year, label, hintTemplate, hintLabel, align, className }: SeasonLabelProps) {
  return (
    <span className={clsx("inline-flex items-center gap-1.5", className)}>
      <span className="font-mono">{label ?? year}</span>
      <InfoHint label={hintLabel} {...(align ? { align } : {})}>
        {seasonHintText(hintTemplate, year)}
      </InfoHint>
    </span>
  );
}
