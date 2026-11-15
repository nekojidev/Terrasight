"use client";

import { Kicker, Surface } from "@terrasight/ui";
import type { DataBasisItem } from "@terrasight/shared";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useFormat } from "@/lib/useFormat";

/**
 * "What NASA data contributed here" (EP-10, S-10.12). One row per dataset that really fed the item, built from the
 * API's `dataBasis`; NASA datasets first, other sources in a quieter second list. Copy comes from the `Rec` namespace
 * (`basis_*`), so any page can use it without owning the keys.
 */
export function DataBasis({
  items,
  trustHref,
  compact = false,
}: {
  items: DataBasisItem[];
  trustHref?: string;
  compact?: boolean;
}) {
  const t = useTranslations("Rec");
  const fmt = useFormat();
  const nasa = items.filter((i) => i.agency === "NASA");
  const other = items.filter((i) => i.agency !== "NASA");
  const day = (iso: string) => fmt.date(`${iso}T12:00:00Z`, "full", { timeZone: "UTC" });

  const period = (i: DataBasisItem) => {
    if (!i.from || !i.to) return null;
    if (i.from.endsWith("-01-01") && i.to.endsWith("-12-31"))
      return t("basis_period_years", {
        from: i.from.slice(0, 4),
        to: i.to.slice(0, 4),
        same: i.from.slice(0, 4) === i.to.slice(0, 4) ? "yes" : "no",
      });
    return t("basis_period", { from: day(i.from), to: day(i.to) });
  };

  const row = (i: DataBasisItem, quiet: boolean) => {
    const p = period(i);
    const sentences = compact ? [] : i.supports.filter((s) => t.has(`basis_supports_${s}`));
    return (
      <li key={i.dataset} className="flex flex-col gap-0.5">
        <span className={quiet ? "text-small font-medium text-ink-2" : "text-body font-semibold text-ink"}>
          {i.dataset}
        </span>
        {(p || i.lastDate) && (
          <span className="text-caption text-ink-3">
            {[p, i.lastDate ? t("basis_last", { date: day(i.lastDate) }) : null].filter(Boolean).join(" · ")}
          </span>
        )}
        {sentences.map((s) => (
          <span key={s} className="text-caption text-ink-2">
            {t(`basis_supports_${s}`)}
          </span>
        ))}
      </li>
    );
  };

  return (
    <Surface as="section" pad={compact ? "sm" : "md"} aria-labelledby="data-basis-title">
      <h2 id="data-basis-title" className="text-h3 font-semibold text-ink">
        {t("basis_t")}
      </h2>
      {nasa.length > 0 ? (
        <ul className="mt-3 flex flex-col gap-3">{nasa.map((i) => row(i, false))}</ul>
      ) : (
        <p className="mt-2 text-caption text-ink-2">{t(other.length > 0 ? "basis_none" : "basis_empty")}</p>
      )}
      {other.length > 0 && (
        <div className="mt-4 border-t border-line pt-3">
          <Kicker>{t("basis_other_t")}</Kicker>
          <ul className="mt-2 flex flex-col gap-2">{other.map((i) => row(i, true))}</ul>
        </div>
      )}
      {trustHref && (
        <Link
          href={trustHref}
          className="focus-ring mt-3 inline-flex min-h-11 items-center text-small font-medium text-ink underline underline-offset-2"
        >
          {t("basis_trust")}
        </Link>
      )}
    </Surface>
  );
}
