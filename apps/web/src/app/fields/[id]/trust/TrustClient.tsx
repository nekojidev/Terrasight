"use client";

import { useQuery } from "@tanstack/react-query";
import type { Retrospective, TrustFit, TrustReport, TrustYear } from "@terrasight/shared";
import { Button, Chip, Disclosure, Kicker, Skeleton, Surface } from "@terrasight/ui";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { ModelVsActualChart } from "@/components/ModelVsActualChart";
import { QueryState } from "@/components/QueryState";
import { ApiError, api } from "@/lib/api";
import { useFormat } from "@/lib/useFormat";
import { FieldTabs } from "../Overview";
import { cropLabel } from "../log/group";
import {
  averageOf,
  cleanArea,
  flatExample,
  parseCaveat,
  readCase2022,
  readFit,
  readNdvi,
  readVerdict,
  type Verdict,
} from "./trustView";

type Fmt = ReturnType<typeof useFormat>;
type T = ReturnType<typeof useTranslations>;
type CropNames = Record<string, { en: string; uk: string }> | undefined;

const linkClass =
  "focus-ring inline-flex min-h-tap items-center rounded-btn border border-line-control bg-surface px-4 text-body font-semibold text-ink hover:bg-surface-2";

/** Signed whole percent: "+12%", "−8%", "0%". A missing value stays "no data". */
function signedPct(fmt: Fmt, n: number | null, nodata: string): string {
  if (n === null) return nodata;
  const r = Math.round(n);
  if (r === 0) return `${fmt.number(0)}%`;
  return `${r > 0 ? "+" : "−"}${fmt.number(Math.abs(r), { maximumFractionDigits: 0 })}%`;
}

function unavailableReport(fieldId: string, reason: string): TrustReport {
  return {
    status: "unavailable",
    reason,
    fieldId,
    years: [],
    vsCounty: null,
    vsNdvi: null,
    actual: { kind: "none", connected: false, area: null, verified: false },
    case2022: null,
    notModelled: [],
    caveats: [],
    retrospective: null,
    modelFlat: false,
    dryland: null,
  };
}

/** "How far can you trust this" (EP-10, S-10.09 and S-10.10): the model over past seasons against what happened. */
export function TrustClient({
  workspaceId,
  fieldId,
  fieldName,
}: {
  workspaceId: string;
  fieldId: string;
  fieldName: string;
}) {
  const t = useTranslations("Trust");
  const query = useQuery({
    queryKey: ["field", workspaceId, fieldId, "trust"],
    queryFn: async (): Promise<TrustReport> => {
      try {
        return await api<TrustReport>(`/api/w/${workspaceId}/fields/${fieldId}/trust`);
      } catch (e) {
        if (e instanceof ApiError && e.problem.status === 404) return unavailableReport(fieldId, "not-found");
        throw e;
      }
    },
    refetchInterval: (q) => (q.state.data?.status === "pending" ? 5000 : false),
  });
  const history = useQuery({
    queryKey: ["field", workspaceId, fieldId, "history"],
    queryFn: () => api<{ cropNames?: CropNames }>(`/api/w/${workspaceId}/fields/${fieldId}/history`),
    staleTime: 10 * 60_000,
  });
  return (
    <div className="flex flex-col gap-5">
      <header className="flex flex-col gap-3">
        <Link href={`/fields/${fieldId}`} className="focus-ring inline-flex min-h-tap w-fit items-center text-body font-semibold text-ink-2 hover:text-ink">
          ‹ {fieldName}
        </Link>
        <Kicker>{fieldName}</Kicker>
        <h1 className="text-h1 text-ink">{t("title")}</h1>
        <FieldTabs fieldId={fieldId} active={3} />
      </header>
      <div className="flex max-w-[760px] flex-col gap-5">
        <p className="text-body text-ink-2">{t("intro")}</p>
        <QueryState
          query={query}
          what={t("title")}
          skeleton={
            <div className="flex flex-col gap-4">
              <Skeleton variant="card" label={t("loading")} />
              <Skeleton variant="rows" rows={3} label={t("loading")} />
            </div>
          }
        >
          {(report) =>
            report.status === "pending" ? (
              <Surface as="section" role="status">
                <h2 className="text-h2 text-ink">{t("pending_title")}</h2>
                <p className="mt-2 text-body text-ink-2">{t("pending_body")}</p>
              </Surface>
            ) : report.status === "unavailable" ? (
              <Unavailable report={report} fieldId={fieldId} onRetry={() => void query.refetch()} />
            ) : (
              <Ready report={report} cropNames={history.data?.cropNames} />
            )
          }
        </QueryState>
        <nav className="flex flex-wrap gap-3">
          <Link href={`/fields/${fieldId}`} className={linkClass}>
            {t("back")}
          </Link>
          <Link href={`/fields/${fieldId}/rotation`} className={linkClass}>
            {t("toRotation")}
          </Link>
        </nav>
      </div>
    </div>
  );
}

