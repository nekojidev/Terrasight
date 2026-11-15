"use client";

import type { FarmStress } from "@terrasight/shared";
import { Button } from "@terrasight/ui";
import { CloudLightning } from "lucide-react";
import { useTranslations } from "next-intl";
import { InsightRow } from "@/components/InsightRow";
import { useFormat } from "@/lib/useFormat";

/** Where the full farm stress test lives (rendered there by the Plan page). */
export const STRESS_HREF = "/rotation#stress";

/**
 * The farm stress test on Today as ONE line (a once-a-season figure): "If 2022 weather returns, the recommended plan
 * puts $4,643 less at risk · Details". Loading and failure stay quiet and inline. The numbers are the API's, unchanged.
 */
export function FarmStressLine({
  data,
  isLoading,
  isError,
  onRetry,
  units = "metric",
}: {
  data: FarmStress | undefined;
  isLoading: boolean;
  isError: boolean;
  onRetry: () => void;
  units?: "metric" | "imperial";
}) {
  const m = useTranslations("Main");
  const a = useTranslations("App");
  const t = m as unknown as (key: string, values?: Record<string, string | number>) => string;
  const fmt = useFormat({ units });

  if (!data && isError)
    return (
      <p role="alert" className="flex items-center gap-2 rounded-input bg-muted px-3 py-2 text-caption text-ink">
        <span className="flex-1">{m("t_st_err")}</span>
        <Button variant="link" onClick={onRetry} className="min-h-tap text-caption">
          {a("retry")}
        </Button>
      </p>
    );
  if (!data || isLoading)
    return (
      <p className="rounded-input bg-muted px-3 py-2 text-caption text-ink-2" aria-busy>
        {m("t_st_loading")}
      </p>
    );

  const money = (n: number) => fmt.money(n, (data.currency ?? "USD") as "USD" | "UAH");
  let note: string;
  if (
    data.status === "unavailable" ||
    !data.current ||
    !data.recommended ||
    data.difference === null ||
    data.counted.length === 0
  )
    note = m("t_st_none");
  else {
    const samePlans = data.counted.every((f) => f.currentLoss === f.recommendedLoss);
    const { difference } = data;
    note =
      difference > 0 && !samePlans
        ? t("t_st_better", { amount: money(difference) })
        : difference < 0
          ? t("t_st_worse", { amount: money(-difference) })
          : t("t_st_same", { amount: money(data.current.atRisk) });
  }
  return (
    <InsightRow
      icon={<CloudLightning />}
      title={m("t_st_title", { year: data.stressYear })}
      note={note}
      href={STRESS_HREF}
      linkLabel={m("t_st_link")}
    />
  );
}
