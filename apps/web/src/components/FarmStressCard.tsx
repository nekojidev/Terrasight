"use client";

import { Disclosure, ErrorCard, Kicker, Skeleton, Surface } from "@terrasight/ui";
import type { FarmStress } from "@terrasight/shared";
import { ArrowDownRight, ArrowUpRight, Equal } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useFormat } from "@/lib/useFormat";

type Dyn = { (key: string, values?: Record<string, string | number>): string };

/**
 * Farm stress test (EP-10, S-10.13): the margin at risk across all fields if the weather of a bad year repeats.
 * Numbers come from the API as they are; the headline is chosen by fixed rules, never judged by colour.
 */
export function FarmStressCard({
  data,
  isLoading,
  isError,
  onRetry,
  isOwner,
  units = "metric",
}: {
  data: FarmStress | undefined;
  isLoading: boolean;
  isError: boolean;
  onRetry: () => void;
  isOwner: boolean;
  units?: "metric" | "imperial";
}) {
  const m = useTranslations("Main");
  const a = useTranslations("App");
  const t = m as unknown as Dyn;
  const fmt = useFormat({ units });

  const title = (
    <Kicker as="h2">
      <span id="fs-h">
        {data && data.status === "ready" && data.counted.length > 0
          ? t("fs_kicker", { year: data.stressYear, season: data.season })
          : m("fs_err_what")}
      </span>
    </Kicker>
  );
  const shell = (children: React.ReactNode) => (
    <Surface as="section" aria-labelledby="fs-h" className="flex flex-col gap-4" data-testid="farm-stress">
      {title}
      {children}
    </Surface>
  );

  if (!data && isError)
    return (
      <ErrorCard
        title={a("qsErrWhat", { what: m("fs_err_what") })}
        body={a("qsErrBody")}
        retryLabel={a("retry")}
        onRetry={onRetry}
      />
    );
  if (!data || isLoading)
    return (
      <Surface as="section" aria-labelledby="fs-h" className="flex flex-col gap-4">
        <Kicker as="h2">
          <span id="fs-h">{m("fs_err_what")}</span>
        </Kicker>
        <Skeleton label={a("loading")} variant="number" />
      </Surface>
    );

  const money = (n: number) => fmt.money(n, (data.currency ?? "USD") as "USD" | "UAH");
  const skipText = (reason: string) => t(`fs_skip_${reason}`, { year: data.stressYear });

  const notCounted =
    data.notCounted.length > 0 ? (
      <div>
        <Kicker as="h3" className="mb-1">
          {m("fs_not_counted")}
        </Kicker>
        <ul className="flex flex-col gap-1">
          {data.notCounted.map((f) => (
            <li key={f.fieldId} className="text-caption text-ink-2">
              <Link
                href={`/fields/${f.fieldId}`}
                className="focus-ring inline-flex min-h-tap items-center font-semibold text-ink underline underline-offset-4"
              >
                {f.name}
              </Link>
              : {skipText(f.reason)}
              {f.reason === "no-prices" && isOwner && (
                <>
                  {" · "}
                  <Link
                    href="/settings/prices"
                    className="focus-ring inline-flex min-h-tap items-center font-semibold text-ink underline underline-offset-4"
                  >
                    {m("fs_skip_prices_link")}
                  </Link>
                </>
              )}
            </li>
          ))}
        </ul>
      </div>
    ) : null;

  const method = (
    <p className="text-caption text-ink-3" data-testid="farm-stress-method">
      {t("fs_method", { season: data.season, year: data.stressYear })}
    </p>
  );

  if (
    data.status === "unavailable" ||
    !data.current ||
    !data.recommended ||
    data.difference === null ||
    data.counted.length === 0
  )
    return shell(
      <>
        <p className="text-body text-ink-2">{t("fs_unavailable", { year: data.stressYear })}</p>
        {notCounted}
        {method}
      </>,
    );

  const { current, recommended, difference } = data;
  const samePlans = data.counted.every((f) => f.currentLoss === f.recommendedLoss);
  const kind: "better" | "same" | "worse" =
    difference > 0 && !samePlans ? "better" : difference < 0 ? "worse" : "same";
  const Icon = kind === "better" ? ArrowDownRight : kind === "worse" ? ArrowUpRight : Equal;
  const headline =
    kind === "better"
      ? t("fs_head_better", { amount: money(difference) })
      : kind === "worse"
        ? t("fs_head_worse", { amount: money(-difference) })
        : t("fs_head_same", { amount: money(current.atRisk) });
  const share = (x: { atRisk: number; typical: number }) =>
    x.typical > 0 ? fmt.percent(x.atRisk / x.typical, { maximumFractionDigits: 0 }) : "";

  const big = (label: string, x: { atRisk: number; typical: number }) => (
    <div className="min-w-0 flex-1 rounded-input bg-surface-2 p-4">
      <p className="text-caption font-semibold text-ink-2">{label}</p>
      <p className="text-big-number text-ink">{money(x.atRisk)}</p>
      <p className="text-small font-semibold text-ink">{m("fs_risk_label")}</p>
      <p className="text-caption text-ink-2">
        {t("fs_of_typical", { amount: money(x.typical), share: share(x) }).replace(/ · $/, "")}
      </p>
    </div>
  );

  return shell(
    <>
      <p className="flex items-start gap-2 text-h3 text-ink">
        <Icon aria-hidden className="mt-1 size-5 shrink-0 text-ink-2" strokeWidth={1.7} />
        <span>
          <span className="sr-only">{m(`fs_icon_${kind}`)}: </span>
          {headline}
        </span>
      </p>
      <div className="flex flex-col gap-3 sm:flex-row">
        {big(m("fs_current"), current)}
        {big(m("fs_recommended"), recommended)}
      </div>
      <Disclosure
        summary={
          <span className="text-body font-semibold text-ink">
            {t("fs_counted", { n: data.counted.length, m: data.counted.length + data.notCounted.length })}
          </span>
        }
      >
        <div className="flex flex-col gap-4 pt-2">
          <ul className="flex flex-col gap-2">
            {data.counted.map((f) => (
              <li key={f.fieldId}>
                <Link
                  href={`/fields/${f.fieldId}/rotation`}
                  className="focus-ring block min-h-tap rounded-input bg-surface-2 px-4 py-3 hover:bg-muted"
                >
                  <span className="block text-body font-semibold text-ink">
                    {f.name} <span className="font-normal text-ink-2">· {fmt.area(f.areaHa)}</span>
                  </span>
                  <span className="block text-caption text-ink-2">
                    {t("fs_loss_pair", {
                      current: money(f.currentLoss),
                      recommended: money(f.recommendedLoss),
                    })}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
          {notCounted}
        </div>
      </Disclosure>
      {method}
    </>,
  );
}
