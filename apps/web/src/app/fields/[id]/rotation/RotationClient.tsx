"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { rank, type Metric, type ScenarioResult } from "@terrasight/scenario-engine";
import type { DecisionList } from "@terrasight/shared";
import {
  Button,
  Chip,
  Disclosure,
  FieldThumb,
  InfoHint,
  Kicker,
  SeasonStrip,
  SelectField,
  Surface,
  cropColour,
  seasonHintText,
} from "@terrasight/ui";
import { clsx } from "clsx";
import {
  Check,
  Droplet,
  Equal,
  Leaf,
  PiggyBank,
  ShieldCheck,
  Sparkles,
  TrendingDown,
  TrendingUp,
  TriangleAlert,
  Wallet,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useId, useMemo, useState } from "react";
import {
  type ClimateShift,
  type DataBasisItem,
  type YearSetComparison,
} from "@terrasight/shared";
import { api, ApiError } from "@/lib/api";
import { ClimateShiftCard } from "@/components/ClimateShiftCard";
import { DataBasis } from "@/components/DataBasis";
import { CaveatNotes } from "@/components/CaveatNotes";
import { CropPricesEditor } from "@/components/CropPricesEditor";
import { NoticeStack } from "@/components/NoticeStack";
import { SuggestionChips } from "@/components/SuggestionChips";
import { TrustLine } from "@/components/TrustLine";
import { askHref } from "@/lib/ask";
import { QueryState } from "@/components/QueryState";
import { useFormat } from "@/lib/useFormat";
import { useActionToast } from "@/lib/useActionToast";
import { FieldTabs } from "../Overview";
import { LandBanner, LandBlocked, type LandView } from "@/components/LandSuitability";
import { CumulativeChart } from "./CumulativeChart";
import { YearSets } from "./YearSets";
import { RunProgress } from "./RunProgress";
import {
  defaultOptionIds,
  noWeatherSpread,
  pestKey,
  priceSourceKind,
  reliabilityOf,
  relaxedKey,
  rerankYearSets,
  visibleNotice,
} from "./rotationView";

type Localised = { en: string; uk: string };
interface RunView {
  id: string | null;
  noLibrary: boolean;
  /** Unsuitable land (not overridden): nothing was simulated, the page explains why. */
  landUnsuitable?: boolean;
  firstSeason: number;
  regionVerify: boolean;
  missingPrices: string[];
  /** Set when nothing was simulated: what is missing instead. */
  pending?: "prices" | "crop-history" | "crops" | null;
  regionId?: string | null;
  unmodelledCrops?: string[];
  currentBasis?: "baseline" | "detected" | "estimated" | "missing";
  lastSeason?: number;
  soilBasis?: "ssurgo" | "soilgrids" | "default";
  candidates?: Array<{
    id: string;
    name: Localised;
    sequence: Array<string | { main: string; second: string }>;
    rationale?: Localised | null;
    risks?: Localised | null;
    irrigation?: "required" | "optional" | "none";
  }>;
  /** "agronomy" = no prices: no margin anywhere, ranking by water, soil and drought resilience only. */
  mode?: "money" | "agronomy";
  currency?: "USD" | "UAH";
  /** Whose prices the margins use: the company's, the verified library's, or both. */
  priceLabel?: "company" | "library" | "mixed" | null;
  cropsNeedingPrices?: string[];
  needYield?: string[];
  yieldHints?: Record<string, { meanTHa: number; oblast: string }>;
  priceAsOf: string;
  /** AI-proposed options: "unavailable" = the assistant could not be reached, only library options are shown. */
  aiStatus?: "ok" | "unavailable" | "skipped";
  names: Record<string, Localised>;
  cropNames?: Record<string, Localised>;
  /** What NASA (and other) data fed this run; absent on older runs. */
  dataBasis?: DataBasisItem[];
  /** The weather years the run used; absent on older runs: then no year range is shown. */
  weather?: { yearSet: string; from: number; to: number; count: number; lastDate: string | null };
  result: {
    current: ScenarioResult;
    alternatives: ScenarioResult[];
    candidates: number;
    relaxed: string[];
    bestFit: string | null;
  };
}

type Overrides = { deltaT?: number; precipFactor?: number; waterCapMm?: number };

const AC = 2.471054;
const PRIORITY: Array<{ key: Metric; icon: React.ReactNode; label: string }> = [
  { key: "margin", icon: <PiggyBank />, label: "p_profit" },
  { key: "water", icon: <Droplet />, label: "p_water" },
  { key: "soil", icon: <Leaf />, label: "p_soil" },
  { key: "drought", icon: <ShieldCheck />, label: "p_drought" },
];

const seqCrops = (s: string | { main: string; second: string }) =>
  typeof s === "string" ? [s] : [s.main, s.second];

/** One collapsed evidence row: a title and a one-line summary while closed; `#id` in the URL opens it. */
function EvidenceRow({
  id,
  title,
  note,
  children,
}: {
  id: string;
  title: string;
  note: string;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const sync = () => {
      if (window.location.hash === `#${id}`) {
        setOpen(true);
        document.getElementById(id)?.scrollIntoView?.({ block: "start" });
      }
    };
    sync();
    window.addEventListener("hashchange", sync);
    return () => window.removeEventListener("hashchange", sync);
  }, [id]);
  return (
    <section id={id} className="scroll-mt-20 rounded-card border border-line bg-surface px-4 py-1">
      <Disclosure open={open} onOpenChange={setOpen} id={`${id}-panel`} summary={title} summaryNote={note}>
        {children}
      </Disclosure>
    </section>
  );
}

function FieldHeader({
  fieldId,
  fieldName,
  thumb,
  crop,
}: {
  fieldId: string;
  fieldName: string;
  thumb: string | null;
  crop: string | null;
}) {
  return (
    <header className="flex flex-col gap-3">
      <div className="flex items-center gap-4">
        <FieldThumb name={fieldName} outline={thumb} crop={crop} size={56} />
        <h1 className="text-h1 text-ink">{fieldName}</h1>
      </div>
      <FieldTabs fieldId={fieldId} active={2} />
    </header>
  );
}

/** The agronomist enters the last 3 crops (stored as crop-season overrides); never invented, never guessed silently. */
function CropHistoryForm({
  workspaceId,
  fieldId,
  lastSeason,
  cropNames,
  estimated,
  canSave,
  primary,
}: {
  workspaceId: string;
  fieldId: string;
  lastSeason: number;
  cropNames: Record<string, Localised>;
  estimated: boolean;
  canSave: boolean;
  /** Only the one primary button of the screen is filled; here it is an outline unless this form is the screen's job. */
  primary: boolean;
}) {
  const t = useTranslations("App");
  const locale = useLocale() as "en" | "uk";
  const qc = useQueryClient();
  const { fail } = useActionToast();
  const seasons = [lastSeason - 2, lastSeason - 1, lastSeason];
  const [picked, setPicked] = useState<Record<number, string>>({});
  const options = Object.entries(cropNames)
    .map(([value, n]) => ({ value, label: n[locale] }))
    .sort((a, b) => a.label.localeCompare(b.label, locale));
  const save = useMutation({
    mutationFn: async () => {
      for (const season of seasons)
        if (picked[season])
          await api(`/api/w/${workspaceId}/fields/${fieldId}/crop-seasons/${season}`, {
            method: "PUT",
            body: { mainCrop: picked[season], secondCrop: null },
          });
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["scenarios", workspaceId, fieldId] }),
    onError: (e) => fail(e, t("rotHistTitle"), () => save.mutate()),
  });
  return (
    <Surface as="section" pad="lg">
      <h2 className="text-h2 text-ink">{t("rotHistTitle")}</h2>
      <p className="mb-4 text-body text-ink-2">{estimated ? t("rotHistEstimated") : t("rotPendHistory")}</p>
      <div className="grid gap-4 sm:grid-cols-3">
        {seasons.map((season) => (
          <SelectField
            key={season}
            label={String(season)}
            value={picked[season] ?? ""}
            onChange={(e) => setPicked({ ...picked, [season]: e.target.value })}
            options={[{ value: "", label: t("rotHistPick") }, ...options]}
            disabled={!canSave}
          />
        ))}
      </div>
      {canSave && (
        <Button
          className="mt-4"
          variant={primary ? "primary" : "outline"}
          onClick={() => save.mutate()}
          disabled={save.isPending || seasons.some((y) => !picked[y])}
          aria-busy={save.isPending}
        >
          {t("rotHistSave")}
        </Button>
      )}
    </Surface>
  );
}

