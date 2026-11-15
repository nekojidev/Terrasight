"use client";

import { useQuery } from "@tanstack/react-query";
import { Button, InfoHint, Skeleton, Surface, Tabs } from "@terrasight/ui";
import { AlertTriangle, Check, HelpCircle, ShieldCheck, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { QueryState } from "@/components/QueryState";
import { STATUS_STYLE } from "@/components/TodayWindows";
import { api } from "@/lib/api";
import { useFormat } from "@/lib/useFormat";
import {
  OPERATIONS,
  bestDay,
  factorText,
  hasVerdict,
  unitsForCountry,
  workWindowsKey,
  type Limiting,
  type Operation,
  type WindowStatus,
  type WorkWindowsView,
} from "@/lib/work-windows";

interface Sel {
  fieldId: string;
  date: string;
}

const ICON = { good: Check, marginal: AlertTriangle, no: X, unknown: HelpCircle } as const;
const STATUSES: WindowStatus[] = ["good", "marginal", "no", "unknown"];

/**
 * "Work windows": pick one operation, then read a matrix of fields (rows) by the next 7 days (columns). Each cell is an
 * icon, a colour and an accessible label; opening a cell lists the reasons with values in the company's units.
 */
export function WorkWindowsClient({
  workspaceId,
  units,
}: {
  workspaceId: string;
  units: "metric" | "imperial";
}) {
  const t = useTranslations("App");
  const w = useTranslations("Zones");
  const router = useRouter();
  const fmt = useFormat({ units });
  const fmtMetric = useFormat({ units: "metric" });
  const fmtImperial = useFormat({ units: "imperial" });
  // Screens follow each field's country (US = imperial); the company setting is only the default.
  const fmtFor = (country: string | null | undefined) =>
    unitsForCountry(country, units) === "imperial" ? fmtImperial : fmtMetric;
  const locale = fmt.locale;
  const [op, setOp] = useState<Operation>("spraying");
  const [sel, setSel] = useState<Sel | null>(null);
  const q = useQuery({
    queryKey: workWindowsKey(workspaceId),
    queryFn: () => api<WorkWindowsView>(`/api/w/${workspaceId}/work-windows?days=7`),
    staleTime: 10 * 60_000,
  });

  // ISO dates are calendar days: format them in UTC so no zone shifts them.
  const day = (iso: string, style: "dayMonth" | "full" = "dayMonth") =>
    fmt.date(`${iso}T12:00:00Z`, style, { timeZone: "UTC" });
  const status = (s: WindowStatus) => w(`ww5_st_${s}`);
  const factor = (l: Limiting, prefix: "wwLim" | "wwCond", country?: string | null) => {
    const f = factorText(l, fmtFor(country), prefix);
    return t(f.key as "wwLim_wind", { v: f.v, h: f.h });
  };
  const limitText = (l: Limiting | null, country?: string | null) =>
    l ? factor(l, "wwLim", country) : t("wwNoLimit");
  const condText = (l: Limiting, country?: string | null) => {
    const f = factorText(l, fmtFor(country), "wwCond");
    return t.has(f.key as "wwCond_wind")
      ? t(f.key as "wwCond_wind", { v: f.v })
      : factor(l, "wwLim", country);
  };
  // The API sends the Open-Meteo credit in English only; show it in the interface language.
  const attribution = (raw: string) => (/open-meteo/i.test(raw) ? w("ww6_attribution") : raw);

  return (
    <div className="flex flex-col gap-5">
      <header>
        <h1 className="text-h1 text-ink">{t("wwTitle")}</h1>
        <p className="text-body text-ink-2">{t("wwSub")}</p>
      </header>

      <Tabs
        label={t("wwFilter")}
        value={op}
        onChange={(id) => {
          setOp(id as Operation);
          setSel(null);
        }}
        items={OPERATIONS.map((o) => ({
          id: o,
          label: o === "traffic" ? w("ww6_opShort_traffic") : t(`wwOp_${o}`),
        }))}
      />

      <div role="tabpanel" className="flex flex-col gap-4">
        <ul aria-label={w("ww5_keyLabel")} className="flex flex-wrap gap-x-4 gap-y-2">
          {STATUSES.map((s) => {
            const Icon = ICON[s];
            return (
              <li key={s} className="flex items-center gap-2 text-caption text-ink-2">
                <span
                  className={`inline-flex size-6 items-center justify-center rounded-input ${STATUS_STYLE[s]}`}
                >
                  <Icon aria-hidden className="size-4" strokeWidth={2.2} />
                </span>
                {status(s)}
              </li>
            );
          })}
        </ul>

        <QueryState
          query={q}
          what={w("ww5_what")}
          skeleton={<Skeleton variant="rows" rows={4} label={w("ww5_loading")} />}
          isEmpty={(d) => d.fields.length === 0}
          empty={{
            text: t("wwNone"),
            actionLabel: w("ww5_addField"),
            onAction: () => router.push("/fields/new"),
          }}
        >
          {(data) => {
            const days =
              data.fields.find((f) => f.available)?.operations.find((o) => o.operation === op)?.days ?? [];
            const open = sel ? data.fields.find((f) => f.fieldId === sel.fieldId) : undefined;
            const detail = open?.operations
              .find((o) => o.operation === op)
              ?.days.find((d) => d.date === sel?.date);
            const best = bestDay(data.fields, op);
            const opName = w(`ww6_opFor_${op}`);
            const anyVerdict = data.fields.some((f) => hasVerdict(f, op));
            return (
              <>
                {anyVerdict && (
                  <p role="status" className="text-h3 text-ink">
                    {best
                      ? w("ww6_best", {
                          op: opName,
                          day: day(best.date, "full"),
                          good: best.good,
                          total: best.total,
                        })
                      : w("ww6_bestNone", { op: opName })}
                  </p>
                )}
                <Surface pad="none" className="overflow-hidden">
                  <div
                    className="overflow-x-auto"
                    tabIndex={0}
                    role="region"
                    aria-label={w("ww5_tableLabel", { op: t(`wwOp_${op}`) })}
                  >
                    <table className="w-full border-separate border-spacing-0">
                      <caption className="sr-only">{w("ww5_tableLabel", { op: t(`wwOp_${op}`) })}</caption>
                      <thead>
                        <tr>
                          <th
                            scope="col"
                            className="sticky left-0 z-10 min-w-32 border-b border-line bg-surface px-3 py-2 text-left text-caption font-semibold text-ink-2"
                          >
                            {w("ww5_fieldCol")}
                          </th>
                          {days.map((d, i) => (
                            <th
                              key={d.date}
                              scope="col"
                              className="min-w-16 border-b border-line px-1 py-2 text-center text-caption font-semibold text-ink-2"
                            >
                              {i === 0 ? w("ww5_today") : day(d.date)}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {data.fields.map((f, r) => {
                          const o = f.operations.find((x) => x.operation === op);
                          const crop = f.sowingCrop ? data.cropNames[f.sowingCrop]?.[locale] : null;
                          return (
                            <tr key={f.fieldId}>
                              <th
                                scope="row"
                                className="sticky left-0 z-10 max-w-40 border-b border-line bg-surface px-3 py-2 text-left text-body font-semibold text-ink"
                              >
                                {f.name}
                                {op === "sowing" && o?.applicable && crop && (
                                  <span className="block text-caption font-normal text-ink-2">
                                    {t("wwSowingFor", { crop })}
                                  </span>
                                )}
                              </th>
                              {f.available && o?.applicable && !hasVerdict(f, op) ? (
                                <td
                                  colSpan={Math.max(1, days.length)}
                                  className="border-b border-line px-3 py-2 text-caption text-ink-2"
                                >
                                  <span className="inline-flex items-center gap-2">
                                    <HelpCircle aria-hidden className="size-4 shrink-0" strokeWidth={2} />
                                    {w("ww6_unknownRow", { reason: w("ww6_unknownReason") })}
                                  </span>
                                </td>
                              ) : !f.available || !o || !o.applicable ? (
                                <td
                                  colSpan={Math.max(1, days.length)}
                                  className="border-b border-line px-3 py-2 text-caption text-ink-2"
                                >
                                  {!f.available ? w("ww5_noForecast") : t("wwNoSowingCrop")}
                                </td>
                              ) : (
                                o.days.map((d, c) => {
                                  const Icon = ICON[d.status];
                                  const active = sel?.fieldId === f.fieldId && sel.date === d.date;
                                  return (
                                    <td key={d.date} className="border-b border-line p-1 text-center">
                                      <button
                                        type="button"
                                        aria-pressed={active}
                                        aria-label={w("ww5_cellAria", {
                                          field: f.name,
                                          op: t(`wwOp_${op}`),
                                          day: day(d.date, "full"),
                                          status: status(d.status),
                                        })}
                                        onClick={() =>
                                          setSel(active ? null : { fieldId: f.fieldId, date: d.date })
                                        }
                                        style={{ "--i": r + c } as React.CSSProperties}
                                        className={`focus-ring animate-rise stagger inline-flex min-h-11 w-full min-w-14 items-center justify-center rounded-input border-2 ${STATUS_STYLE[d.status]} ${
                                          active ? "border-ink" : "border-transparent"
                                        }`}
                                      >
                                        <Icon aria-hidden className="size-5" strokeWidth={2.2} />
                                      </button>
                                    </td>
                                  );
                                })
                              )}
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </Surface>
                <p className="text-caption text-ink-3">{w("ww5_scrollHint")}</p>

                {open && detail && (
                  <Surface tone="inset" pad="sm" role="status" className="animate-fade">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="flex flex-wrap items-center gap-2 text-body font-semibold text-ink">
                        {w("ww5_reasonsTitle", { field: open.name, day: day(detail.date, "full") })}
                        <span
                          className={`inline-flex items-center gap-1 rounded-chip px-2 py-0.5 text-caption font-semibold ${STATUS_STYLE[detail.status]}`}
                        >
                          {(() => {
                            const Icon = ICON[detail.status];
                            return <Icon aria-hidden className="size-4" strokeWidth={2} />;
                          })()}
                          {status(detail.status)}
                        </span>
                      </p>
                      <Button variant="ghost" onClick={() => setSel(null)}>
                        {w("ww5_hide")}
                      </Button>
                    </div>
                    <p className="mt-2 text-small text-ink-2">
                      {detail.status === "unknown"
                        ? t("wwUnknownThreshold")
                        : limitText(detail.limiting, open.country)}
                    </p>
                    {(detail.conditions?.length ?? 0) > 0 && (
                      <>
                        <p className="kicker mt-3">{t("wwCondTitle")}</p>
                        <ul className="mt-1 flex flex-col gap-1 text-small text-ink">
                          {detail.conditions!.map((c) => (
                            <li key={c.factor} className="flex flex-wrap items-center gap-x-2">
                              {condText(c, open.country)}
                              {c.factor === "delta_t" && (
                                <InfoHint label={t("hintLabel")}>{w("ww5_deltaTHint")}</InfoHint>
                              )}
                              {!c.verified && (
                                <span className="text-caption text-ink-3">· {w("ww5_mvp")}</span>
                              )}
                            </li>
                          ))}
                        </ul>
                      </>
                    )}
                    {detail.windows.length > 0 && (
                      <>
                        <p className="kicker mt-3">{t("wwWindows")}</p>
                        <ul className="mt-1 flex flex-col gap-1">
                          {detail.windows.map((s) => {
                            const Icon = ICON[s.status];
                            return (
                              <li
                                key={s.from}
                                className="flex flex-wrap items-center gap-2 text-small text-ink"
                              >
                                <span className="font-mono">
                                  {s.from}–{s.to}
                                </span>
                                <span
                                  className={`inline-flex items-center gap-1 rounded-chip px-2 py-0.5 text-caption font-semibold ${STATUS_STYLE[s.status]}`}
                                >
                                  <Icon aria-hidden className="size-4" strokeWidth={2} />
                                  {status(s.status)}
                                </span>
                                {s.limiting && (
                                  <span className="text-ink-2">{limitText(s.limiting, open.country)}</span>
                                )}
                              </li>
                            );
                          })}
                        </ul>
                      </>
                    )}
                  </Surface>
                )}

                {data.thresholdsUnverified && (
                  <p role="note" className="flex items-start gap-2 text-caption text-ink-3">
                    <AlertTriangle aria-hidden className="mt-0.5 size-4 shrink-0" strokeWidth={1.7} />
                    {w("ww5_mvpNote")}
                  </p>
                )}
                {data.fields.find((f) => f.forecast)?.forecast && (
                  <p className="text-caption text-ink-3">
                    {attribution(data.fields.find((f) => f.forecast)!.forecast!.attribution)}
                  </p>
                )}
              </>
            );
          }}
        </QueryState>

        <p className="flex items-center gap-2 text-caption text-ink-3">
          <ShieldCheck aria-hidden className="size-4 shrink-0" strokeWidth={1.7} />
          {t("wwNeutral")}
        </p>
      </div>
    </div>
  );
}