function Unavailable({ report, fieldId, onRetry }: { report: TrustReport; fieldId: string; onRetry: () => void }) {
  const t = useTranslations("Trust");
  const known = ["history-missing", "weather-missing", "no-crop-parameters"];
  const reason = report.reason && known.includes(report.reason) ? report.reason : "other";
  return (
    <Surface as="section" role="status">
      <h2 className="text-h2 text-ink">{t("unavailable_title")}</h2>
      <p className="mt-2 text-body text-ink-2">{t(`unavailable_${reason}` as "unavailable_other")}</p>
      <div className="mt-4 flex flex-wrap gap-3">
        {reason === "history-missing" && (
          <Link href={`/fields/${fieldId}`} className={linkClass}>
            {t("unavailable_field")}
          </Link>
        )}
        <Button variant="outline" onClick={onRetry}>
          {t("retry")}
        </Button>
      </div>
    </Surface>
  );
}

function Ready({ report, cropNames }: { report: TrustReport; cropNames: CropNames }) {
  const t = useTranslations("Trust");
  const fmt = useFormat();
  const nodata = t("c22_nodata");
  const derz = report.actual.kind === "derzhstat";
  const years = [...report.years].sort((a, b) => a.year - b.year);
  const crop = (c: string | null) => cropLabel(c, cropNames, fmt.locale, t("miss_crop_unknown"));
  const cropName = (c: string) => cropLabel(c, cropNames, fmt.locale, t("crop_fallback"));
  const flat = report.modelFlat === true;
  const dryland = report.dryland ?? null;
  const verdict = readVerdict(report);
  const source = sourceText(report, t, cropName);
  const y22 = report.case2022;

  const chart = (
    <ModelVsActualChart
      years={years.map((y) => y.year)}
      series={[
        { id: "model", label: t("series_model"), values: years.map((y) => y.model) },
        {
          id: "county",
          label: t(derz ? "series_county_derzhstat" : "series_county"),
          values: years.map((y) => y.county),
        },
        { id: "ndvi", label: t("series_ndvi"), values: years.map((y) => y.ndvi) },
      ]}
      unitLabel={t("chart_unit")}
      highlightYears={y22 ? [{ year: y22.year, label: String(y22.year) }] : []}
      missYears={years.filter((y) => y.miss).map((y) => y.year)}
      ariaLabel={t("chart_aria")}
      tableCaption={t("chart_caption")}
    />
  );
  const missed = (
    <Missed years={years} hasCounty={report.vsCounty !== null} fmt={fmt} t={t} crop={crop} nodata={nodata} />
  );

  return (
    <>
      {flat ? <FlatNotice years={years} fmt={fmt} t={t} /> : <VerdictCard report={report} verdict={verdict} source={source} fmt={fmt} t={t} />}
      {!flat && !derz && y22 && y22.model !== null && y22.county !== null && (
        <Surface as="section">
          <Disclosure
            summary={t(report.actual.kind === "nass" && y22.county <= -15 ? "c22_row_drought" : "c22_row", {
              model: signedPct(fmt, y22.model, nodata),
              county: signedPct(fmt, y22.county, nodata),
            })}
          >
            <div className="pt-3">
              <Case2022 y={y22} flat={false} fmt={fmt} t={t} />
            </div>
          </Disclosure>
        </Surface>
      )}
      {flat && dryland && <Dryland d={dryland} fmt={fmt} t={t} crop={crop} nodata={nodata} />}
      {flat ? (
        <Surface as="section" aria-label={t("flat_show")}>
          <Disclosure summary={t("flat_show")} summaryNote={t("flat_show_note")}>
            <div className="flex flex-col gap-4 pt-3">
              <p className="text-body text-ink-2">{source}</p>
              {y22 && (
                <section className="flex flex-col gap-2">
                  <h3 className="text-body font-semibold text-ink">
                    {t("c22_row_flat", { county: signedPct(fmt, y22.county, nodata) })}
                  </h3>
                  <Case2022 y={y22} flat fmt={fmt} t={t} />
                </section>
              )}
              <Fit title={t(derz ? "fit_county_derzhstat" : "fit_county")} fit={report.vsCounty} flat fmt={fmt} t={t} />
              <Fit title={t("fit_ndvi")} fit={report.vsNdvi} flat fmt={fmt} t={t} />
              <section aria-labelledby="trust-chart" className="flex flex-col gap-3">
                <h3 id="trust-chart" className="text-body font-semibold text-ink">
                  {t("chart_title")}
                </h3>
                {chart}
              </section>
              {missed}
            </div>
          </Disclosure>
        </Surface>
      ) : (
        <>
          <Surface as="section" aria-labelledby="trust-chart" className="flex flex-col gap-3">
            <h2 id="trust-chart" className="text-h2 text-ink">
              {t("chart_title")}
            </h2>
            {chart}
          </Surface>
          {missed}
        </>
      )}
      {!flat && dryland && <Dryland d={dryland} fmt={fmt} t={t} crop={crop} nodata={nodata} />}
      <NotModelled report={report} t={t} crop={cropName} />
      {report.retrospective && <Retro r={report.retrospective} fmt={fmt} t={t} />}
    </>
  );
}

