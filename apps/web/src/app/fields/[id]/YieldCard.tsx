"use client";

import { useQuery } from "@tanstack/react-query";
import { useLocale, useTranslations } from "next-intl";
import { api } from "@/lib/api";

interface YieldRangeView {
  noLibrary: boolean;
  season?: number;
  source?: "plan" | "recommendation" | "current-rotation";
  crop?: string | null;
  cropNames?: { en: string; uk: string } | null;
  range?: { p10: number; p50: number; p90: number; unit: "t/ha"; runs: number; pestLossIncluded: false } | null;
  yieldRef?: number | null;
}

const HA_TO_AC = 2.471054;
const LB_PER_KG = 2.204623;
/** lb per bushel (data/prices.json "about"). */
const LB_PER_BU: Record<string, number> = {
  corn: 56,
  sorghum: 56,
  winter_wheat: 60,
  spring_wheat: 60,
  wheat: 60,
  soybean: 60,
};

/** t/ha → the display unit: bu/ac for US grain and soy in imperial, otherwise t/ha. */
export function toDisplay(
  tPerHa: number,
  crop: string,
  units: "metric" | "imperial",
): { value: number; unit: "t/ha" | "bu/ac" } {
  const lb = LB_PER_BU[crop];
  if (units === "imperial" && lb) return { value: (tPerHa * 1000 * LB_PER_KG) / lb / HA_TO_AC, unit: "bu/ac" };
  return { value: tPerHa, unit: "t/ha" };
}

export function YieldCard({
  workspaceId,
  fieldId,
  units,
}: {
  workspaceId: string;
  fieldId: string;
  units: "metric" | "imperial";
}) {
  const t = useTranslations("App");
  const locale = useLocale();
  const q = useQuery({
    queryKey: ["field", workspaceId, fieldId, "yield-range"],
    queryFn: () => api<YieldRangeView>(`/api/w/${workspaceId}/fields/${fieldId}/yield-range`),
    retry: false,
    staleTime: 5 * 60_000,
  });
  const d = q.data;
  if (!d || d.noLibrary || !d.range || !d.crop) return null;
  const crop = d.crop;
  const name = d.cropNames ? (locale === "uk" ? d.cropNames.uk : d.cropNames.en) : crop;
  const fmt = (v: number) => {
    const x = toDisplay(v, crop, units);
    return new Intl.NumberFormat(locale === "uk" ? "uk-UA" : "en-US", {
      maximumFractionDigits: x.unit === "bu/ac" ? 0 : 1,
    }).format(x.value);
  };
  const { p10, p50, p90 } = d.range;
  const unit = toDisplay(p50, crop, units).unit;
  const mid = ((p50 - p10) / Math.max(p90 - p10, 1e-9)) * 100;
  return (
    <section className="rounded-card border border-line bg-surface p-5" data-testid="yield-card">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-h2 text-ink">{t("ycTitle")}</h2>
        <span className="text-small text-ink-2">
          {t("ycCropSeason", { crop: name, season: d.season ?? "" })} · {t(`ycSrc_${d.source ?? "plan"}`)}
        </span>
      </div>
      <p className="mt-3 text-ink">
        <span className="text-big-number">{fmt(p50)}</span> <span className="text-small text-ink-2">{unit}</span>
        <span className="ml-2 text-small text-ink-2">{t("ycP50")}</span>
      </p>
      <div
        className="relative mt-4 h-2 rounded-full bg-muted"
        role="img"
        aria-label={t("ycRangeAria", { lo: fmt(p10), hi: fmt(p90), unit })}
      >
        <div className="absolute inset-y-0 left-0 right-0 rounded-full bg-ok-soft" />
        <div className="absolute -top-1 h-4 w-1 rounded-full bg-ink" style={{ left: `calc(${mid}% - 2px)` }} />
      </div>
      <div className="mt-2 flex justify-between text-small text-ink-2">
        <span>
          {t("ycP10")} {fmt(p10)}
        </span>
        <span>
          {t("ycP90")} {fmt(p90)}
        </span>
      </div>
      <p className="mt-3 text-small text-ink-2">
        {t("ycBasis", { runs: d.range.runs })}
        {d.yieldRef != null ? ` · ${t("ycRef", { v: fmt(d.yieldRef), unit })}` : ""}
      </p>
      <p className="mt-1 text-small text-ink-2">{t("ycNoPest")}</p>
    </section>
  );
}