/** Rotation screen (design 10, S-06.04): decision first, evidence below; priorities re-rank in the browser. */
const METRICS: Array<{ key: Metric; label: string }> = [
  { key: "margin", label: "rotDotMargin" },
  { key: "water", label: "rotDotWater" },
  { key: "soil", label: "rotDotSoil" },
  { key: "drought", label: "rotDotDrought" },
];

function Dots({ n, label, strong }: { n: number; label: string; strong: boolean }) {
  return (
    <span role="img" aria-label={label} className="flex items-center gap-1">
      {[1, 2, 3, 4, 5].map((i) => (
        <span
          key={i}
          className={`block size-3 rounded-full ${i <= n ? (strong ? "bg-ink" : "bg-ink-2") : "bg-line"}`}
        />
      ))}
      <span aria-hidden className="ml-1 font-mono text-caption text-ink-2">
        {n}/5
      </span>
    </span>
  );
}

export function RotationClient({
  workspaceId,
  fieldId,
  fieldName,
  thumb = null,
  crop = null,
  units,
  canSave,
}: {
  workspaceId: string;
  fieldId: string;
  fieldName: string;
  thumb?: string | null;
  crop?: string | null;
  units: "metric" | "imperial";
  canSave: boolean;
}) {
  const r = useTranslations("Rotation");
  const { fail } = useActionToast();
  // Climate sliders and the water cap re-run the simulation (S-06.07); results are cached by inputs hash.
  const [overrides, setOverrides] = useState<Overrides>({});
  const run = useQuery({
    queryKey: ["scenarios", workspaceId, fieldId, overrides],
    queryFn: () =>
      api<RunView>(`/api/w/${workspaceId}/fields/${fieldId}/scenario-runs`, { body: { overrides } }),
    staleTime: Infinity,
    placeholderData: (prev) => prev,
  });

  // Land suitability comes with the field (same query as the field page), so the override refreshes both.
  const land = useQuery({
    queryKey: ["field", workspaceId, fieldId, "info"],
    queryFn: () =>
      api<{ suitability?: LandView | null; country?: string | null }>(
        `/api/w/${workspaceId}/fields/${fieldId}`,
      ),
  });

  // A re-run that fails keeps the old numbers on screen and says so in a toast with Retry.
  const failedWithData = run.isError && run.data !== undefined;
  const { error: runErr, errorUpdatedAt, refetch } = run;
  const what = r("run_error_what");
  useEffect(() => {
    if (failedWithData) fail(runErr, what, () => void refetch());
  }, [failedWithData, errorUpdatedAt, runErr, what, fail, refetch]);

  // Climate shift reads the cached NASA POWER series, not the rotation run: it renders before the run resolves.
  const climate = useQuery({
    queryKey: ["field", workspaceId, fieldId, "climate-shift"],
    queryFn: () => api<ClimateShift>(`/api/w/${workspaceId}/fields/${fieldId}/climate-shift`),
    refetchInterval: (q) => (q.state.data?.status === "pending" ? 5_000 : false),
    retry: (count, e) => !(e instanceof ApiError && e.problem.status === 404) && count < 2,
  });

  // The weather-year comparison starts only after the main run has resolved, and never blocks it.
  const runReady =
    run.isSuccess &&
    !run.isPlaceholderData &&
    !run.data.pending &&
    !run.data.noLibrary &&
    !run.data.landUnsuitable;
  const yearSets = useQuery({
    queryKey: ["scenarios", workspaceId, fieldId, "year-sets", overrides],
    queryFn: () =>
      api<YearSetComparison>(`/api/w/${workspaceId}/fields/${fieldId}/scenario-runs/year-sets`, {
        body: { overrides },
      }),
    enabled: runReady,
    staleTime: Infinity,
    retry: (count, e) => !(e instanceof ApiError && e.problem.status === 404) && count < 1,
  });

  const header = <FieldHeader fieldId={fieldId} fieldName={fieldName} thumb={thumb} crop={crop} />;
  // The Owner decides; a waiting decision about this field is linked from the read-only view.
  const decisions = useQuery({
    queryKey: ["decisions", workspaceId, "all"],
    queryFn: () => api<DecisionList>(`/api/w/${workspaceId}/decisions?state=all`),
    enabled: !canSave,
  });
  const waitingDecision = (decisions.data?.items ?? []).some(
    (d) => d.fieldId === fieldId && (d.state === "waiting" || d.state === "question"),
  );
  const climateCard = (
    <ClimateShiftCard
      data={climate.data}
      isLoading={climate.isLoading}
      isError={climate.isError}
      onRetry={() => void climate.refetch()}
      {...(land.data?.country ? { country: land.data.country } : {})}
      units={units}
      trustHref={`/fields/${fieldId}/trust`}
      compact
      collapsed
    />
  );
  return (
    <div className="flex flex-col gap-6">
      {header}
      <QueryState query={run} what={r("run_error_what")} skeleton={<RunProgress agro={false} />}>
        {(data) => (
          <RotationBody
            data={data}
            workspaceId={workspaceId}
            fieldId={fieldId}
            fieldName={fieldName}
            units={units}
            canSave={canSave}
            waitingDecision={waitingDecision}
            country={land.data?.country ?? null}
            climateCard={climateCard}
            suitability={land.data?.suitability ?? null}
            fetching={run.isFetching}
            overrides={overrides}
            setOverrides={setOverrides}
            yearSets={yearSets}
          />
        )}
      </QueryState>
    </div>
  );
}

