"use client";

import { useQuery } from "@tanstack/react-query";
import { Chip, InfoHint, PageContainer, Surface, seasonHintText, type ChipTone } from "@terrasight/ui";
import { Ban, Check, ChevronRight, CircleDashed, ShieldAlert, Sparkles } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import type { ReactNode } from "react";
import { QueryState } from "@/components/QueryState";
import { api } from "@/lib/api";
import { useFormat } from "@/lib/useFormat";
import { LandChip, type LandView } from "@/components/LandSuitability";
import { planStatus, type PlanStatus } from "../fields/[id]/rotation/rotationView";

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
    suitability?: LandView | null;
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

const STATUS: Record<PlanStatus, { key: string; tone: ChipTone; icon: ReactNode }> = {
  saved: { key: "status_saved", tone: "ok", icon: <Check /> },
  proposed: { key: "status_proposed", tone: "info", icon: <Sparkles /> },
  none: { key: "status_none", tone: "neutral", icon: <CircleDashed /> },
  unsuitable: { key: "status_unsuitable", tone: "urgent", icon: <ShieldAlert /> },
  "no-library": { key: "status_nolib", tone: "neutral", icon: <Ban /> },
};

/** "Plan": every field's decision for the next season and the way into its options. Table on desktop, cards on a phone. */
export function RotationsOverview({ workspaceId, units }: { workspaceId: string; units: "metric" | "imperial" }) {
  const t = useTranslations("App");
  const r = useTranslations("Rotation");
  const locale = useLocale() as "en" | "uk";
  const fmt = useFormat({ units });
  const router = useRouter();
  const q = useQuery({
    queryKey: ["rotations", workspaceId],
    queryFn: () => api<Overview>(`/api/w/${workspaceId}/rotations`),
  });

  return (
    <PageContainer className="flex flex-col gap-6 px-0 sm:px-0">
      <header>
        <h1 className="text-h1 text-ink">{r("plan_title")}</h1>
        {q.data && (
          <p className="text-body text-ink-2">
            {t("rvSub", { season: q.data.season, from: q.data.horizon[0], to: q.data.horizon[1] })}{" "}
            <InfoHint label={t("hintLabel")}>
              {seasonHintText(t("hintSeason"), q.data.season)} {t("hintHorizon")}
            </InfoHint>
          </p>
        )}
      </header>
      <QueryState
        query={q}
        skeletonVariant="rows"
        what={r("plan_what")}
        isEmpty={(d) => d.fields.length === 0}
        empty={{
          text: r("plan_empty"),
          actionLabel: r("plan_empty_action"),
          onAction: () => router.push("/fields/new"),
        }}
      >
        {(overview) => {
          const crop = (id: string | null) =>
            id ? (overview.cropNames[id]?.[locale] ?? r("crop_unknown")) : "—";
          const rows = overview.fields.map((f) => {
            const status = planStatus(f);
            const rec = f.recommendation;
            const next =
              status === "saved" && f.plan
                ? crop(f.plan.crop)
                : status === "proposed" && rec
                  ? rec.bestOption === "current"
                    ? t("rvKeep")
                    : crop(rec.firstCrop)
                  : "—";
            const decideBy =
              status === "proposed" && rec?.deadline
                ? t("rvDecideBy", {
                    date: fmt.date(`${rec.deadline}T12:00:00Z`, "full", { timeZone: "UTC" }),
                  })
                : null;
            return { f, status, next, decideBy };
          });
          const chip = (status: PlanStatus) => (
            <Chip tone={STATUS[status].tone} icon={STATUS[status].icon}>
              {r(STATUS[status].key)}
            </Chip>
          );
          const meta = (f: Overview["fields"][number]) =>
            [fmt.area(f.areaHa), f.county].filter(Boolean).join(" · ");
          return (
            <>
              <Surface pad="none" className="hidden overflow-x-auto md:block">
                <table className="w-full text-body">
                  <caption className="sr-only">{r("plan_table")}</caption>
                  <thead>
                    <tr className="text-left text-caption text-ink-2">
                      <th scope="col" className="p-4 font-semibold">
                        {r("plan_col_field")}
                      </th>
                      <th scope="col" className="p-4 font-semibold">
                        {r("plan_col_next")}
                      </th>
                      <th scope="col" className="p-4 font-semibold">
                        {r("plan_col_status")}
                      </th>
                      <th scope="col" className="p-4 text-right font-semibold">
                        <span className="sr-only">{r("plan_col_open")}</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map(({ f, status, next, decideBy }, i) => (
                      <tr
                        key={f.fieldId}
                        className="animate-rise stagger border-t border-line"
                        style={{ "--i": i } as React.CSSProperties}
                      >
                        <th scope="row" className="p-4 text-left font-normal">
                          <span className="flex flex-wrap items-center gap-2 font-semibold text-ink">
                            {f.name}
                            <LandChip
                              status={f.suitability?.status}
                              overridden={Boolean(f.suitability?.override)}
                            />
                          </span>
                          <span className="block text-caption text-ink-2">{meta(f)}</span>
                        </th>
                        <td className="p-4 text-ink">
                          <span className="font-semibold">{next}</span>
                          {decideBy && <span className="block text-caption text-ink-2">{decideBy}</span>}
                        </td>
                        <td className="p-4">{chip(status)}</td>
                        <td className="p-4 text-right">
                          <Link
                            href={`/fields/${f.fieldId}/rotation`}
                            aria-label={r("plan_open", { name: f.name })}
                            className="focus-ring inline-flex min-h-tap items-center gap-1 rounded-btn px-2 text-body font-semibold text-ink"
                          >
                            {t("rvOpen")}
                            <ChevronRight aria-hidden className="size-4" />
                          </Link>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </Surface>

              <ul className="flex flex-col gap-3 md:hidden">
                {rows.map(({ f, status, next, decideBy }, i) => (
                  <li key={f.fieldId} className="animate-rise stagger" style={{ "--i": i } as React.CSSProperties}>
                    <Surface pad="sm" className="flex flex-col gap-3">
                      <div>
                        <p className="flex flex-wrap items-center gap-2 text-body font-semibold text-ink">
                          {f.name}
                          <LandChip status={f.suitability?.status} overridden={Boolean(f.suitability?.override)} />
                        </p>
                        <p className="text-caption text-ink-2">{meta(f)}</p>
                      </div>
                      <div>
                        <p className="text-caption text-ink-2">{r("plan_col_next")}</p>
                        <p className="text-body font-semibold text-ink">{next}</p>
                        {decideBy && <p className="text-caption text-ink-2">{decideBy}</p>}
                      </div>
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        {chip(status)}
                        <Link
                          href={`/fields/${f.fieldId}/rotation`}
                          aria-label={r("plan_open", { name: f.name })}
                          className="focus-ring inline-flex min-h-tap items-center gap-1 rounded-btn px-2 text-body font-semibold text-ink"
                        >
                          {t("rvOpen")}
                          <ChevronRight aria-hidden className="size-4" />
                        </Link>
                      </div>
                    </Surface>
                  </li>
                ))}
              </ul>
            </>
          );
        }}
      </QueryState>
    </PageContainer>
  );
}
