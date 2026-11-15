"use client";

import { PenLine } from "lucide-react";
import { useTranslations } from "next-intl";

/**
 * Visible label next to text the assistant wrote ("AI wording"). Always shown as text (not a hover-only tooltip), so
 * it reads on a phone. The sparkle icon is kept for the assistant itself; this mark uses a pen.
 */
export function AiMark({ className }: { className?: string }) {
  const t = useTranslations("Rec");
  const a = useTranslations("App");
  return (
    <span
      title={a("aiMarkTip")}
      data-testid="ai-mark"
      className={`ml-2 inline-flex items-center gap-1 rounded-chip border border-line-control bg-surface-2 px-2 py-0.5 align-middle text-small font-semibold whitespace-nowrap text-ink-2 [&>svg]:size-3.5 ${className ?? ""}`}
    >
      <PenLine aria-hidden strokeWidth={1.7} />
      {t("ai_mark")}
    </span>
  );
}