/** The one-sentence verdict, the evidence line under it and the reading rules behind a disclosure. */
function VerdictCard({
  report,
  verdict,
  source,
  fmt,
  t,
}: {
  report: TrustReport;
  verdict: Verdict;
  source: string;
  fmt: Fmt;
  t: T;
}) {
  const derz = report.actual.kind === "derzhstat";
  let sentence = "";
  if (verdict.kind === "fit") {
    sentence =
      verdict.reading === "few" || verdict.mae === null
        ? t("verdict_few")
        : t(`verdict_${verdict.reading}` as "verdict_close", { mae: Math.round(verdict.mae) });
    if (verdict.reading !== "few" && verdict.misses > 0) sentence += ` ${t("verdict_missed", { n: verdict.misses })}`;
  } else if (verdict.kind === "estimate") {
    sentence = `${t(verdict.why === "derzhstat" ? "verdict_est_derzhstat" : "verdict_est_nocounty")} ${t(`verdict_ndvi_${verdict.ndvi}` as "verdict_ndvi_few")}`;
  }
  return (
    <Surface as="section" tone="hero" aria-labelledby="trust-verdict" className="flex flex-col gap-3">
      <h2 id="trust-verdict" className="text-h2 text-ink">
        {t("verdict_title")}
      </h2>
      <p className="text-body font-semibold text-ink">{sentence}</p>
      <div className="flex flex-col gap-2">
        <Fit
          title={t(derz ? "fit_county_derzhstat" : "fit_county")}
          fit={report.vsCounty}
          flat={false}
          fmt={fmt}
          t={t}
          hideEmpty
          soft={derz}
        />
        <Fit title={t("fit_ndvi")} fit={report.vsNdvi} flat={false} fmt={fmt} t={t} hideEmpty ndvi />
      </div>
      <p className="text-caption text-ink-2">{source}</p>
      <Disclosure summary={t("read_title")}>
        <div className="flex flex-col gap-2 pt-2 text-caption text-ink-2">
          <p>{t("fit_rule")}</p>
          <p>{t("read_r")}</p>
          <p>{t("read_points")}</p>
          <p>{t("c22_rule")}</p>
        </div>
      </Disclosure>
    </Surface>
  );
}

