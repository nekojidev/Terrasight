"use client";

import { useQuery } from "@tanstack/react-query";
import { RailCard } from "@terrasight/ui";
import { AlertTriangle, Check, HelpCircle, X } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { QueryState } from "@/components/QueryState";
import { api } from "@/lib/api";
import {
  OPERATIONS,
  formatCondition,
  formatLimit,
  type Condition,
  workWindowsKey,
  type Limiting,
  type WindowStatus,
  type WorkWindowsView,
} from "@/lib/work-windows";

export const STATUS_STYLE: Record<WindowStatus, string> = {
  good: "bg-ok-soft text-ok",
  marginal: "bg-week-soft text-week",
  no: "bg-urgent-soft text-urgent",
  unknown: "bg-muted text-ink-2",
};

/** Status by icon and word, never by colour alone. */
export function StatusMark({ status, label }: { status: WindowStatus; label: string }) {
  const Icon =
    status === "good" ? Check : status === "marginal" ? AlertTriangle : status === "unknown" ? HelpCircle : X;
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-chip px-2 py-0.5 text-small font-semibold ${STATUS_STYLE[status]}`}
    >
      <Icon aria-hidden className="size-3.5" strokeWidth={2} />
      {label}
    </span>
  );
}

/** Text for a limiting factor, e.g. "wind 7 m/s", "rain in 2 h". */
export function useLimitText(units: "metric" | "imperial") {
  const t = useTranslations("App");
  return (l: Limiting | null) => {
    if (!l) return t("wwNoLimit");
    const f = formatLimit(l, units);
    return t(f.key, { v: f.v, h: f.h });
  };
}

/** Text for one measured condition, e.g. "Wind (max) 7 m/s". */
export function useConditionText(units: "metric" | "imperial") {
  const t = useTranslations("App");
  return (c: Condition) => {
    const f = formatCondition(c, units, "wwCond");
    return (t as unknown as (k: string, v?: Record<string, string>) => string)(f.key, { v: f.v });
  };
}

/**
 * Compact "Today's windows": one row per operation. For one field it shows that field's status and what limits it;
 * for the company it counts the fields that are good today.
 */
export function TodayWindows({
  workspaceId,
  units,
  fieldId,
  rail = false,
  bare = false,
}: {
  workspaceId: string;
  units: "metric" | "imperial";
  fieldId?: string;
  /** Home rail: the shared rail-card frame; otherwise a plain card for the field overview. */
  rail?: boolean;
  /** Home "Next 7 days" strip: rows only, the parent supplies the frame, title and the link to the full page. */
  bare?: boolean;
}) {
  const t = useTranslations("App");
  const limitText = useLimitText(units);
  const condText = useConditionText(units);
  const q = useQuery({
    queryKey: workWindowsKey(workspaceId, fieldId),
    queryFn: () =>
      api<WorkWindowsView>(
        fieldId
          ? `/api/w/${workspaceId}/fields/${fieldId}/work-windows?days=7`
          : `/api/w/${workspaceId}/work-windows?days=7`,
      ),
    staleTime: 10 * 60_000,
  });
  const fields = (q.data?.fields ?? []).filter((f) => f.available);

  const rows = OPERATIONS.map((op) => {
    const per = fields.flatMap((f) => {
      const o = f.operations.find((x) => x.operation === op);
      return o?.applicable && o.days[0] ? [o.days[0]] : [];
    });
    if (!per.length) return null;
    const good = per.filter((d) => d.status === "good").length;
    const known = per.filter((d) => d.status !== "unknown");
    const status: WindowStatus =
      known.length === 0 ? "unknown" : good === known.length ? "good" : good > 0 || per.some((d) => d.status === "marginal") ? "marginal" : "no";
    const first = per.find((d) => d.status !== "good")?.limiting ?? null;
    const conditions = per[0]?.conditions ?? [];
    return { op, status, good, total: per.length, limiting: first, conditions };
  }).filter((r): r is NonNullable<typeof r> => r !== null);

  const body = (
    <>
      {q.data === undefined ? (
        <QueryState query={q} skeletonVariant="text" what={t("wwToday")} className="w-full">
          {() => null}
        </QueryState>
      ) : rows.length === 0 ? (
        <p className="text-small text-ink-2">{t("wwUnavail")}</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {rows.map((r) => (
            <li key={r.op} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
              <span className="text-small text-ink">{t(`wwOp_${r.op}`)}</span>
              <span className="flex flex-wrap items-center gap-2">
                <StatusMark status={r.status} label={t(`wwSt_${r.status}`)} />
                <span className="text-small text-ink-2">
                  {r.status === "unknown"
                    ? [
                        t("wwUnknownThreshold"),
                        ...(fieldId ? r.conditions.map((c) => condText(c)) : []),
                      ].join(" · ")
                    : fieldId
                    ? r.status === "good"
                      ? ""
                      : limitText(r.limiting)
                    : t("wwFieldsGood", { n: r.good, total: r.total })}
                </span>
              </span>
            </li>
          ))}
        </ul>
      )}
      {q.data?.thresholdsUnverified && rows.length > 0 && (
        <p className="mt-3 text-caption text-ink-3">{t("wwUnverified")}</p>
      )}
      {!bare && (
        <Link
          href="/work-windows"
          className="focus-ring mt-3 inline-flex min-h-tap items-center text-small font-semibold text-ink underline"
        >
          {t("wwSeeWeek")}
        </Link>
      )}
    </>
  );
  if (bare) return body;
  return rail ? (
    <RailCard title={t("wwToday")}>{body}</RailCard>
  ) : (
    <section className="rounded-card border border-line bg-surface p-5">
      <h2 className="text-h2 mb-3 text-ink">{t("wwToday")}</h2>
      {body}
    </section>
  );
}
