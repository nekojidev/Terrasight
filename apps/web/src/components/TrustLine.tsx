"use client";

import { Database, Shield, ShieldAlert, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import type { ReactNode } from "react";
import { useFormat } from "@/lib/useFormat";

export interface TrustLineProps {
  reliability?: "high" | "medium" | "low" | null;
  dataLevel?: "A" | "B" | "C" | null;
  sources?: string[];
  /** ISO date (YYYY-MM-DD or full timestamp) of the newest data used. */
  lastDate?: string | null;
  /** Adds the "≈ estimate" mark. */
  estimate?: boolean;
  /** Makes the whole line a link to the evidence. */
  href?: string;
  /** Makes the whole line a button (when there is no `href`). */
  onClick?: () => void;
  /** Only reliability, data level and the estimate mark (cards, rows). */
  compact?: boolean;
  className?: string;
}

const REL_ICON = { high: ShieldCheck, medium: Shield, low: ShieldAlert } as const;
const REL_KEY = { high: "reliabilityHigh", medium: "reliabilityMedium", low: "reliabilityLow" } as const;
const LEVEL_KEY = { A: "levelA", B: "levelB", C: "levelC" } as const;

/**
 * The one trust line: "Reliability: High · Full data · NASA POWER, USDA CDL · data to 12 Nov".
 * Reliability is plain ink text with a shield icon (never the risk colours); every part has an icon or a word.
 */
export function TrustLine({
  reliability,
  dataLevel,
  sources,
  lastDate,
  estimate,
  href,
  onClick,
  compact,
  className,
}: TrustLineProps) {
  const t = useTranslations("System");
  const fmt = useFormat();
  const parts: ReactNode[] = [];
  if (reliability) {
    const Icon = REL_ICON[reliability];
    parts.push(
      <span key="rel" className="inline-flex items-center gap-1" data-part="reliability">
        <Icon aria-hidden strokeWidth={1.7} className="size-4 shrink-0" />
        {t("reliability")}: {t(REL_KEY[reliability])}
      </span>,
    );
  }
  if (dataLevel) {
    parts.push(
      <span key="lvl" className="inline-flex items-center gap-1" data-part="level">
        <Database aria-hidden strokeWidth={1.7} className="size-4 shrink-0" />
        {t(LEVEL_KEY[dataLevel])}
      </span>,
    );
  }
  if (estimate) {
    parts.push(
      <span key="est" data-part="estimate">
        {t("estimateMark")}
      </span>,
    );
  }
  if (!compact && sources?.length) {
    const shown = sources.slice(0, 2).join(", ");
    const more = sources.length - 2;
    parts.push(
      <span key="src" data-part="sources">
        {shown}
        {more > 0 && ` ${t("moreSources", { n: more })}`}
      </span>,
    );
  }
  if (!compact && lastDate) {
    const zone = lastDate.length === 10 ? { timeZone: "UTC" } : undefined;
    parts.push(
      <span key="date" className="font-mono" data-part="date">
        {t("dataTo", { date: fmt.date(lastDate, "short", zone) })}
      </span>,
    );
  }
  if (!parts.length) return null;

  const body = parts.flatMap((p, i) =>
    i === 0 ? [p] : [<span key={`s${i}`} aria-hidden>·</span>, p],
  );
  const base = `flex flex-wrap items-center gap-x-2 gap-y-1 text-small text-ink-2 ${className ?? ""}`;
  const interactive = `${base} focus-ring min-h-tap rounded-btn hover:text-ink`;
  if (href)
    return (
      <Link href={href} className={interactive} aria-label={undefined} title={t("trustOpen")} data-testid="trust-line">
        {body}
      </Link>
    );
  if (onClick)
    return (
      <button type="button" onClick={onClick} className={`${interactive} text-left`} title={t("trustOpen")} data-testid="trust-line">
        {body}
      </button>
    );
  return (
    <p className={base} data-testid="trust-line">
      {body}
    </p>
  );
}