/** Neutral note for a field whose model shows the same yield every year (irrigated): icon plus words, not an error. */
function FlatNotice({ years, fmt, t }: { years: TrustYear[]; fmt: Fmt; t: T }) {
  const ex = flatExample(years);
  return (
    <section
      aria-labelledby="trust-flat"
      className="flex gap-3 rounded-card border border-line-strong bg-info-soft p-4"
    >
      <svg aria-hidden="true" viewBox="0 0 24 24" width="24" height="24" className="mt-0.5 shrink-0 text-ink" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
        <circle cx="12" cy="12" r="10" />
        <path d="M12 11v6M12 7.5v.01" />
      </svg>
      <div className="min-w-0">
        <h2 id="trust-flat" className="text-h2 text-ink">
          {t("flat_title")}
        </h2>
        <p className="mt-1 text-body text-ink">
          {ex
            ? t("flat_body_example", { value: signedPct(fmt, ex.county, t("c22_nodata")), year: ex.year })
            : t("flat_body")}
        </p>
      </div>
    </section>
  );
}

function Dryland({
  d,
  fmt,
  t,
  crop,
  nodata,
}: {
  d: NonNullable<TrustReport["dryland"]>;
  fmt: Fmt;
  t: T;
  crop: (c: string | null) => string;
  nodata: string;
}) {
  const years = [...d.years].sort((a, b) => a.year - b.year);
  const highlight = [2012, 2022]
    .filter((y) => years.some((r) => r.year === y))
    .map((y) => ({ year: y, label: String(y) }));
  return (
    <>
      <Surface as="section" aria-labelledby="trust-dry" className="flex flex-col gap-4">
        <h2 id="trust-dry" className="text-h2 text-ink">
          {t("dry_title")}
        </h2>
        <p className="text-body text-ink">{t("dry_intro", { area: d.area })}</p>
        <Fit title={t("dry_fit")} fit={d.fit} flat={false} fmt={fmt} t={t} />
        <Disclosure summary={t("read_title")}>
          <div className="flex flex-col gap-2 pt-2 text-caption text-ink-2">
            <p>{t("fit_rule")}</p>
            <p>{t("read_r")}</p>
          </div>
        </Disclosure>
      </Surface>
      <Surface as="section" aria-labelledby="trust-dry-chart" className="flex flex-col gap-3">
        <h2 id="trust-dry-chart" className="text-h2 text-ink">
          {t("dry_chart_title")}
        </h2>
        <ModelVsActualChart
          years={years.map((y) => y.year)}
          series={[
            { id: "model", label: t("dry_series_model"), values: years.map((y) => y.model) },
            { id: "county", label: t("dry_series_actual"), values: years.map((y) => y.county) },
          ]}
          unitLabel={t("chart_unit")}
          highlightYears={highlight}
          missYears={years.filter((y) => y.miss).map((y) => y.year)}
          ariaLabel={t("dry_chart_aria")}
          tableCaption={t("dry_chart_caption")}
        />
      </Surface>
      <Missed
        years={years}
        hasCounty={d.fit !== null && d.fit.n > 0}
        fmt={fmt}
        t={t}
        crop={crop}
        nodata={nodata}
        dry
      />
    </>
  );
}

