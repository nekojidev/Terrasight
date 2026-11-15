"use client";

import { ArrowRight } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";

export interface InsightRowProps {
  icon: ReactNode;
  title: string;
  /** The one number, shown in the mono face (with its unit). */
  value?: string;
  note?: string;
  href: string;
  linkLabel: string;
  className?: string;
}

/** A once-a-season insight as one row; the whole row is the link. */
export function InsightRow({ icon, title, value, note, href, linkLabel, className }: InsightRowProps) {
  return (
    <Link
      href={href}
      className={`focus-ring flex min-h-tap items-center gap-3 rounded-card border border-line bg-surface px-4 py-3 hover:bg-muted ${className ?? ""}`}
    >
      <span aria-hidden className="inline-flex shrink-0 text-ink-2 [&>svg]:size-5 [&>svg]:stroke-[1.7]">
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-baseline gap-x-2">
          <span className="text-body font-semibold text-ink">{title}</span>
          {value && <span className="font-mono text-body text-ink">{value}</span>}
        </span>
        {note && <span className="block text-small text-ink-2">{note}</span>}
      </span>
      <span className="inline-flex shrink-0 items-center gap-1 text-small font-semibold text-ink">
        {linkLabel}
        <ArrowRight aria-hidden strokeWidth={1.7} className="size-4" />
      </span>
    </Link>
  );
}
