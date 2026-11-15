"use client";

import { useQuery } from "@tanstack/react-query";
import { Button } from "@terrasight/ui";
import { CalendarClock } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { api } from "@/lib/api";
import { monthName } from "@/app/fields/[id]/OutlookCard";

interface CompanyOutlook {
  summary: {
    month: string | null;
    withOutlook: number;
    drier: number;
    wetter: number;
    warmer: number;
    cooler: number;
    frostHigher: number;
    heatHigher: number;
  };
}

/** Order breaks ties: dryness and frost first, they matter most for decisions. */
const KEYS = ["drier", "frostHigher", "heatHigher", "warmer", "wetter", "cooler"] as const;

/** Home rail: one line on the next month ("Next month: drier than normal in 3 of 4 fields"), hidden when nothing stands out. */
export function OutlookRailLine({ workspaceId, className = "mt-3" }: { workspaceId: string; className?: string }) {
  const t = useTranslations("App");
  const locale = useLocale();
  const q = useQuery({
    queryKey: ["outlook", workspaceId],
    queryFn: () => api<CompanyOutlook>(`/api/w/${workspaceId}/outlook`),
    retry: false,
    staleTime: 60 * 60_000,
  });
  if (!q.data && q.isError)
    return (
      <p role="alert" className={`${className} flex items-center gap-2 rounded-input bg-muted px-3 py-2 text-caption text-ink`}>
        <span className="flex-1">{t("qsErrShort")}</span>
        <Button variant="link" onClick={() => void q.refetch()} className="text-caption">
          {t("retry")}
        </Button>
      </p>
    );
  const s = q.data?.summary;
  if (!s?.month || s.withOutlook === 0) return null;
  const top = KEYS.map((k) => [k, s[k]] as const).reduce((a, b) => (b[1] > a[1] ? b : a));
  if (top[1] === 0) return null;
  return (
    <p className={`${className} flex items-center gap-2 rounded-input bg-muted px-3 py-2 text-caption text-ink`}>
      <CalendarClock aria-hidden className="size-4 shrink-0 text-ink-2" strokeWidth={1.7} />
      {t(`olRail_${top[0]}`, {
        month: monthName(s.month, locale),
        n: top[1],
        total: s.withOutlook,
      })}
    </p>
  );
}