/** Where the official yields come from, with crop ids turned into names (no raw id on screen). */
function sourceText(report: TrustReport, t: T, cropName: (c: string) => string): string {
  const { kind, connected } = report.actual;
  const area = report.actual.area
    ? cleanArea(report.actual.area, cropName, (k) => (t.has(`area_${k}`) ? t(`area_${k}` as "area_irrigated") : null))
    : null;
  if (kind === "nass" && connected) return area ? t("src_nass_area", { area }) : t("src_nass");
  if (kind === "derzhstat") return area ? t("src_derzhstat_area", { area }) : t("src_derzhstat");
  return t("src_none");
}

/** The 2022 numbers and the one-line reading, by fixed rules. */
function Case2022({ y, flat, fmt, t }: { y: TrustYear; flat: boolean; fmt: Fmt; t: T }) {
  const nodata = t("c22_nodata");
  const reading = readCase2022(y, flat);
  const ndvi = readNdvi(y);
  const gap = (n: number) => fmt.number(n, { maximumFractionDigits: 0 });
  const sentence = !reading
    ? t("c22_nomodel")
    : reading.kind === "nocounty"
      ? t("c22_nocounty")
      : reading.kind === "modelflat"
        ? t(Math.round(reading.county) === 0 ? "c22_modelflat_at" : reading.county < 0 ? "c22_modelflat_below" : "c22_modelflat_above", {
            value: fmt.number(Math.abs(Math.round(reading.county)), { maximumFractionDigits: 0 }),
          })
        : reading.kind === "same"
        ? t(reading.close ? "c22_same_close" : "c22_same_far", { gap: gap(reading.gap) })
        : reading.kind === "flat"
          ? t("c22_flat", { gap: gap(reading.gap) })
          : t("c22_opposite", { model: signedPct(fmt, y.model, nodata), county: signedPct(fmt, y.county, nodata) });
  const cells: Array<[string, number | null]> = [
    [t("c22_model"), y.model],
    [t("c22_county"), y.county],
    [t("c22_ndvi"), y.ndvi],
  ];
  return (
    <div className="flex flex-col gap-3">
      <dl className="grid grid-cols-3 gap-3">
        {cells.map(([label, v]) => (
          <div key={label} className="min-w-0">
            <dt className="text-caption text-ink-2">{label}</dt>
            <dd className="font-mono text-big-number text-ink">{signedPct(fmt, v, nodata)}</dd>
            {v !== null && <dd className="text-caption text-ink-2">{t("c22_unit")}</dd>}
          </div>
        ))}
      </dl>
      <p className="text-body font-semibold text-ink">
        {sentence}
        {ndvi && ` ${t(`c22_ndvi_${ndvi}` as "c22_ndvi_same")}`}
      </p>
    </div>
  );
}

