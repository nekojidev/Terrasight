"use client";

import { Chip, InfoHint, SeasonStrip, seasonHintText } from "@terrasight/ui";
import { ChevronRight, RefreshCw } from "lucide-react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";

type Localised = { en: string; uk: string };
export interface Overview {
  season: number;
  horizon: [number, number];
  cropNames: Record<string, Localised>;
  fields: Array<{
    fieldId: string;
    name: string;
    areaHa: number;
    county: string | null;
    irrigation: string;
    hasLibrary: boolean;
    recent: Array<{ season: number; crop: string }>;
    plan: { crop: string; rotationId: string | null } | null;
    recommendation: {
      level: string;
      firstCrop: string | null;
      bestOption: string | null;
      deadline: string | null;
    } | null;
  }>;
}

const AC = 2.471054;

export function RotationsOverview({ overview, units }: { overview: Overview; units: "metric" | "imperial" }) {
  const t = useTranslations("App");
  const locale = useLocale() as "en" | "uk";
  const crop = (id: string | null) => (id ? (overview.cropNames[id]?.[locale] ?? id) : "—");
  const date = (iso: string) =>
    new Intl.DateTimeFormat(locale === "uk" ? "uk-UA" : "en-US", {
      timeZone: "UTC",
      day: "numeric",
      month: "long",
      year: "numeric",
    }).format(new Date(`${iso}T12:00:00Z`));
  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="text-h1 text-ink">{t("rvTitle")}</h1>
        <p className="text-body text-ink-2">
          {t("rvSub", { season: overview.season, from: overview.horizon[0], to: overview.horizon[1] })}{" "}
          <InfoHint label={t("hintLabel")}>
            {seasonHintText(t("hintSeason"), overview.season)} {t("hintHorizon")}
          </InfoHint>
        </p>
      </header>
      <ul className="flex flex-col divide-y divide-line rounded-card border border-line bg-surface">
        {overview.fields.map((f) => {
          const area =
            units === "imperial" ? `${(f.areaHa * AC).toFixed(0)} ac` : `${f.areaHa.toFixed(1)} ha`;
          const rec = f.recommendation;
          return (
            <li key={f.fieldId}>
              <Link
                href={`/fields/${f.fieldId}/rotation`}
                className="focus-ring flex flex-wrap items-center gap-4 p-4 hover:bg-muted"
              >
                <span className="min-w-48 flex-1">
                  <span className="block text-body font-semibold text-ink">{f.name}</span>
                  <span className="block text-small text-ink-2">
                    {[area, f.county].filter(Boolean).join(" · ")}
                  </span>
                </span>
                <SeasonStrip
                  size="sm"
                  seasons={f.recent.map((s) => ({ crop: s.crop, name: crop(s.crop), year: s.season }))}
                  label={t("rvLast")}
                />
                <span className="min-w-64">
                  {!f.hasLibrary ? (
                    <span className="text-small text-ink-3">{t("rvNoLibrary")}</span>
                  ) : f.plan ? (
                    <Chip tone="signal">
                      {t("rvPlan", { season: overview.season, crop: crop(f.plan.crop) })}
                    </Chip>
                  ) : rec ? (
                    <span className="flex flex-col gap-1">
                      <span className="text-small font-semibold text-ink">
                        {rec.bestOption === "current"
                          ? t("rvKeep")
                          : t("rvRecommended", { crop: crop(rec.firstCrop) })}
                      </span>
                      {rec.deadline && (
                        <span className="text-small text-ink-2">
                          {t("rvDecideBy", { date: date(rec.deadline) })}
                        </span>
                      )}
                    </span>
                  ) : (
                    <span className="text-small text-ink-3">{t("rvNone")}</span>
                  )}
                </span>
                <span className="flex items-center gap-1 text-small font-semibold text-ink">
                  <RefreshCw aria-hidden className="size-4" strokeWidth={1.7} />
                  {t("rvOpen")}
                  <ChevronRight aria-hidden className="size-4" />
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
