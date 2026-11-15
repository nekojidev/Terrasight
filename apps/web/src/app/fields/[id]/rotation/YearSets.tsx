"use client";

import { YEAR_SET_IDS, type YearSetComparison, type YearSetRanking } from "@terrasight/shared";
import { Button, Chip, Surface } from "@terrasight/ui";
import { Check, Loader, Star } from "lucide-react";
import { useTranslations } from "next-intl";
import { ApiError } from "@/lib/api";
import { useFormat } from "@/lib/useFormat";
import { findYearSets, usableSets, type YearSetFinding } from "./rotationView";

type T = (key: string, values?: Record<string, string | number>) => string;

/** The plain-word lines under the columns. Only what the finding contains; nothing else can be said. */
export function conclusionLines(f: YearSetFinding, t: T, label: (id: string) => string): string[] {
  if (f.kind === "none") return [];
  const complete = f.complete ? "yes" : "no";
  if (f.kind === "same") return [t("ys_same", { complete })];
  return [
    `${t("ys_chg_all", { option: label(f.allBest) })} ${f.changed
      .map((c) => t("ys_chg_set", { set: t(`ys_in_${c.set}`), option: label(c.best) }))
      .join(" ")}`,
    ...(f.currentNote ? [t("ys_cur_note", { n: f.currentNote.rank })] : []),
  ];
}

/** The one sentence the headline gains (T10); null when the comparison says nothing. */
export function heroSentence(f: YearSetFinding, t: T, label: (id: string) => string): string | null {
  if (f.kind === "none") return null;
  const complete = f.complete ? "yes" : "no";
  if (f.kind === "same") return t(f.sameOrder ? "ys_hero_same" : "ys_hero_best", { complete });
  const c = f.changed[0];
  return c ? t("ys_chg_set", { set: t(`ys_in_${c.set}`), option: label(c.best) }) : null;
}

export interface YearSetsProps {
  data: YearSetComparison | undefined;
  isError: boolean;
  error: unknown;
  onRetry: () => void;
  agro: boolean;
  units: "metric" | "imperial";
  /** Margin amounts per hectare in the unit shown; the money format of the page. */
  money: (perHa: number) => string;
  unitLabel: string;
  /** "A · Alfalfa base": letter and name as elsewhere on the page. */
  label: (id: string) => string;
  /** The page's recommendation. */
  recommendedId: string | null;
  currentId: string;
  /** Hide the bad-year line (the model shows no weather spread for this field). */
  hideBad?: boolean;
  /** Render inside an evidence row: no card and no heading of its own. */
  bare?: boolean;
}

function SetColumn({
  set,
  t,
  fmt,
  ...p
}: {
  set: YearSetRanking;
  t: T;
  fmt: ReturnType<typeof useFormat>;
} & Pick<YearSetsProps, "agro" | "money" | "unitLabel" | "label" | "recommendedId" | "hideBad">) {
  const s = set.shift;
  const rainPct = s ? s.precipFactor - 1 : 0;
  const parts = s
    ? [
        s.applied.temperature
          ? t("ys_shift_temp", { delta: fmt.tempDelta(s.deltaT) })
          : t("ys_shift_temp_off"),
        s.applied.precipitation
          ? t("ys_shift_rain", {
              pct: `${rainPct > 0 ? "+" : rainPct < 0 ? "−" : ""}${fmt.percent(Math.abs(rainPct), { maximumFractionDigits: 1 })}`,
            })
          : t("ys_shift_rain_off"),
      ]
    : [];
  const options = [...set.options].sort((a, b) => a.rank - b.rank);
  return (
    <Surface
      as="li"
      className="flex w-[85%] shrink-0 snap-start flex-col gap-3 sm:w-auto"
      data-year-set={set.id}
    >
      <div>
        <h3 className="text-body font-semibold text-ink">{t(`ys_set_${set.id}`)}</h3>
        {set.id === "all" && <p className="text-caption text-ink-2">{t("ys_basis_tag")}</p>}
      </div>
      <p className="text-caption text-ink-2">
        {t("ys_years", { from: set.years.from, to: set.years.to, count: set.years.count })}
      </p>
      {parts.length > 0 && (
        <p className="text-caption text-ink-2">{t("ys_shift_lead", { parts: parts.join("; ") })}</p>
      )}
      <ol className="flex flex-col gap-2">
        {options.map((o) => {
          const rec = o.id === p.recommendedId;
          return (
            <li
              key={o.id}
              className={
                rec
                  ? "flex flex-col gap-1.5 rounded-input border-2 border-ink bg-muted p-3"
                  : "flex flex-col gap-1.5 rounded-input border border-line p-3"
              }
            >
              <p className="flex flex-col gap-0.5 text-body font-semibold text-ink">
                <span className="font-mono text-caption font-normal text-ink-2">
                  {t("ys_rank", { n: o.rank })}
                </span>
                <span className="min-w-0">{p.label(o.id)}</span>
              </p>
              {(o.rank === 1 || rec) && (
                <div className="flex flex-wrap gap-1.5">
                  {o.rank === 1 && (
                    <Chip tone="ok" icon={<Check />}>
                      {t("ys_best")}
                    </Chip>
                  )}
                  {rec && (
                    <Chip tone="neutral" icon={<Star />}>
                      {t("ys_rec")}
                    </Chip>
                  )}
                </div>
              )}
              {!p.agro && o.margin != null && (
                <p className="font-mono text-caption text-ink">
                  {t("ys_margin", { amount: p.money(o.margin), unit: p.unitLabel })}
                </p>
              )}
              {o.drought != null && !p.hideBad && (
                <p className="font-mono text-caption text-ink-2">
                  {p.agro
                    ? t("ys_worst_agro", { pct: fmt.percent(o.drought) })
                    : t("ys_worst", { amount: p.money(o.drought) })}
                </p>
              )}
            </li>
          );
        })}
      </ol>
    </Surface>
  );
}

