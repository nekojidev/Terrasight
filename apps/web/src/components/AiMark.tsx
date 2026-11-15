"use client";

import { Sparkles } from "lucide-react";
import { useTranslations } from "next-intl";

/** Small sparkle after an item written by the assistant; the tooltip says it is worded from the model results. */
export function AiMark({ className }: { className?: string }) {
  const t = useTranslations("App");
  return (
    <span
      title={t("aiMarkTip")}
      aria-label={t("aiMarkTip")}
      role="img"
      className={`ml-2 inline-flex items-center gap-1 align-middle font-mono text-small font-semibold text-ink-3 [&>svg]:size-3.5 ${className ?? ""}`}
    >
      <Sparkles aria-hidden />
      {t("aiMark")}
    </span>
  );
}
