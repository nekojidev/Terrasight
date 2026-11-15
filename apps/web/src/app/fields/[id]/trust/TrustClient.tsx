"use client";

import { useQuery } from "@tanstack/react-query";
import type { Retrospective, TrustFit, TrustReport, TrustYear } from "@terrasight/shared";
import { Button, Chip, Kicker, Skeleton, Surface } from "@terrasight/ui";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { ModelVsActualChart } from "@/components/ModelVsActualChart";
import { QueryState } from "@/components/QueryState";
import { ApiError, api } from "@/lib/api";
import { useFormat } from "@/lib/useFormat";
import { FieldTabs } from "../Overview";
import { cropLabel } from "../log/group";
import { readCase2022, readFit, readNdvi } from "./trustView";

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
  return (
    <>
      {report.case2022 && <Case2022 y={report.case2022} fmt={fmt} t={t} />}
      <Surface as="section" aria-labelledby="trust-fit" className="flex flex-col gap-4">
        <h2 id="trust-fit" className="text-h2 text-ink">
          {t("fit_title")}
        </h2>
        <Fit title={t(derz ? "fit_county_derzhstat" : "fit_county")} fit={report.vsCounty} fmt={fmt} t={t} />
        <Fit title={t("fit_ndvi")} fit={report.vsNdvi} fmt={fmt} t={t} />
        <p className="text-caption text-ink-2">{t("fit_rule")}</p>
      </Surface>
      <Surface as="section" aria-labelledby="trust-chart" className="flex flex-col gap-3">
        <h2 id="trust-chart" className="text-h2 text-ink">
          {t("chart_title")}
        </h2>
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
          highlightYears={report.case2022 ? [{ year: report.case2022.year, label: String(report.case2022.year) }] : []}
          missYears={years.filter((y) => y.miss).map((y) => y.year)}
          ariaLabel={t("chart_aria")}
          tableCaption={t("chart_caption")}
        />
      </Surface>
      <Missed years={years} hasCounty={report.vsCounty !== null} fmt={fmt} t={t} crop={crop} nodata={nodata} />
      <NotModelled report={report} t={t} crop={(c) => cropLabel(c, cropNames, fmt.locale, c)} />
      <Surface as="section" aria-labelledby="trust-src">
        <h2 id="trust-src" className="text-h2 text-ink">
          {t("src_title")}
        </h2>
        <p className="mt-2 text-body text-ink">{sourceText(report, t)}</p>
      </Surface>
      {report.retrospective && <Retro r={report.retrospective} fmt={fmt} t={t} />}
    </>
  );
}

function sourceText(report: TrustReport, t: T): string {
  const { kind, connected, area } = report.actual;
  if (kind === "nass" && connected) return area ? t("src_nass_area", { area }) : t("src_nass");
  if (kind === "derzhstat") return area ? t("src_derzhstat_area", { area }) : t("src_derzhstat");
  return t("src_none");
}

function Case2022({ y, fmt, t }: { y: TrustYear; fmt: Fmt; t: T }) {
  const nodata = t("c22_nodata");
  const reading = readCase2022(y);
  const ndvi = readNdvi(y);
  const gap = (n: number) => fmt.number(n, { maximumFractionDigits: 0 });
  const sentence = !reading
    ? t("c22_nomodel")
    : reading.kind === "nocounty"
      ? t("c22_nocounty")
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
    <Surface as="section" tone="hero" aria-labelledby="trust-2022" className="flex flex-col gap-4">
      <h2 id="trust-2022" className="text-h2 text-ink">
        {t("c22_title")}
      </h2>
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
      <p className="text-caption text-ink-2">{t("c22_rule")}</p>
    </Surface>
  );
}

function Fit({ title, fit, fmt, t }: { title: string; fit: TrustFit | null; fmt: Fmt; t: T }) {
  return (
    <div>
      <h3 className="text-body font-semibold text-ink">{title}</h3>
      {!fit || fit.n === 0 ? (
        <p className="text-body text-ink-2">{t("fit_none")}</p>
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
            <Chip tone={readFit(fit) === "close" ? "ok" : readFit(fit) === "loose" ? "week" : readFit(fit) === "few" ? "neutral" : "urgent"}>
              {t(`read_${readFit(fit)}` as "read_close")}
            </Chip>
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
}: {
  years: TrustYear[];
  hasCounty: boolean;
  fmt: Fmt;
  t: T;
  crop: (c: string | null) => string;
  nodata: string;
}) {
  const missed = years.filter((y) => y.miss);
  return (
    <Surface as="section" aria-labelledby="trust-miss">
      <h2 id="trust-miss" className="text-h2 text-ink">
        {t("miss_title")}
      </h2>
      <p className="mt-1 text-body text-ink-2">{t("miss_intro")}</p>
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
  const caveat = (c: string) => {
    const [code, arg] = c.split(":");
    return code === "unverified-crop-parameters" && arg
      ? t("cav_unverified", { crop: crop(arg) })
      : t("cav_other", { code: c });
  };
  return (
    <Surface as="section" aria-labelledby="trust-nm">
      <h2 id="trust-nm" className="text-h2 text-ink">
        {t("nm_title")}
      </h2>
      {report.notModelled.length > 0 && (
        <>
          <p className="mt-1 text-body text-ink-2">{t("nm_intro")}</p>
          <ul className="mt-2 list-disc pl-5 text-body text-ink">
            {report.notModelled.map((id) => (
              <li key={id}>{t.has(`nm_${id}`) ? t(`nm_${id}` as "nm_heat") : id}</li>
            ))}
          </ul>
        </>
      )}
      {report.caveats.length > 0 && (
        <ul className="mt-3 list-disc pl-5 text-body text-ink">
          {report.caveats.map((c) => (
            <li key={c}>{caveat(c)}</li>
          ))}
        </ul>
      )}
    </Surface>
  );
}

function Retro({ r, fmt, t }: { r: Retrospective; fmt: Fmt; t: T }) {
  const agro = r.mode === "agronomy";
  const nodata = t("retro_nodata");
  const show = (v: number | null) =>
    v === null
      ? nodata
      : agro
        ? `${fmt.number(v, { maximumFractionDigits: 0 })}%`
        : r.currency === "USD" || r.currency === "UAH"
          ? fmt.money(v, r.currency)
          : fmt.number(v, { maximumFractionDigits: 0 });
  const signed = (v: number | null) => (v === null ? nodata : `${v > 0 ? "+" : v < 0 ? "−" : ""}${show(Math.abs(v))}`);
  const diff =
    r.current.total !== null && r.recommended.total !== null ? r.recommended.total - r.current.total : null;
  return (
    <Surface as="section" aria-labelledby="trust-retro" className="flex flex-col gap-3">
      <h2 id="trust-retro" className="text-h2 text-ink">
        {t("retro_title", { season: r.seasons[0] ?? "" })}
      </h2>
      <p className="text-body font-semibold text-ink">{t("retro_label")}</p>
      <div className="overflow-x-auto">
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
                {t("retro_total")}
              </th>
              <td className="py-3 pr-3 text-right">{show(r.current.total)}</td>
              <td className="py-3 text-right">{show(r.recommended.total)}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <p className="text-body font-semibold text-ink">
        {t("retro_diff")}: <span className="font-mono">{signed(diff)}</span>
      </p>
    </Surface>
  );
}