function Fit({
  title,
  fit,
  flat,
  fmt,
  t,
  hideEmpty = false,
  ndvi = false,
  soft = false,
}: {
  title: string;
  fit: TrustFit | null;
  flat: boolean;
  fmt: Fmt;
  t: T;
  /** Nothing at all when there are no years with both values (the verdict already says so). */
  hideEmpty?: boolean;
  /** Satellite greenness: a rough check, worded softly and never in the "urgent" tone. */
  ndvi?: boolean;
  /** Unverified context (oblast yields): neutral tone, no verdict colour. */
  soft?: boolean;
}) {
  const reading = fit ? readFit(fit, flat) : null;
  if (hideEmpty && (!fit || fit.n === 0)) return null;
  const words = ndvi ? `ndvi_read_${reading}` : `read_${reading}`;
  const tone = soft || ndvi
    ? reading === "close" && !soft
      ? "ok"
      : reading === "loose" && !soft
        ? "week"
        : "neutral"
    : reading === "close"
      ? "ok"
      : reading === "loose"
        ? "week"
        : reading === "few"
          ? "neutral"
          : "urgent";
  return (
    <div>
      <h3 className="text-body font-semibold text-ink">{title}</h3>
      {!fit || fit.n === 0 ? (
        <p className="text-body text-ink-2">{t("fit_none")}</p>
      ) : reading === "flat" ? (
        <p className="text-body text-ink">{t("read_flat")}</p>
      ) : (
        <>
          <p className="font-mono text-body text-ink">
            {t("fit_line", {
              r: fit.r === null ? t("fit_r_none") : fmt.number(fit.r, { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
              mae:
                fit.mae === null
                  ? t("fit_r_none")
                  : t("fit_points", { value: fmt.number(fit.mae, { minimumFractionDigits: 1, maximumFractionDigits: 1 }) }),
              n: fit.n,
            })}
          </p>
          <p className="mt-1">
            <Chip tone={tone}>{t(words as "read_close")}</Chip>
          </p>
        </>
      )}
    </div>
  );
}

function Missed({
  years,
  hasCounty,
  fmt,
  t,
  crop,
  nodata,
  dry = false,
}: {
  years: TrustYear[];
  hasCounty: boolean;
  dry?: boolean;
  fmt: Fmt;
  t: T;
  crop: (c: string | null) => string;
  nodata: string;
}) {
  const missed = years.filter((y) => y.miss);
  return (
    <Surface as="section" aria-labelledby={dry ? "trust-dry-miss" : "trust-miss"}>
      <h2 id={dry ? "trust-dry-miss" : "trust-miss"} className="text-h2 text-ink">
        {t(dry ? "dry_miss_title" : "miss_title")}
      </h2>
      <p className="mt-1 text-body text-ink-2">{t(dry ? "dry_miss_intro" : "miss_intro")}</p>
      {missed.length === 0 ? (
        <p className="mt-3 text-body text-ink">{t(hasCounty ? "miss_empty" : "miss_nocounty")}</p>
      ) : (
        <ul className="mt-3 flex flex-col divide-y divide-line">
          {missed.map((y) => (
            <li key={y.year} className="py-3">
              <p className="text-body font-semibold text-ink">
                {y.year} · {crop(y.crop)}
              </p>
              <p className="font-mono text-small text-ink">
                {t("miss_model", { value: signedPct(fmt, y.model, nodata) })} ·{" "}
                {t("miss_county", { value: signedPct(fmt, y.county, nodata) })}
              </p>
              <p className="text-body text-ink-2">{t(`miss_reason_${y.reason ?? "unknown"}` as "miss_reason_unknown")}</p>
            </li>
          ))}
        </ul>
      )}
    </Surface>
  );
}

function NotModelled({ report, t, crop }: { report: TrustReport; t: T; crop: (c: string) => string }) {
  // Raw codes never reach the screen: each known code has a sentence, an unknown one is dropped.
  const sentences = [
    ...new Set(
      report.caveats.flatMap((raw) => {
        const c = parseCaveat(raw);
        if (!c) return [];
        const key = `cav_${c.code.replace(/-/g, "_")}` as "cav_unverified";
        return [t(key, { crop: crop(c.crop ?? "") })];
      }),
    ),
  ];
  const known = report.notModelled.filter((id) => t.has(`nm_${id}`));
  if (known.length === 0 && sentences.length === 0) return null;
  return (
    <Surface as="section" aria-labelledby="trust-nm">
      <h2 id="trust-nm" className="text-h2 text-ink">
        {t("nm_title")}
      </h2>
      {known.length > 0 && (
        <>
          <p className="mt-1 text-body text-ink-2">{t("nm_intro")}</p>
          <ul className="mt-2 list-disc pl-5 text-body text-ink">
            {known.map((id) => (
              <li key={id}>{t(`nm_${id}` as "nm_heat")}</li>
            ))}
          </ul>
        </>
      )}
      {sentences.length > 0 && (
        <ul className="mt-3 list-disc pl-5 text-body text-ink">
          {sentences.map((s) => (
            <li key={s}>{s}</li>
          ))}
        </ul>
      )}
    </Surface>
  );
}

function Retro({ r, fmt, t }: { r: Retrospective; fmt: Fmt; t: T }) {
  const agro = r.mode === "agronomy";
  const nodata = t("retro_nodata");
  const n = r.seasons.length;
  const show = (v: number | null) =>
    v === null
      ? nodata
      : agro
        ? `${fmt.number(v, { maximumFractionDigits: 0 })}%`
        : r.currency === "USD" || r.currency === "UAH"
          ? fmt.money(v, r.currency)
          : fmt.number(v, { maximumFractionDigits: 0 });
  // Money adds up; percentages of a usual yield do not, so estimate mode compares averages.
  const cur = agro ? averageOf(r.current.bySeason) : r.current.total;
  const rec = agro ? averageOf(r.recommended.bySeason) : r.recommended.total;
  const diff = cur !== null && rec !== null ? rec - cur : null;
  const same = diff !== null && (agro ? Math.abs(diff) < 1 : Math.round(diff) === 0);
  let verdict: string | null = null;
  if (diff !== null && cur !== null && rec !== null) {
    const dir = same ? "same" : diff > 0 ? "more" : "less";
    verdict = agro
      ? t(`retro_verdict_agro_${dir}` as "retro_verdict_agro_same", {
          n,
          rec: fmt.number(rec, { maximumFractionDigits: 0 }),
          cur: fmt.number(cur, { maximumFractionDigits: 0 }),
        })
      : t(`retro_verdict_money_${dir}` as "retro_verdict_money_same", { n, value: show(Math.abs(diff)) });
  }
  return (
    <Surface as="section" aria-labelledby="trust-retro" className="flex flex-col gap-3">
      <h2 id="trust-retro" className="text-h2 text-ink">
        {t("retro_title", { season: r.seasons[0] ?? "" })}
      </h2>
      {verdict && <p className="text-body font-semibold text-ink">{verdict}</p>}
      {diff !== null && diff < 0 && !same && <p className="text-body text-ink-2">{t("retro_note_less")}</p>}
      <p className="text-caption text-ink-2">{t("retro_label")}</p>
      <Disclosure summary={t("retro_table")}>
        <div className="overflow-x-auto pt-2">
          <table className="w-full text-body text-ink">
            <caption className="pb-2 text-left text-caption text-ink-2">{t(agro ? "retro_agronomy" : "retro_money")}</caption>
            <thead>
              <tr className="border-b border-line text-left text-caption text-ink-2">
                <th scope="col" className="py-2 pr-3 font-semibold">
                  {t("retro_season")}
                </th>
                <th scope="col" className="py-2 pr-3 text-right font-semibold">
                  {t("retro_current")}
                </th>
                <th scope="col" className="py-2 text-right font-semibold">
                  {t("retro_recommended")}
                </th>
              </tr>
            </thead>
            <tbody className="font-mono">
              {r.seasons.map((s, i) => (
                <tr key={s} className="border-b border-line">
                  <th scope="row" className="min-h-tap py-3 pr-3 text-left font-semibold">
                    {s}
                  </th>
                  <td className="py-3 pr-3 text-right">{show(r.current.bySeason[i] ?? null)}</td>
                  <td className="py-3 text-right">{show(r.recommended.bySeason[i] ?? null)}</td>
                </tr>
              ))}
              <tr className="font-semibold">
                <th scope="row" className="py-3 pr-3 text-left">
                  {t(agro ? "retro_average" : "retro_total")}
                </th>
                <td className="py-3 pr-3 text-right">{show(cur)}</td>
                <td className="py-3 text-right">{show(rec)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </Disclosure>
    </Surface>
  );
}