/** Sensitivity to the weather years (S-10.06). Loads on its own; a failure here never touches the rest of the page. */
export function YearSets(props: YearSetsProps) {
  const r = useTranslations("Rotation");
  const t = r as unknown as T;
  const fmt = useFormat({ units: props.units });
  const sets = props.data ? usableSets(props.data, YEAR_SET_IDS) : [];
  const missing = YEAR_SET_IDS.filter((id) => !sets.some((s) => s.id === id));
  const finding = props.data
    ? findYearSets(props.data, YEAR_SET_IDS, props.currentId)
    : ({ kind: "none" } as const);
  const lines = conclusionLines(finding, t, props.label);

  let body: React.ReactNode;
  if (props.isError || (props.data && sets.length === 0)) {
    const na = props.isError && props.error instanceof ApiError && props.error.problem.status === 404;
    body = (
      <Surface tone="inset" role="status" className="flex flex-col items-start gap-2">
        <p className="text-body font-semibold text-ink">{t(na || !props.isError ? "ys_na" : "ys_err")}</p>
        <p className="text-caption text-ink-2">{t(na || !props.isError ? "ys_na_sub" : "ys_err_sub")}</p>
        <Button variant="outline" onClick={props.onRetry}>
          {t("ys_retry")}
        </Button>
      </Surface>
    );
  } else if (!props.data) {
    body = (
      <Surface tone="inset" pad="lg" role="status" aria-live="polite" className="flex flex-col gap-2">
        <p className="flex items-center gap-2 text-body font-semibold text-ink">
          <Loader aria-hidden className="size-5 shrink-0 motion-safe:animate-spin" strokeWidth={1.7} />
          {t("ys_run_title")}
        </p>
        <p className="text-caption text-ink-2">{t("ys_run_usual")}</p>
      </Surface>
    );
  } else {
    body = (
      <>
        <ul
          aria-label={t("ys_title")}
          className="flex snap-x snap-mandatory gap-4 overflow-x-auto pb-2 sm:grid sm:grid-cols-[repeat(auto-fit,minmax(15rem,1fr))] sm:overflow-visible sm:pb-0"
        >
          {sets.map((s) => (
            <SetColumn
              key={s.id}
              set={s}
              t={t}
              fmt={fmt}
              agro={props.agro}
              money={props.money}
              unitLabel={props.unitLabel}
              label={props.label}
              recommendedId={props.recommendedId}
              hideBad={props.hideBad ?? false}
            />
          ))}
        </ul>
        {missing.length > 0 && (
          <ul className="flex flex-col gap-1 text-caption text-ink-2">
            {missing.map((id) => (
              <li key={id}>
                {t(`ys_set_${id}`)}: {t("ys_missing")}
              </li>
            ))}
          </ul>
        )}
        {lines.length > 0 && (
          <div className="flex flex-col gap-2" data-testid="year-sets-conclusion">
            {lines.map((l) => (
              <p key={l} className="text-body font-semibold text-ink">
                {l}
              </p>
            ))}
          </div>
        )}
      </>
    );
  }

  const intro = (
    <div>
      <p className="text-body text-ink-2">{t("ys_label")}</p>
      {props.data && sets.length > 0 && <p className="text-caption text-ink-2">{t("ys_basis")}</p>}
    </div>
  );
  if (props.bare)
    return (
      <div role="region" aria-label={t("ys_title")} className="flex flex-col gap-4">
        {intro}
        {body}
      </div>
    );
  return (
    <Surface
      as="section"
      pad="lg"
      id="year-sets"
      aria-labelledby="year-sets-title"
      className="flex flex-col gap-4"
    >
      <div>
        <h2 id="year-sets-title" className="text-h2 text-ink">
          {t("ys_title")}
        </h2>
      </div>
      {intro}
      {body}
    </Surface>
  );
}