function RotationBody({
  data,
  workspaceId,
  fieldId,
  fieldName,
  units: workspaceUnits,
  canSave,
  waitingDecision,
  country,
  climateCard,
  suitability,
  fetching,
  overrides,
  setOverrides,
  yearSets,
}: {
  data: RunView;
  workspaceId: string;
  fieldId: string;
  fieldName: string;
  units: "metric" | "imperial";
  canSave: boolean;
  waitingDecision: boolean;
  country: string | null;
  climateCard: React.ReactNode;
  suitability: LandView | null;
  fetching: boolean;
  overrides: Overrides;
  setOverrides: (o: Overrides) => void;
  yearSets: {
    data: YearSetComparison | undefined;
    isError: boolean;
    error: unknown;
    refetch: () => unknown;
  };
}) {
  const t = useTranslations("App");
  const r = useTranslations("Rotation");
  const locale = useLocale() as "en" | "uk";
  // Amounts follow the field's country (US: per acre), not only the workspace setting.
  const units: "metric" | "imperial" = country
    ? country.toUpperCase() === "US"
      ? "imperial"
      : "metric"
    : workspaceUnits;
  const fmt = useFormat({ units });
  const router = useRouter();
  const { fail } = useActionToast();
  const groupName = useId();
  const [priority, setPriority] = useState<Metric>("margin");
  const [chosen, setChosen] = useState<string | null>(null);
  const [showPrices, setShowPrices] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const [draft, setDraft] = useState({
    deltaT: overrides.deltaT ?? 0,
    rain: overrides.precipFactor ? Math.round((overrides.precipFactor - 1) * 100) : 0,
    cap: overrides.waterCapMm ?? 0,
  });

  const agro = data.mode === "agronomy";
  const cur = data.currency ?? "USD";
  const unit = r(units === "imperial" ? "unit_ac" : "unit_ha");
  /** Per-hectare amounts shown in the field's unit (per acre for US fields). */
  const perUnit = (perHa: number) => (units === "imperial" ? perHa / AC : perHa);
  const money = (perHa: number) => fmt.money(perUnit(perHa), cur);
  const signed = (perHa: number) => `${perHa >= 0 ? "+" : "−"}${fmt.money(Math.abs(perUnit(perHa)), cur)}`;
  const signedPlain = (perHa: number) => `${perHa < 0 ? "−" : ""}${fmt.money(Math.abs(perUnit(perHa)), cur)}`;
  /** Without prices the "money" priority does not exist: the picker offers water, soil and drought only. */
  const priorities = agro ? PRIORITY.filter((p) => p.key !== "margin") : PRIORITY;
  const effPriority: Metric = agro && priority === "margin" ? "water" : priority;

  const weights = useMemo(
    () =>
      ({ margin: agro ? 0 : 0.25, water: 0.25, soil: 0.25, drought: 0.25, [effPriority]: 3 }) as Record<
        Metric,
        number
      >,
    [effPriority, agro],
  );
  const scenarios = useMemo(() => {
    if (!data.result) return [];
    const all = [data.result.current, ...data.result.alternatives];
    return rank(all, weights);
  }, [data, weights]);
  const best = scenarios.reduce<ScenarioResult | null>(
    (b, s) => (!b || (s.score ?? 0) > (b.score ?? 0) ? s : b),
    null,
  );
  const pick = scenarios.find((s) => s.id === chosen) ?? best;
  const first = data.firstSeason ?? 2026;
  const firstCrop = pick?.plan[0]?.crops.filter((c) => c !== "fallow")[0] ?? pick?.plan[0]?.crops[0];

  const save = useMutation({
    mutationFn: () =>
      api(`/api/w/${workspaceId}/fields/${fieldId}/plans/${first}`, {
        method: "PUT",
        body: {
          crop: firstCrop,
          rotationId: pick?.kind === "current" ? null : pick?.id,
          scenarioRunId: data.id,
        },
      }),
    onError: (e) => fail(e, r("save_what"), () => save.mutate()),
  });

  const cropLabel = (c: string) => data.cropNames?.[c]?.[locale] ?? r("crop_unknown");
  const histForm = (estimated: boolean, primary: boolean) =>
    data.cropNames && data.lastSeason ? (
      <CropHistoryForm
        workspaceId={workspaceId}
        fieldId={fieldId}
        lastSeason={data.lastSeason}
        cropNames={data.cropNames}
        estimated={estimated}
        canSave={canSave}
        primary={primary}
      />
    ) : null;

  if (data.landUnsuitable || suitability?.blocked)
    return suitability ? (
      <LandBlocked workspaceId={workspaceId} fieldId={fieldId} suitability={suitability} canEdit={canSave} />
    ) : null;
  if (data.noLibrary)
    return (
      <Surface as="p" pad="lg" className="text-body text-ink-2">
        {t("rotNoLibrary")}
      </Surface>
    );
  if (data.pending) {
    const d = data;
    return (
      <>
        {d.pending === "crops" && (
          <Surface tone="inset" className="flex items-center gap-2 text-body text-ink">
            <TriangleAlert aria-hidden className="size-5 shrink-0 text-week" />
            {t("rotPendCrops", { list: (d.unmodelledCrops ?? []).map(cropLabel).join(", ") })}
          </Surface>
        )}
        {d.pending === "crop-history" && histForm(false, true)}
        {d.pending !== "crop-history" && d.currentBasis === "estimated" && histForm(true, true)}
        {d.regionVerify && <p className="text-caption text-ink-2">{t("rotVerify")}</p>}
        {d.candidates && d.candidates.length > 0 && (
          <section>
            <h2 className="text-h2 text-ink">{t("rotCandidates")}</h2>
            <p className="mb-4 text-body text-ink-2">{t("rotCandSub")}</p>
            <ul className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {d.candidates.map((c, i) => {
                const n = Math.max(1, c.sequence.length);
                const tiles = Array.from({ length: 5 }, (_, k) => {
                  const item = c.sequence[k % n]!;
                  return { year: d.firstSeason + k, crops: seqCrops(item) };
                });
                return (
                  <Surface
                    as="li"
                    key={c.id}
                    className="animate-rise stagger flex flex-col gap-3"
                    style={{ "--i": i } as React.CSSProperties}
                  >
                    <h3 className="text-body font-semibold text-ink">{c.name[locale]}</h3>
                    <ul className="flex gap-1.5" aria-label={`${d.firstSeason}–${d.firstSeason + 4}`}>
                      {tiles.map((x) => (
                        <li key={x.year} className="flex min-w-0 flex-1 flex-col items-center gap-1">
                          <span
                            aria-hidden
                            className="block h-9 w-full rounded-chip"
                            style={{ backgroundColor: cropColour(x.crops[0] ?? "fallow") }}
                          />
                          <span className="font-mono text-caption text-ink-2">{x.year}</span>
                          <span className="sr-only">{x.crops.map(cropLabel).join(" + ")}</span>
                        </li>
                      ))}
                    </ul>
                    <p className="flex flex-wrap gap-x-3 text-caption text-ink-2">
                      <span>{t("rotYears", { n: c.sequence.length })}</span>
                      {c.irrigation === "required" && <span>{t("rotNeedsIrrigation")}</span>}
                    </p>
                    {c.rationale?.[locale] && (
                      <p className="text-caption text-ink-2">
                        <span className="font-semibold text-ink">{t("rotWhyFits")}: </span>
                        {c.rationale[locale]}
                      </p>
                    )}
                  </Surface>
                );
              })}
            </ul>
          </section>
        )}
      </>
    );
  }

  const current = data.result.current;
  const letters = ["A", "B", "C", "D", "E"];
  const seasons = Array.from({ length: 5 }, (_, i) => first + i);
  const metrics = agro ? METRICS.filter((m) => m.key !== "margin") : METRICS;
  const pestName = (id: string) => r(pestKey(id, (k) => r.has(k)));

  /** 1–5 dots, relative among the compared options (exact values are in "All numbers"). */
  const carbonKnown = scenarios.every((x) => x.carbonChange != null);
  const dots = (s: ScenarioResult, m: Metric) => {
    const v = (x: ScenarioResult) =>
      m === "margin"
        ? (x.margin ?? 0)
        : m === "water"
          ? -x.water
          : m === "soil"
            ? (carbonKnown ? (x.carbonChange ?? 0) : 0) - x.erosion / 100
            : (x.drought ?? x.droughtYield);
    const vals = scenarios.map(v);
    const lo = Math.min(...vals);
    const hi = Math.max(...vals);
    return hi - lo < 1e-9 ? 3 : 1 + Math.round(((v(s) - lo) / (hi - lo)) * 4);
  };

  const pros = (s: ScenarioResult): string[] => {
    if (s.kind === "current") return [t("rotProCurrent")];
    const out: string[] = [];
    if (s.delta.margin != null && s.delta.margin > 0)
      out.push(t("rotProMargin", { delta: signed(s.delta.margin), unit }));
    if (s.water < current.water - 5)
      out.push(t("rotProWater", { amount: fmt.rain(current.water - s.water) }));
    if (
      s.carbonChange != null &&
      current.carbonChange != null &&
      s.carbonChange > current.carbonChange + 0.05
    )
      out.push(t("rotProCarbon"));
    if (s.erosion < current.erosion * 0.9) out.push(t("rotProErosion"));
    if (agro) {
      if (s.droughtYield > current.droughtYield + 0.005)
        out.push(
          t("rotProDroughtYield", { delta: Math.round((s.droughtYield - current.droughtYield) * 100) }),
        );
    } else if (s.drought != null && current.drought != null && s.drought > current.drought)
      out.push(t("rotProDrought", { delta: signed(s.drought - current.drought), unit }));
    const pestsNow = current.pestPressure.filter((p) => p.seasons > 0).length;
    if (s.pestPressure.filter((p) => p.seasons > 0).length < pestsNow) out.push(t("rotProPest"));
    return out;
  };
  const cons = (s: ScenarioResult): string[] => {
    const out: string[] = [];
    if (s.kind !== "current") {
      if (s.delta.margin != null && s.delta.margin < 0)
        out.push(t("rotConMargin", { delta: signed(s.delta.margin), unit }));
      if (s.water > current.water + 5)
        out.push(t("rotConWater", { amount: fmt.rain(s.water - current.water) }));
      if (agro ? s.droughtYield < current.droughtYield - 0.005 : (s.drought ?? 0) < (current.drought ?? 0))
        out.push(t(agro ? "rotConDroughtYield" : "rotConDrought"));
    }
    if (s.capped && !agro)
      out.push(t("rotCapped", { loss: fmt.number(Math.abs(perUnit(s.capLoss))), unit, cur }));
    for (const p of s.pestPressure.filter((x) => x.seasons > 0))
      out.push(t("rotPestLine", { pest: pestName(p.pest), n: p.seasons }));
    if (!agro && s.priceWins < 5) out.push(t("rotConPrice", { n: s.priceWins }));
    return out;
  };
  const name = (s: ScenarioResult) =>
    s.kind === "current"
      ? data.currentBasis === "estimated"
        ? t("rotCurrentEstimated")
        : s.label === "detected"
          ? t("rotDetected")
          : t("rotCurrent")
      : (data.names[s.id]?.[locale] ?? t("rotAlt", { letter: letters[scenarios.indexOf(s)] ?? "" }));
  const rationaleOf = (s: ScenarioResult) =>
    (s as ScenarioResult & { rationale?: Localised }).rationale?.[locale] ?? "";
  /** Crops the price table lists: the ones missing a price (agronomy mode) or those of the compared options. */
  const priceCrops = agro
    ? (data.cropsNeedingPrices ?? [])
    : [
        ...new Set(
          [current, ...data.result.alternatives].flatMap((s) =>
            s.plan.flatMap((p) => p.crops).filter((c) => c !== "fallow"),
          ),
        ),
      ];

  // Cumulative margin (sum of simulated years, no extrapolation).
  const cum = scenarios.map((s) =>
    (s.marginBySeason ?? []).reduce<number[]>((acc, m) => [...acc, (acc.at(-1) ?? 0) + perUnit(m)], []),
  );
  // Establishment dip: a weak first year followed by a clearly better one (e.g. alfalfa).
  const dips = scenarios.flatMap((s, k) => {
    const m = s.marginBySeason ?? [];
    const later = Math.max(...m.slice(1), 0);
    return m.length > 1 && later > 0 && m[0]! < 0.4 * later ? [k] : [];
  });

  // The headline: what to sow, the difference against today, and how far to trust it.
  const isCurrent = pick?.kind === "current";
  const rel = reliabilityOf({
    agro,
    isCurrent,
    priceWins: pick?.priceWins ?? 10,
    currentBasis: data.currentBasis,
    soilBasis: data.soilBasis,
  });
  const diff = (() => {
    if (!pick || isCurrent) return { icon: <Equal />, text: r("diff_same") };
    if (agro) {
      const d = Math.round(pick.delta.drought * 100);
      if (d > 0) return { icon: <TrendingUp />, text: r("diff_agro_more", { n: d }) };
      if (d < 0) return { icon: <TrendingDown />, text: r("diff_agro_less", { n: -d }) };
      return { icon: <Equal />, text: r("diff_same") };
    }
    const dm = pick.delta.margin ?? 0;
    if (Math.round(Math.abs(perUnit(dm))) === 0) return { icon: <Equal />, text: r("diff_same") };
    const amount = fmt.moneyPerArea(Math.abs(dm), cur);
    return dm > 0
      ? { icon: <TrendingUp />, text: r("hd_more", { amount }) }
      : { icon: <TrendingDown />, text: r("hd_less", { amount }) };
  })();
  /** Agronomy-only: the pick has a lower bad-year yield than today; say why it is still recommended. */
  const agroWhy = (() => {
    if (!agro || !pick || isCurrent) return null;
    const d = Math.round(pick.delta.drought * 100);
    if (d >= 0) return null;
    const why = pros(pick)
      .filter((x) => x !== t("rotProCurrent"))
      .slice(0, 2)
      .join("; ");
    return why ? r("agro_less_why", { n: -d, why }) : r("agro_less_plain", { n: -d });
  })();
  const priceKind = priceSourceKind({ priceLabel: data.priceLabel, regionId: data.regionId });
  const priceLine =
    priceKind === "company"
      ? t("rotPricesCompany", { cur })
      : priceKind === "mixed"
        ? t("rotPricesMixed")
        : priceKind === "library_us"
          ? r("price_library_us", { asOf: data.priceAsOf })
          : priceKind === "library"
            ? r("price_library", { asOf: data.priceAsOf })
            : null;
  const priceChip =
    priceKind === "company"
      ? r("price_chip_company")
      : priceKind === "mixed"
        ? r("price_chip_mixed")
        : priceKind
          ? r("price_chip_library")
          : null;

  // One visible notice at most; everything else goes into "Notes on these numbers".
  const notice = visibleNotice({
    landLimited: suitability?.status === "limited",
    agro,
    estimatedCurrent: data.currentBasis === "estimated",
  });
  const noteItems: string[] = [
    r(agro ? "note_agro" : "note_money", { n: data.result.candidates + 1 }),
    ...(agro ? [t("rotAgroSub")] : []),
    ...(agro ? [t("rotAgroWhy")] : []),
    ...(data.regionVerify ? [t("rotVerify")] : []),
    ...(!agro && priceLine ? [priceLine] : []),
    ...(data.aiStatus === "unavailable" ? [t("rotAiUnavailable")] : []),
    ...(data.soilBasis === "soilgrids" ? [t("rotSoilEstimate")] : []),
    ...((data.unmodelledCrops?.length ?? 0) > 0
      ? [t("rotNotCompared", { list: data.unmodelledCrops!.map(cropLabel).join(", ") })]
      : []),
    ...(data.result.relaxed.length > 0
      ? [t("rotRelaxed", { list: data.result.relaxed.map((id) => r(relaxedKey(id))).join(", ") })]
      : []),
    t("rotIrrHint"),
  ];

  // Weather years of this run, from the run itself: no fixed range is ever printed.
  const w = data.weather;
  const weatherLine = w
    ? w.lastDate
      ? r("weather_line", {
          from: w.from,
          to: w.to,
          count: w.count,
          date: fmt.date(`${w.lastDate.slice(0, 10)}T12:00:00Z`, "full", { timeZone: "UTC" }),
        })
      : r("weather_line_nolast", { from: w.from, to: w.to, count: w.count })
    : null;

  // Sensitivity to the weather years (ranked with the headline's priority): the label of an option is its letter and name, as in the rest of the page.
  const optionLabel = (id: string) => {
    const k = scenarios.findIndex((x) => x.id === id);
    const s = scenarios[k];
    return s ? `${letters[k] ?? ""} · ${name(s)}` : (yearSets.data?.names[id]?.[locale] ?? r("crop_unknown"));
  };

  const saveLabel = save.isSuccess ? t("rotSaved", { season: first }) : t("rotSave", { season: first });
  // The weather-year sets are ranked with the same priority as the headline (and the page's own order for "all").
  const rankedSets = yearSets.data ? rerankYearSets(yearSets.data, scenarios, weights, agro) : undefined;
  const flat = !agro && noWeatherSpread(scenarios);
  const optionLetter = (id: string) => letters[scenarios.findIndex((x) => x.id === id)] ?? "";
  const visibleIds = new Set(
    showAll ? scenarios.map((x) => x.id) : defaultOptionIds(scenarios, best?.id ?? null, chosen),
  );
  const group = (x: ScenarioResult) => (x.kind === "current" ? 0 : x.id === best?.id ? 1 : 2);
  const shown = scenarios
    .filter((x) => visibleIds.has(x.id))
    .sort((a, b) => group(a) - group(b) || (b.score ?? 0) - (a.score ?? 0));
  const seqOf = (x: ScenarioResult) => x.plan.map((q) => q.crops.map(cropLabel).join(" + ")).join(" → ");
  /** Signed money per area in the field's unit: "−$192 per ac". */
  const perArea = (perHa: number) => `${perHa < 0 ? "−" : ""}${fmt.moneyPerArea(Math.abs(perHa), cur)}`;
  const whyLine = (x: ScenarioResult) => (x.source === "ai" && rationaleOf(x)) || pros(x)[0] || "";
  const questions = [
    ...(pick && !isCurrent
      ? [{ id: "why", text: r("ask_why", { crop: cropLabel(firstCrop ?? "fallow") }) }]
      : []),
    { id: "bad", text: r("ask_bad_year") },
    { id: "safe", text: r("ask_safe") },
  ].slice(0, 3);
  const evOpen = (id: string, title: string, note: string, children: React.ReactNode) => (
    <EvidenceRow key={id} id={id} title={title} note={note}>
      {children}
    </EvidenceRow>
  );
  const y22 = scenarios.map((x) => {
    const ok = Number.isFinite(x.if2022.margin) && Number.isFinite(x.if2022.typical);
    return { s: x, ok, same: ok && Math.abs(perUnit(x.if2022.typical - x.if2022.margin)) < 0.5 };
  });
  const y22Same = y22.length > 0 && y22.every((x) => x.same);
  const pickY22 = pick ? y22.find((x) => x.s.id === pick.id) : undefined;
  const hasWaitingDecision = waitingDecision;

  const dataLine = (
    <div className="flex flex-col gap-1">
      <p className="text-caption text-ink-2">{r(agro ? "rel_basis_agro" : "rel_basis_money")}</p>
      {rel !== "high" && <p className="text-caption text-ink-2">{r("rel_check")}</p>}
      {weatherLine && <p className="text-caption text-ink-2">{weatherLine}</p>}
      <p className="text-caption text-ink-2">
        {t("rotBannerSub", { from: first, to: first + 4 })}{" "}
        <InfoHint label={t("hintLabel")}>
          {seasonHintText(t("hintSeason"), first)} {t("hintHorizon")}
        </InfoHint>
      </p>
      {!agro && priceChip && (
        <div className="mt-1">
          <Chip tone="neutral">{priceChip}</Chip>
        </div>
      )}
    </div>
  );

  return (
    <div className="flex flex-col gap-8">
      {/* 1. The decision: headline, one trust line, the primary action, three questions */}
      <Surface
        as="section"
        tone="hero"
        pad="lg"
        aria-labelledby="headline"
        className="animate-rise flex flex-col gap-4"
      >
        <div className="flex items-start gap-4">
          <span
            aria-hidden
            className="size-14 shrink-0 rounded-chip border-4 border-line"
            style={{ backgroundColor: cropColour(firstCrop ?? "fallow") }}
          />
          <div className="min-w-0">
            <Kicker>
              {chosen && chosen !== best?.id
                ? t("rotYourChoice", { season: first })
                : agro
                  ? t("rotRecommendedAgro", { season: first })
                  : t("rotRecommended", { season: first })}
            </Kicker>
            <h2 id="headline" className="text-h1 text-ink">
              {r("h_sow", { crop: cropLabel(firstCrop ?? "fallow"), season: first })}
            </h2>
          </div>
        </div>
        <p className="flex items-start gap-2 text-body font-semibold text-ink [&>span>svg]:mt-0.5 [&>span>svg]:size-5 [&>span>svg]:shrink-0">
          <span aria-hidden className="inline-flex">
            {diff.icon}
          </span>
          {diff.text}
        </p>
        {agroWhy && <p className="text-body text-ink">{agroWhy}</p>}
        {pick && (
          <p className="text-body text-ink-2" data-testid="plan-line">
            {r("plan_line", { from: first, to: first + 4, seq: seqOf(pick) })}
          </p>
        )}
        <TrustLine
          reliability={rel}
          {...(data.currentBasis === "estimated" ? { estimate: true } : {})}
          sources={(data.dataBasis ?? []).map((b) => b.dataset)}
          lastDate={w?.lastDate ?? null}
          href={`/fields/${fieldId}/trust`}
        />
        {canSave ? (
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <Button
              size={48}
              icon={<Check />}
              onClick={() => save.mutate()}
              disabled={save.isPending || !firstCrop}
              aria-busy={save.isPending}
              className="justify-center"
            >
              {saveLabel}
            </Button>
          </div>
        ) : (
          <div className="flex flex-col gap-1">
            <p className="text-body text-ink-2">{r("owner_only")}</p>
            {hasWaitingDecision && (
              <p className="text-body text-ink">
                {r("owner_decision")}{" "}
                <Link
                  href="/decisions"
                  className="focus-ring inline-flex min-h-tap items-center font-semibold underline underline-offset-4"
                >
                  {r("owner_decision_link")}
                </Link>
              </p>
            )}
          </div>
        )}
        <SuggestionChips questions={questions} onAsk={(q) => router.push(askHref(q.text, { fieldId }))} />
      </Surface>

      {/* One notice at most, below the decision */}
      {notice === "land" && <LandBanner suitability={suitability} fieldId={fieldId} />}
      {notice === "agro" && (
        <div className="flex flex-col gap-3">
          <NoticeStack
            notices={[
              {
                id: "agro",
                tone: "info",
                title: t("rotAgroTitle"),
                body: t("rotAgroDo"),
                ...(canSave
                  ? { action: { label: t("rotEnterPrices"), onClick: () => setShowPrices((v) => !v) } }
                  : {}),
              },
            ]}
          />
          {canSave && showPrices && (
            <CropPricesEditor
              workspaceId={workspaceId}
              crops={priceCrops}
              needYield={data.needYield}
              yieldHints={data.yieldHints}
              onSaved={() => setShowPrices(false)}
              onCancel={() => setShowPrices(false)}
            />
          )}
        </div>
      )}
      {notice === "estimate" && histForm(true, false)}
      {fetching && <RunProgress agro={agro} compact />}

      {/* 2. The options to compare */}
      <section className="flex flex-col gap-4" aria-labelledby="options">
        <div>
          <h2 id="options" className="text-h2 text-ink">
            {r("opts_title", { n: scenarios.length })}
          </h2>
          <p className="text-body text-ink-2">{r("opts_pick_hint")}</p>
        </div>

        <fieldset role="radiogroup" className="flex flex-col gap-2">
          <legend className="text-body font-semibold text-ink">{r("q")}</legend>
          <p className="text-caption text-ink-2">{r("q_sub")}</p>
          <div className={clsx("mt-1 grid grid-cols-2 gap-2", agro ? "sm:grid-cols-3" : "sm:grid-cols-4")}>
            {priorities.map((p) => {
              const on = effPriority === p.key;
              return (
                <label
                  key={p.key}
                  className={clsx(
                    "flex min-h-tap cursor-pointer items-center gap-3 rounded-card border p-3 text-body font-semibold text-ink focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-ink",
                    on ? "border-ink bg-muted" : "border-line-control bg-surface",
                  )}
                >
                  <input
                    type="radio"
                    name={groupName}
                    value={p.key}
                    checked={on}
                    onChange={() => setPriority(p.key)}
                    className="sr-only"
                  />
                  <span
                    aria-hidden
                    className={clsx(
                      "inline-flex size-9 shrink-0 items-center justify-center rounded-chip [&>svg]:size-5",
                      on ? "bg-ink text-surface" : "bg-muted text-ink",
                    )}
                  >
                    {p.icon}
                  </span>
                  <span className="min-w-0 flex-1">{r(p.label)}</span>
                  {on && <Check aria-hidden className="size-4 shrink-0" />}
                </label>
              );
            })}
          </div>
        </fieldset>

        {flat && <p className="text-body text-ink-2">{r("no_spread")}</p>}

        <div className="grid gap-4 lg:grid-cols-3">
          {shown.map((s, i) => {
            const isBest = s.id === best?.id;
            const isPick = s.id === pick?.id;
            const pests = s.pestPressure.filter((p) => p.seasons > 0);
            const why = whyLine(s);
            return (
              <Surface
                as="article"
                key={s.id}
                tone={isPick ? "hero" : "card"}
                className={clsx("animate-rise stagger flex flex-col gap-3", isPick && "ring-2 ring-ink")}
                style={{ "--i": i } as React.CSSProperties}
              >
                <div>
                  <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
                    <p className="text-caption font-semibold text-ink-2">
                      {t("rotAlt", { letter: optionLetter(s.id) })}
                    </p>
                    {isBest && (
                      <Chip tone="ok" icon={<Check />}>
                        {t("rotBest")}
                      </Chip>
                    )}
                  </div>
                  {s.source === "ai" && (
                    <Chip tone="neutral" icon={<Sparkles />} className="mb-2">
                      {t("rotAiChip")}
                    </Chip>
                  )}
                  <h3 className="text-h2 text-ink">{name(s)}</h3>
                  <p className="text-caption text-ink-2">{seqOf(s)}</p>
                </div>
                <SeasonStrip
                  seasons={s.plan.map((p) => ({
                    crop: p.crops[0] ?? "fallow",
                    name: p.crops.join("+"),
                    year: p.season,
                  }))}
                  label={`${first}–${first + 4}`}
                />
                {agro ? (
                  <Surface tone="inset" pad="sm">
                    <p className="text-caption text-ink-2">{t("rotAgroDroughtLabel")}</p>
                    <p className="font-mono text-big-number text-ink">
                      {t("rotAgroDroughtValue", { pct: Math.round(s.droughtYield * 100) })}
                    </p>
                    <p className="mt-1 text-caption font-semibold text-ink">
                      {s.kind === "current"
                        ? t("rotSame")
                        : t("rotAgroVsNow", {
                            delta: `${s.delta.drought >= 0 ? "+" : "−"}${Math.abs(Math.round(s.delta.drought * 100))}`,
                          })}
                    </p>
                  </Surface>
                ) : (
                  <Surface tone="inset" pad="sm">
                    <p className="font-mono text-big-number text-ink">
                      {r("opt_money", { amount: fmt.moneyPerArea(s.margin ?? 0, cur) })}
                    </p>
                    <p className="mt-1 flex items-center gap-1.5 text-caption font-semibold text-ink">
                      {s.kind === "current" || (s.delta.margin ?? 0) === 0 ? (
                        <>
                          <Equal aria-hidden className="size-4" />
                          {t("rotSame")}
                        </>
                      ) : (
                        <>
                          {(s.delta.margin ?? 0) > 0 ? (
                            <TrendingUp aria-hidden className="size-4" />
                          ) : (
                            <TrendingDown aria-hidden className="size-4" />
                          )}
                          {t("rotVsNow", { delta: signed(s.delta.margin ?? 0) })}
                        </>
                      )}
                    </p>
                    {!flat && s.drought != null && (
                      <p className="mt-1 text-caption text-ink-2">
                        {r("opt_bad", { amount: fmt.moneyPerArea(s.drought, cur) })}
                      </p>
                    )}
                  </Surface>
                )}
                {agro && (
                  <p className="text-caption text-ink-2">
                    {r("opt_bad_agro", { pct: fmt.percent(s.droughtYield) })}
                  </p>
                )}
                {why && <p className="text-caption text-ink">{why}</p>}
                <Disclosure summary={<span className="text-small">{r("opt_details")}</span>}>
                  <div className="flex flex-col gap-3 pb-2 pt-1">
                    {agro && (
                      <ul className="flex flex-col gap-1 text-caption text-ink-2">
                        <li>{t("rotAgroWater", { amount: fmt.rain(s.water) })}</li>
                        <li>
                          {s.carbonChange != null
                            ? t("rotAgroSoil", {
                                value: fmt.number(s.carbonChange, { maximumFractionDigits: 2 }),
                              })
                            : t("rotAgroSoilUnknown")}
                        </li>
                        <li>{t("rotAgroErosion", { value: fmt.number(Math.round(s.erosion)) })}</li>
                      </ul>
                    )}
                    <ul className="flex flex-col gap-2 text-caption">
                      {metrics.map((m) => (
                        <li key={m.key} className="flex items-center justify-between gap-3">
                          <span className="text-ink-2">
                            {t(m.label)}
                            {m.key === "margin" && (
                              <InfoHint label={t("hintLabel")} className="ml-1.5">
                                {t("hintRotDots")}
                              </InfoHint>
                            )}
                            {m.key === "drought" && (
                              <InfoHint label={t("hintLabel")} className="ml-1.5">
                                {t("hintWorst10")}
                              </InfoHint>
                            )}
                          </span>
                          <Dots
                            n={dots(s, m.key)}
                            label={`${t(m.label)}: ${dots(s, m.key)}/5`}
                            strong={isPick}
                          />
                        </li>
                      ))}
                    </ul>
                    {!agro && (
                      <p className="text-caption text-ink-2">
                        {t("rotPrice", { n: s.priceWins })}{" "}
                        <InfoHint label={t("hintLabel")}>{t("hintPrices")}</InfoHint>
                      </p>
                    )}
                    {s.capped && !agro && (
                      <p className="flex items-start gap-2 text-caption text-ink">
                        <TriangleAlert aria-hidden className="mt-0.5 size-4 shrink-0 text-week" />
                        {t("rotCapped", { loss: fmt.number(Math.abs(perUnit(s.capLoss))), unit, cur })}
                      </p>
                    )}
                    <div className="text-caption">
                      <p className="font-semibold text-ink">{t("rotPest")}</p>
                      {pests.length ? (
                        pests.map((p) => (
                          <p key={p.pest} className="flex items-start gap-2 text-ink">
                            <TriangleAlert aria-hidden className="mt-0.5 size-4 shrink-0 text-week" />
                            {t("rotPestLine", { pest: pestName(p.pest), n: p.seasons })}
                          </p>
                        ))
                      ) : (
                        <p className="text-ink-2">{t("rotNoPest")}</p>
                      )}
                    </div>
                  </div>
                </Disclosure>
                <Button
                  variant="outline"
                  icon={isPick ? <Check /> : undefined}
                  aria-pressed={isPick}
                  onClick={() => {
                    setChosen(s.id);
                    save.reset();
                  }}
                  className="mt-auto justify-center"
                >
                  {isPick ? t("rotChosen") : t("rotChoose")}
                </Button>
              </Surface>
            );
          })}
        </div>

        {scenarios.length > shown.length || showAll
          ? scenarios.length > 3 && (
              <div>
                <Button variant="outline" onClick={() => setShowAll((v) => !v)} aria-expanded={showAll}>
                  {showAll ? r("opts_show_less") : r("opts_show_all", { n: scenarios.length })}
                </Button>
              </div>
            )
          : null}

        {pick && (
          <section
            className="rounded-card border border-line bg-surface px-4 py-1"
            aria-labelledby="why-pick"
          >
            <Disclosure
              summary={
                <span id="why-pick">
                  {t("rotYourPick")}: {t("rotAlt", { letter: optionLetter(pick.id) })} · {name(pick)}
                </span>
              }
              summaryNote={pros(pick)[0] ?? ""}
            >
              <div className="grid gap-6 pb-3 pt-2 md:grid-cols-2">
                <div>
                  <h3 className="mb-3 text-body font-semibold text-ink">{t("rotWhy")}</h3>
                  <ul className="flex flex-col gap-3">
                    {pros(pick).map((x) => (
                      <li key={x} className="flex gap-3 text-body text-ink">
                        <span
                          aria-hidden
                          className="inline-flex size-6 shrink-0 items-center justify-center rounded-full bg-ok-soft text-ok"
                        >
                          <Check className="size-4" />
                        </span>
                        {x}
                      </li>
                    ))}
                    {pros(pick).length === 0 && <li className="text-body text-ink-2">{t("rotNoPros")}</li>}
                  </ul>
                </div>
                {cons(pick).length > 0 && (
                  <div>
                    <h3 className="mb-3 text-body font-semibold text-ink">{t("rotCheck")}</h3>
                    <ul className="flex flex-col gap-3">
                      {cons(pick).map((x) => (
                        <li key={x} className="flex gap-3 text-body text-ink">
                          <span
                            aria-hidden
                            className="inline-flex size-6 shrink-0 items-center justify-center rounded-full bg-week-soft text-week"
                          >
                            <TriangleAlert className="size-4" />
                          </span>
                          {x}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            </Disclosure>
          </section>
        )}
      </section>

      {/* 3. Data and reliability: the climate row and the NASA block, one place */}
      <section className="flex flex-col gap-3" aria-labelledby="data-reliability">
        <h2 id="data-reliability" className="text-h2 text-ink">
          {r("sec_data")}
        </h2>
        {climateCard}
        {data.dataBasis && (
          <DataBasis items={data.dataBasis} trustHref={`/fields/${fieldId}/trust`} compact />
        )}
        {dataLine}
      </section>

      {/* 4. Evidence: collapsed rows, one line each */}
      <section className="flex flex-col gap-3" aria-labelledby="evidence-title">
        <h2 id="evidence-title" className="text-h2 text-ink">
          {r("sec_evidence")}
        </h2>
        {!agro &&
          evOpen(
            "evidence-chart",
            t("rotCumTitle"),
            r("ev_chart_note", { n: scenarios.length, from: first, to: first + 4 }),
            <div className="pb-3 pt-2">
              <p className="mb-4 text-body text-ink-2">
                {t("rotCumSub", { unit, from: first, to: first + 4, cur })}
              </p>
              <CumulativeChart
                series={scenarios
                  .map((s, k) => ({
                    letter: letters[k] ?? "",
                    name: name(s),
                    values: cum[k] ?? [],
                    picked: s.id === pick?.id,
                    id: s.id,
                  }))
                  .filter((x) => visibleIds.has(x.id))}
                seasons={seasons}
                money={(v) => fmt.money(v, cur)}
                moneyCompact={(v) => fmt.money(v, cur, { compact: true })}
                dipLetters={dips.map((k) => letters[k] ?? "")}
                dipLabel={t("rotDipTag")}
                ariaLabel={r("money_label")}
              />
              {dips.length > 0 && (
                <p className="mt-3 text-caption text-ink-2">
                  {t("rotDip", { letters: dips.map((k) => letters[k]).join(", "), year: first })}
                </p>
              )}
            </div>,
          )}
        {!agro &&
          evOpen(
            "evidence-2022",
            r("ev_22_title"),
            y22Same
              ? r("ev_22_note_same")
              : pickY22?.ok
                ? r("ev_22_note", {
                    hit: perArea(pickY22.s.if2022.margin),
                    typical: perArea(pickY22.s.if2022.typical),
                  })
                : t("rot2022Sub"),
            <div className="pb-3 pt-2">
              <p className="mb-4 text-body text-ink-2">{t("rot2022Sub")}</p>
              <CaveatNotes
                caveats={[...new Set(scenarios.flatMap((s) => s.caveats ?? []))]}
                cropName={cropLabel}
                only={["water"]}
                className="mb-4"
              />
              {y22Same ? (
                <p className="text-body font-semibold text-ink">{r("y22_all_same")}</p>
              ) : (
                <div className="grid gap-5 sm:grid-cols-3">
                  {y22.map(({ s, ok, same }) => (
                    <div key={s.id} className="flex flex-col gap-1">
                      <p className="text-caption font-semibold text-ink">
                        {optionLetter(s.id)} · {name(s)}
                      </p>
                      <p className="flex items-start gap-1.5 text-body font-semibold text-ink">
                        {!ok ? (
                          r("y22_na")
                        ) : same ? (
                          <>
                            <Equal aria-hidden className="mt-1 size-4 shrink-0" />
                            {r("y22_same")}
                          </>
                        ) : (
                          r("y22_money", {
                            hit: perArea(s.if2022.margin),
                            typical: perArea(s.if2022.typical),
                          })
                        )}
                      </p>
                      {ok && same && <p className="text-caption text-ink-2">{t("rot2022Covered")}</p>}
                    </div>
                  ))}
                </div>
              )}
            </div>,
          )}
        {evOpen(
          "year-sets",
          r("ys_title"),
          r("ev_sets_note"),
          <div className="pb-3 pt-2">
            <YearSets
              bare
              data={rankedSets}
              isError={yearSets.isError}
              error={yearSets.error}
              onRetry={() => void yearSets.refetch()}
              agro={agro}
              units={units}
              money={money}
              unitLabel={unit}
              label={optionLabel}
              recommendedId={best?.id ?? null}
              currentId={current.id}
              hideBad={flat}
            />
          </div>,
        )}
        {evOpen(
          "evidence-try",
          r("ev_try_title"),
          r("ev_try_note"),
          <div className="pb-3">
            <div className="flex flex-col gap-5 pt-3">
              <p className="text-body text-ink-2">{t("rotSlidersSub")}</p>
              <div className="grid gap-5 sm:grid-cols-3">
                <label className="flex flex-col gap-1 text-body text-ink-2">
                  {t("rotDeltaT")}:{" "}
                  <span className="font-mono text-ink">
                    {draft.deltaT > 0 ? "+" : ""}
                    {fmt.number(draft.deltaT)} °C
                  </span>
                  <input
                    type="range"
                    min={0}
                    max={3}
                    step={0.5}
                    value={draft.deltaT}
                    className="h-11 w-full cursor-pointer"
                    onChange={(e) => setDraft({ ...draft, deltaT: Number(e.target.value) })}
                  />
                </label>
                <label className="flex flex-col gap-1 text-body text-ink-2">
                  {t("rotRain")}: <span className="font-mono text-ink">{fmt.percent(draft.rain / 100)}</span>
                  <input
                    type="range"
                    min={-30}
                    max={0}
                    step={5}
                    value={draft.rain}
                    className="h-11 w-full cursor-pointer"
                    onChange={(e) => setDraft({ ...draft, rain: Number(e.target.value) })}
                  />
                </label>
                <label className="flex flex-col gap-1 text-body text-ink-2">
                  {t("rotCap")}:{" "}
                  <span className="font-mono text-ink">
                    {draft.cap ? fmt.rain(draft.cap) : t("rotNoCap")}
                  </span>
                  <input
                    type="range"
                    min={0}
                    max={600}
                    step={25}
                    value={draft.cap}
                    className="h-11 w-full cursor-pointer"
                    onChange={(e) => setDraft({ ...draft, cap: Number(e.target.value) })}
                  />
                </label>
              </div>
              <div className="flex flex-wrap gap-3">
                <Button
                  variant="outline"
                  onClick={() =>
                    setOverrides({
                      ...(draft.deltaT ? { deltaT: draft.deltaT } : {}),
                      ...(draft.rain ? { precipFactor: 1 + draft.rain / 100 } : {}),
                      ...(draft.cap ? { waterCapMm: draft.cap } : {}),
                    })
                  }
                  disabled={fetching}
                  aria-busy={fetching}
                >
                  {fetching ? r("rerun_busy") : r("rerun")}
                </Button>
                <Button
                  variant="ghost"
                  onClick={() => (setDraft({ deltaT: 0, rain: 0, cap: 0 }), setOverrides({}))}
                >
                  {t("rotReset")}
                </Button>
              </div>
              {!agro && canSave && (
                <div className="flex flex-col gap-3 border-t border-line pt-4">
                  <p className="text-body font-semibold text-ink">{r("price_edit")}</p>
                  <p className="text-caption text-ink-2">{r("price_edit_hint")}</p>
                  <div>
                    <Button
                      variant="outline"
                      icon={<Wallet />}
                      onClick={() => setShowPrices((v) => !v)}
                      aria-expanded={showPrices}
                    >
                      {t("rotYourPrices")}
                    </Button>
                  </div>
                  {showPrices && (
                    <CropPricesEditor
                      workspaceId={workspaceId}
                      crops={priceCrops}
                      needYield={data.needYield}
                      yieldHints={data.yieldHints}
                      onSaved={() => setShowPrices(false)}
                      onCancel={() => setShowPrices(false)}
                    />
                  )}
                </div>
              )}
            </div>
          </div>,
        )}
        {evOpen(
          "evidence-table",
          t("rotTable"),
          r("ev_table_note", { n: scenarios.length }),
          <div className="pb-3">
            <div className="overflow-x-auto pt-3">
              <table className="w-full text-caption">
                <thead>
                  <tr className="text-left text-ink-2">
                    <th className="py-2">{r("tbl_metric")}</th>
                    {scenarios.map((s, i) => (
                      <th key={s.id} className="py-2 text-right">
                        {letters[i]}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="font-mono">
                  {(agro
                    ? [
                        [t("rotAgroDroughtLabel"), (s: ScenarioResult) => fmt.percent(s.droughtYield)],
                        [t("rotWater"), (s: ScenarioResult) => fmt.rain(s.water)],
                        [
                          t("rotSoilC"),
                          (s: ScenarioResult) =>
                            s.carbonChange != null
                              ? fmt.number(s.carbonChange, { maximumFractionDigits: 2 })
                              : "—",
                        ],
                        [t("rotErosion"), (s: ScenarioResult) => fmt.number(Math.round(s.erosion))],
                        [
                          r("row_score"),
                          (s: ScenarioResult) => fmt.number(s.score ?? 0, { maximumFractionDigits: 2 }),
                        ],
                      ]
                    : [
                        [t("rotMargin"), (s: ScenarioResult) => money(s.margin ?? 0)],
                        [t("rotWater"), (s: ScenarioResult) => fmt.rain(s.water)],
                        [
                          t("rotSoilC"),
                          (s: ScenarioResult) =>
                            s.carbonChange != null
                              ? fmt.number(s.carbonChange, { maximumFractionDigits: 2 })
                              : "—",
                        ],
                        [t("rotErosion"), (s: ScenarioResult) => fmt.number(Math.round(s.erosion))],
                        [t("rotDrought"), (s: ScenarioResult) => money(s.drought ?? 0)],
                        [
                          t("rot2022"),
                          (s: ScenarioResult) =>
                            Number.isFinite(s.if2022.margin)
                              ? `${signedPlain(s.if2022.margin)} / ${signedPlain(s.if2022.typical)}`
                              : "—",
                        ],
                        [r("row_price"), (s: ScenarioResult) => `${s.priceWins}/10`],
                        [
                          r("row_score"),
                          (s: ScenarioResult) => fmt.number(s.score ?? 0, { maximumFractionDigits: 2 }),
                        ],
                      ]
                  ).map(([label, f]) => (
                    <tr key={label as string} className="border-t border-line">
                      <th className="py-2 pr-3 text-left font-sans font-normal text-ink-2">
                        {label as string}
                      </th>
                      {scenarios.map((s) => (
                        <td key={s.id} className="py-2 text-right text-ink">
                          {(f as (s: ScenarioResult) => string)(s)}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
              {agro && <p className="mt-3 text-caption text-ink-2">{t("rotAgroSoilNote")}</p>}
            </div>
          </div>,
        )}
        {evOpen(
          "evidence-notes",
          r("notes_title"),
          r("ev_notes_note", { n: noteItems.length }),
          <div className="pb-3">
            <div className="flex flex-col gap-3 pt-3">
              <ul className="flex list-disc flex-col gap-2 pl-5 text-body text-ink-2">
                {noteItems.map((n) => (
                  <li key={n}>{n}</li>
                ))}
              </ul>
              <CaveatNotes
                caveats={pick?.caveats}
                cropName={cropLabel}
                only={["crop", "repeat"]}
                className=""
              />
              {notice !== "estimate" && data.currentBasis === "estimated" && histForm(true, false)}
            </div>
          </div>,
        )}
      </section>

      <Link
        href={`/fields/${fieldId}`}
        className="focus-ring inline-flex min-h-tap w-fit items-center text-body text-ink-2 underline"
      >
        ← {fieldName}
      </Link>
    </div>
  );
}
