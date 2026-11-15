"use client";

import { useQuery } from "@tanstack/react-query";
import { Skeleton, ErrorCard } from "@terrasight/ui";
import { AlertTriangle, Check, HelpCircle, ShieldCheck, X } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useState } from "react";
import { StatusMark, STATUS_STYLE, useConditionText, useLimitText } from "@/components/TodayWindows";
import { api } from "@/lib/api";
import {
  OPERATIONS,
  workWindowsKey,
  type DayWindows,
  type Operation,
  type WindowStatus,
  type WorkWindowsView,
} from "@/lib/work-windows";

interface Sel {
  fieldId: string;
  op: Operation;
  date: string;
}

const ICON = { good: Check, marginal: AlertTriangle, no: X, unknown: HelpCircle } as const;

/** "Work windows": a week grid per field (days × operations), a filter by operation, tap a day for the limiting factor. */
export function WorkWindowsClient({
  workspaceId,
  units,
}: {
  workspaceId: string;
  units: "metric" | "imperial";
}) {
  const t = useTranslations("App");
  const locale = useLocale() as "en" | "uk";
  const limitText = useLimitText(units);
  const condText = useConditionText(units);
  const [filter, setFilter] = useState<Operation | "all">("all");
  const [sel, setSel] = useState<Sel | null>(null);
  const q = useQuery({
    queryKey: workWindowsKey(workspaceId),
    queryFn: () => api<WorkWindowsView>(`/api/w/${workspaceId}/work-windows?days=7`),
    staleTime: 10 * 60_000,
  });

  const intl = (o: Intl.DateTimeFormatOptions, iso: string) =>
    new Intl.DateTimeFormat(locale === "uk" ? "uk-UA" : "en-US", { timeZone: "UTC", ...o }).format(
      new Date(`${iso}T12:00:00Z`),
    );
  const ops = filter === "all" ? OPERATIONS : [filter];

  return (
    <div className="flex flex-col gap-5">
      <header>
        <h1 className="text-h1 text-ink">{t("wwTitle")}</h1>
        <p className="text-body text-ink-2">{t("wwSub")}</p>
      </header>

      <div role="group" aria-label={t("wwFilter")} className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1">
        {(["all", ...OPERATIONS] as const).map((o) => (
          <button
            key={o}
            type="button"
            aria-pressed={filter === o}
            onClick={() => setFilter(o)}
            className={`min-h-11 shrink-0 rounded-chip border px-4 text-small font-semibold ${
              filter === o ? "border-ink bg-ink text-bg" : "border-line-strong bg-surface text-ink"
            }`}
          >
            {o === "all" ? t("wwAllOps") : t(`wwOp_${o}`)}
          </button>
        ))}
      </div>

      {q.data?.thresholdsUnverified && (
        <p role="note" className="flex items-start gap-2 rounded-input bg-week-soft px-3 py-2 text-small text-week">
          <AlertTriangle aria-hidden className="mt-0.5 size-4 shrink-0" strokeWidth={1.7} />
          {t("wwUnverified")}
        </p>
      )}

      {q.isPending ? (
        <div className="flex flex-col gap-4" aria-busy>
          <Skeleton label="…" className="h-48 w-full rounded-card" />
          <Skeleton label="…" className="h-48 w-full rounded-card" />
        </div>
      ) : q.isError || !q.data ? (
        <ErrorCard title={t("errGeneric")} body="" retryLabel={t("retry")} onRetry={() => void q.refetch()} />
      ) : q.data.fields.length === 0 ? (
        <p className="text-body text-ink-2">{t("wwNone")}</p>
      ) : (
        <ul className="flex flex-col gap-4">
          {q.data.fields.map((f) => {
            const open = sel?.fieldId === f.fieldId ? sel : null;
            const detailOp = open ? f.operations.find((o) => o.operation === open.op) : null;
            const detail: DayWindows | undefined = detailOp?.days.find((d) => d.date === open?.date);
            const crop = f.sowingCrop ? q.data.cropNames[f.sowingCrop]?.[locale] ?? f.sowingCrop : null;
            return (
              <li key={f.fieldId} className="rounded-card border border-line bg-surface p-4 sm:p-5">
                <h2 className="text-h2 text-ink">{f.name}</h2>
                {!f.available ? (
                  <p className="mt-2 text-small text-ink-2">{t("wwUnavail")}</p>
                ) : (
                  <div className="mt-3 flex flex-col gap-4">
                    {ops.map((op) => {
                      const o = f.operations.find((x) => x.operation === op);
                      if (!o) return null;
                      return (
                        <div key={op}>
                          <p className="mb-1.5 text-small font-semibold text-ink">
                            {t(`wwOp_${op}`)}
                            {op === "sowing" && o.applicable && crop && (
                              <span className="font-normal text-ink-2"> · {t("wwSowingFor", { crop })}</span>
                            )}
                          </p>
                          {!o.applicable ? (
                            <p className="text-small text-ink-2">{t("wwNoSowingCrop")}</p>
                          ) : (
                            <div className="grid grid-cols-7 gap-1">
                              {o.days.map((d) => {
                                const Icon = ICON[d.status];
                                const active = open?.op === op && open.date === d.date;
                                return (
                                  <button
                                    key={d.date}
                                    type="button"
                                    aria-pressed={active}
                                    aria-label={t("wwDayAria", {
                                      field: f.name,
                                      op: t(`wwOp_${op}`),
                                      day: intl({ weekday: "long", day: "numeric", month: "long" }, d.date),
                                      status: t(`wwSt_${d.status}`),
                                    })}
                                    onClick={() => setSel(active ? null : { fieldId: f.fieldId, op, date: d.date })}
                                    className={`flex min-h-14 flex-col items-center justify-center gap-0.5 rounded-input border text-center ${STATUS_STYLE[d.status]} ${
                                      active ? "border-ink" : "border-transparent"
                                    }`}
                                  >
                                    <span className="text-micro">{intl({ weekday: "short" }, d.date)}</span>
                                    <Icon aria-hidden className="size-4" strokeWidth={2.2} />
                                  </button>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      );
                    })}
                    {open && detail && (
                      <div className="rounded-input bg-muted p-3" role="status">
                        <p className="flex flex-wrap items-center gap-2 text-small font-semibold text-ink">
                          {t(`wwOp_${open.op}`)} · {intl({ weekday: "long", day: "numeric", month: "long" }, detail.date)}
                          <StatusMark status={detail.status} label={t(`wwSt_${detail.status}`)} />
                        </p>
                        <p className="mt-1 text-small text-ink-2">
                          {detail.status === "unknown" ? t("wwUnknownThreshold") : limitText(detail.limiting)}
                        </p>
                        {(detail.conditions?.length ?? 0) > 0 && (
                          <>
                            <p className="mt-3 text-micro text-ink-2">{t("wwCondTitle")}</p>
                            <ul className="mt-1 flex flex-col gap-1 text-small text-ink">
                              {detail.conditions!.map((c) => (
                                <li key={c.factor}>
                                  {condText(c)}
                                  {!c.verified && <span className="text-ink-3"> · {t("wwUnknownThreshold")}</span>}
                                </li>
                              ))}
                            </ul>
                          </>
                        )}
                        {detail.windows.length > 0 && (
                          <>
                            <p className="mt-3 text-micro text-ink-2">{t("wwWindows")}</p>
                            <ul className="mt-1 flex flex-col gap-1">
                              {detail.windows.map((w) => (
                                <li key={w.from} className="flex flex-wrap items-center gap-2 text-small text-ink">
                                  <span className="font-mono">
                                    {w.from}–{w.to}
                                  </span>
                                  <StatusMark status={w.status as WindowStatus} label={t(`wwSt_${w.status}`)} />
                                  {w.limiting && <span className="text-ink-2">{limitText(w.limiting)}</span>}
                                </li>
                              ))}
                            </ul>
                          </>
                        )}
                      </div>
                    )}
                    {f.forecast && (
                      <p className="text-micro text-ink-3">{f.forecast.attribution}</p>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      <p className="flex items-center gap-2 text-small text-ink-3">
        <ShieldCheck aria-hidden className="size-4 shrink-0" strokeWidth={1.7} />
        {t("wwTapHint")} {t("wwNeutral")}
      </p>
    </div>
  );
}
