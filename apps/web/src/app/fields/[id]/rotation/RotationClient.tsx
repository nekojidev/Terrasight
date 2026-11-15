"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { rank, type Metric, type ScenarioResult } from "@terrasight/scenario-engine";
import {
  Button,
  Chip,
  FieldThumb,
  InfoHint,
  SeasonStrip,
  SelectField,
  Skeleton,
  cropColour,
  seasonHintText,
} from "@terrasight/ui";
import { Check, Droplet, Leaf, PiggyBank, ShieldCheck, Sparkles, TriangleAlert } from "lucide-react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { useMemo, useState } from "react";
import { api } from "@/lib/api";
import { FieldTabs } from "../Overview";

type Localised = { en: string; uk: string };
interface RunView {
  id: string | null;
  noLibrary: boolean;
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
  }>;
  priceAsOf: string;
  names: Record<string, Localised>;
  cropNames?: Record<string, Localised>;
  result: {
    current: ScenarioResult;
    alternatives: ScenarioResult[];
    candidates: number;
    relaxed: string[];
    bestFit: string | null;
  };
}

const AC = 2.471054;
const PRIORITY: Array<{ key: Metric; icon: React.ReactNode; label: string }> = [
  { key: "margin", icon: <PiggyBank />, label: "p_profit" },
  { key: "water", icon: <Droplet />, label: "p_water" },
  { key: "soil", icon: <Leaf />, label: "p_soil" },
  { key: "drought", icon: <ShieldCheck />, label: "p_drought" },
];

const seqCrops = (s: string | { main: string; second: string }) =>
  typeof s === "string" ? [s] : [s.main, s.second];

/** The agronomist enters the last 3 crops (stored as crop-season overrides); never invented, never guessed silently. */
function CropHistoryForm({
  workspaceId,
  fieldId,
  lastSeason,
  cropNames,
  estimated,
  canSave,
}: {
  workspaceId: string;
  fieldId: string;
  lastSeason: number;
  cropNames: Record<string, Localised>;
  estimated: boolean;
  canSave: boolean;
}) {
  const t = useTranslations("App");
  const locale = useLocale() as "en" | "uk";
  const qc = useQueryClient();
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
  });
  return (
    <section className="rounded-card border border-line bg-surface p-6">
      <h2 className="text-h2 text-ink">{t("rotHistTitle")}</h2>
      <p className="mb-4 text-small text-ink-2">{estimated ? t("rotHistEstimated") : t("rotPendHistory")}</p>
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
          onClick={() => save.mutate()}
          disabled={save.isPending || seasons.some((y) => !picked[y])}
          aria-busy={save.isPending}
        >
          {t("rotHistSave")}
        </Button>
      )}
      {save.isError && <p className="mt-2 text-small text-urgent">{t("rotHistError")}</p>}
    </section>
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
    <span role="img" aria-label={label} className="flex gap-1">
      {[1, 2, 3, 4, 5].map((i) => (
        <span
          key={i}
          className={`block size-3 rounded-full ${i <= n ? (strong ? "bg-ink" : "bg-ink-2") : "bg-line"}`}
        />
      ))}
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
  const t = useTranslations("App");
  const r = useTranslations("Rotation");
  const locale = useLocale() as "en" | "uk";
  const [priority, setPriority] = useState<Metric>("margin");
  const [chosen, setChosen] = useState<string | null>(null);
  // Climate sliders and the water cap re-run the simulation (S-06.07); results are cached by inputs hash.
  const [draft, setDraft] = useState({ deltaT: 0, rain: 0, cap: 0 });
  const [overrides, setOverrides] = useState<{ deltaT?: number; precipFactor?: number; waterCapMm?: number }>(
    {},
  );
  const run = useQuery({
    queryKey: ["scenarios", workspaceId, fieldId, overrides],
    queryFn: () =>
      api<RunView>(`/api/w/${workspaceId}/fields/${fieldId}/scenario-runs`, { body: { overrides } }),
    staleTime: Infinity,
    placeholderData: (prev) => prev,
  });

  const area = units === "imperial" ? "ac" : "ha";
  const money = (perHa: number) => Math.round(units === "imperial" ? perHa / AC : perHa);
  const water = (mm: number) =>
    units === "imperial" ? `${(mm / 25.4).toFixed(1)} in` : `${Math.round(mm)} mm`;
  const signedPlain = (v: number) => `${v < 0 ? "−" : ""}$${Math.abs(money(v)).toLocaleString()}`;
  const signed = (v: number) => `${v >= 0 ? "+" : "−"}$${Math.abs(money(v)).toLocaleString()}`;

  const scenarios = useMemo(() => {
    if (!run.data?.result) return [];
    const all = [run.data.result.current, ...run.data.result.alternatives];
    const w = { margin: 0.25, water: 0.25, soil: 0.25, drought: 0.25, [priority]: 3 };
    return rank(all, w as Record<Metric, number>);
  }, [run.data, priority]);
  const best = scenarios.reduce<ScenarioResult | null>(
    (b, s) => (!b || (s.score ?? 0) > (b.score ?? 0) ? s : b),
    null,
  );
  const pick = scenarios.find((s) => s.id === chosen) ?? best;
  /** 1–5 dots, relative among the compared options (exact values are in "All numbers"). */
  const dots = (s: ScenarioResult, m: Metric) => {
    const v = (x: ScenarioResult) =>
      m === "margin"
        ? x.margin
        : m === "water"
          ? -x.water
          : m === "soil"
            ? x.carbonChange - x.erosion / 100
            : x.drought;
    const vals = scenarios.map(v);
    const lo = Math.min(...vals);
    const hi = Math.max(...vals);
    return hi - lo < 1e-9 ? 3 : 1 + Math.round(((v(s) - lo) / (hi - lo)) * 4);
  };
  const first = run.data?.firstSeason ?? 2026;
  const firstCrop = pick?.plan[0]?.crops.filter((c) => c !== "fallow")[0] ?? pick?.plan[0]?.crops[0];

  const save = useMutation({
    mutationFn: () =>
      api(`/api/w/${workspaceId}/fields/${fieldId}/plans/${first}`, {
        method: "PUT",
        body: {
          crop: firstCrop,
          rotationId: pick?.kind === "current" ? null : pick?.id,
          scenarioRunId: run.data?.id,
        },
      }),
  });

  if (run.isPending) return <Skeleton label={t("rotLoading")} />;
  if (run.isError || !run.data) return <p className="text-body text-urgent">{t("errGeneric")}</p>;
  if (run.data.noLibrary)
    return (
      <p className="rounded-card border border-line bg-surface p-6 text-body text-ink-2">
        {t("rotNoLibrary")}
      </p>
    );
  const cropLabel = (c: string) => run.data!.cropNames?.[c]?.[locale] ?? c.replace(/_/g, " ");
  const histForm = (estimated: boolean) =>
    run.data!.cropNames && run.data!.lastSeason ? (
      <CropHistoryForm
        workspaceId={workspaceId}
        fieldId={fieldId}
        lastSeason={run.data!.lastSeason}
        cropNames={run.data!.cropNames}
        estimated={estimated}
        canSave={canSave}
      />
    ) : null;
  if (run.data.pending) {
    const d = run.data;
    return (
      <div className="flex flex-col gap-6">
        <header className="flex flex-col gap-3">
          <div className="flex items-center gap-4">
            <FieldThumb name={fieldName} outline={thumb} crop={crop} size={56} />
            <h1 className="text-h1 text-ink">{fieldName}</h1>
          </div>
          <FieldTabs fieldId={fieldId} active={2} />
        </header>
        {d.pending === "prices" && (
          <p className="flex items-center gap-2 rounded-card border border-line bg-surface-2 p-4 text-body text-ink">
            <TriangleAlert aria-hidden className="size-5 shrink-0 text-week" />
            {d.regionId?.startsWith("ua-") ? t("rotPendPricesUa") : t("rotPendPrices")}
          </p>
        )}
        {d.pending === "crops" && (
          <p className="flex items-center gap-2 rounded-card border border-line bg-surface-2 p-4 text-body text-ink">
            <TriangleAlert aria-hidden className="size-5 shrink-0 text-week" />
            {t("rotPendCrops", { list: (d.unmodelledCrops ?? []).map(cropLabel).join(", ") })}
          </p>
        )}
        {d.pending === "crop-history" && histForm(false)}
        {d.pending !== "crop-history" && d.currentBasis === "estimated" && histForm(true)}
        {d.regionVerify && <p className="text-small text-week">{t("rotVerify")}</p>}
        {d.candidates && d.candidates.length > 0 && (
          <section className="rounded-card border border-line bg-surface p-6">
            <h2 className="mb-3 text-h2 text-ink">{t("rotCandidates")}</h2>
            <ul className="flex flex-col gap-3">
              {d.candidates.map((c) => (
                <li key={c.id}>
                  <p className="text-body font-semibold text-ink">{c.name[locale]}</p>
                  <p className="text-small text-ink-2">
                    {c.sequence.map((x) => seqCrops(x).map(cropLabel).join(" + ")).join(" → ")}
                  </p>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    );
  }

  const pros = (s: ScenarioResult): string[] => {
    if (s.kind === "current") return [t("rotProCurrent")];
    const out: string[] = [];
    if (s.delta.margin > 0) out.push(t("rotProMargin", { delta: signed(s.delta.margin), unit: area }));
    if (s.water < current.water - 5) out.push(t("rotProWater", { amount: water(current.water - s.water) }));
    if (s.carbonChange > current.carbonChange + 0.05) out.push(t("rotProCarbon"));
    if (s.erosion < current.erosion * 0.9) out.push(t("rotProErosion"));
    if (s.drought > current.drought)
      out.push(t("rotProDrought", { delta: signed(s.drought - current.drought), unit: area }));
    const pestsNow = current.pestPressure.filter((p) => p.seasons > 0).length;
    if (s.pestPressure.filter((p) => p.seasons > 0).length < pestsNow) out.push(t("rotProPest"));
    return out;
  };
  const cons = (s: ScenarioResult): string[] => {
    const out: string[] = [];
    if (s.kind !== "current") {
      if (s.delta.margin < 0) out.push(t("rotConMargin", { delta: signed(s.delta.margin), unit: area }));
      if (s.water > current.water + 5) out.push(t("rotConWater", { amount: water(s.water - current.water) }));
      if (s.drought < current.drought) out.push(t("rotConDrought"));
    }
    if (s.capped) out.push(t("rotCapped", { loss: Math.abs(money(s.capLoss)), unit: area }));
    for (const p of s.pestPressure.filter((x) => x.seasons > 0))
      out.push(t("rotPestLine", { pest: p.pest.replace(/_/g, " "), n: p.seasons }));
    if (s.priceWins < 5) out.push(t("rotConPrice", { n: s.priceWins }));
    return out;
  };
  const name = (s: ScenarioResult) =>
    s.kind === "current"
      ? run.data!.currentBasis === "estimated"
        ? t("rotCurrentEstimated")
        : s.label === "detected"
          ? t("rotDetected")
          : t("rotCurrent")
      : (run.data!.names[s.id]?.[locale] ?? s.id);
  const cropName = (c: string) => run.data!.cropNames?.[c]?.[locale] ?? c.replace(/_/g, " ");
  const letters = ["A", "B", "C"];
  const current = run.data.result.current;
  const seasons = Array.from({ length: 5 }, (_, i) => first + i);

  // Cumulative margin chart (sum of simulated years, no extrapolation).
  const cum = scenarios.map((s) =>
    s.marginBySeason.reduce<number[]>((acc, m) => [...acc, (acc.at(-1) ?? 0) + money(m)], []),
  );
  const lo = Math.min(0, ...cum.flat());
  const hi = Math.max(1, ...cum.flat());
  const X = (i: number) => 64 + (i / 4) * 500;
  const Y = (v: number) => 210 - ((v - lo) / (hi - lo)) * 190;
  const ticks = [0, 1, 2, 3].map((k) => lo + ((hi - lo) * k) / 3);
  const kfmt = (v: number) =>
    `${v < 0 ? "−" : ""}$${(Math.abs(v) / 1000).toFixed(Math.abs(v) >= 10000 ? 0 : 1)}k`;
  // End labels: keep at least 14px apart so they never overlap.
  const endY = (() => {
    const ys = cum.map((c, k) => ({ k, y: Y(c.at(-1) ?? 0) + 4 })).sort((p, q) => p.y - q.y);
    for (let n = 1; n < ys.length; n++) ys[n]!.y = Math.max(ys[n]!.y, ys[n - 1]!.y + 14);
    return Object.fromEntries(ys.map((e) => [e.k, e.y]));
  })();
  // Establishment dip: a weak first year followed by a clearly better one (e.g. alfalfa).
  const dips = scenarios.flatMap((s, k) => {
    const m = s.marginBySeason;
    const later = Math.max(...m.slice(1), 0);
    return m.length > 1 && later > 0 && m[0]! < 0.4 * later ? [k] : [];
  });

  return (
    <div className="flex flex-col gap-8">
      <header className="flex flex-col gap-3">
        <div className="flex items-center gap-4">
          <FieldThumb name={fieldName} outline={thumb} crop={crop} size={56} />
          <h1 className="text-h1 text-ink">{fieldName}</h1>
        </div>
        <FieldTabs fieldId={fieldId} active={2} />
      </header>
      <section className="flex flex-wrap items-center justify-between gap-4 rounded-hero bg-ink p-7 text-surface">
        <div className="flex items-center gap-5">
          <span
            aria-hidden
            className="size-14 shrink-0 rounded-chip border-4 border-surface/20"
            style={{ backgroundColor: cropColour(firstCrop ?? "fallow") }}
          >
            <span className="block size-full rounded-chip ring-2 ring-inset ring-surface/40" />
          </span>
          <div>
            <p className="font-mono text-small tracking-wide text-signal uppercase dark:text-on-signal">
              {chosen && chosen !== best?.id
                ? t("rotYourChoice", { season: first })
                : t("rotRecommended", { season: first })}
            </p>
            <p className="text-h1">{t("rotSow", { crop: cropName(firstCrop ?? "fallow") })}</p>
            <p className="text-small text-surface/70">
              {t("rotBannerSub", { from: first, to: first + 4 })}{" "}
              <InfoHint label={t("hintLabel")}>
                {seasonHintText(t("hintSeason"), first)} {t("hintHorizon")}
              </InfoHint>
            </p>
          </div>
        </div>
        {canSave ? (
          <Button
            variant="signal"
            icon={<Check />}
            onClick={() => save.mutate()}
            disabled={save.isPending || !firstCrop}
            aria-busy={save.isPending}
          >
            {save.isSuccess ? t("rotSaved", { season: first }) : t("rotSave", { season: first })}
          </Button>
        ) : (
          <p className="text-small text-surface/70">{t("rotReadOnly")}</p>
        )}
      </section>

      <p className="flex items-center gap-2 rounded-card border border-line bg-surface-2 p-4 text-small text-ink-2">
        <Sparkles aria-hidden className="size-4" strokeWidth={1.7} />
        {t("rotNote", { n: run.data.result.candidates + 1 })}
        {run.data.regionVerify && <span className="ml-2 text-week">{t("rotVerify")}</span>}
      </p>
      {run.data.soilBasis === "soilgrids" && <p className="text-small text-ink-2">{t("rotSoilEstimate")}</p>}
      {(run.data.unmodelledCrops?.length ?? 0) > 0 && (
        <p className="text-small text-ink-2">
          {t("rotNotCompared", { list: run.data.unmodelledCrops!.map(cropLabel).join(", ") })}
        </p>
      )}
      {run.data.currentBasis === "estimated" && histForm(true)}
      {run.data.result.relaxed.length > 0 && (
        <p className="text-small text-week">
          {t("rotRelaxed", { list: run.data.result.relaxed.join(", ") })}
        </p>
      )}

      <section>
        <h2 className="text-h2 text-ink">{r("q")}</h2>
        <p className="mb-3 text-small text-ink-2">{r("q_sub")}</p>
        <div role="radiogroup" aria-label={r("p_group")} className="grid gap-3 sm:grid-cols-4">
          {PRIORITY.map((p) => (
            <button
              key={p.key}
              type="button"
              role="radio"
              aria-checked={priority === p.key}
              onClick={() => setPriority(p.key)}
              className={`focus-ring flex flex-col items-start gap-3 rounded-card border p-4 text-left ${priority === p.key ? "border-ink bg-muted" : "border-line bg-surface"}`}
            >
              <span
                className={`inline-flex size-10 items-center justify-center rounded-chip [&>svg]:size-5 ${priority === p.key ? "bg-ink text-surface" : "bg-muted text-ink"}`}
              >
                {p.icon}
              </span>
              <span className="text-body font-semibold text-ink">{r(p.label)}</span>
            </button>
          ))}
        </div>
      </section>

      <section>
        <h2 className="text-h2 text-ink">{r("cmp")}</h2>
        <p className="mb-4 text-small text-ink-2">{r("cmp_sub")}</p>
        <div className="grid gap-4 lg:grid-cols-3">
          {scenarios.map((s, i) => {
            const isBest = s.id === best?.id;
            const isPick = s.id === pick?.id;
            return (
              <article
                key={s.id}
                className={`relative flex flex-col gap-4 rounded-card border bg-surface p-5 ${isPick ? "border-ink shadow-hero" : "border-line"}`}
              >
                <div>
                  <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
                    <p className="text-small font-semibold text-ink-2">
                      {t("rotAlt", { letter: letters[i] ?? "" })}
                    </p>
                    {isBest && (
                      <span className="inline-flex items-center gap-1 rounded-chip bg-ink px-2.5 py-1 text-small font-semibold text-surface [&>svg]:size-3.5">
                        <Check aria-hidden />
                        {t("rotBest")}
                      </span>
                    )}
                  </div>
                  <h3 className="text-h2 text-ink">{name(s)}</h3>
                  <p className="text-small text-ink-2">
                    {s.plan.map((p) => p.crops.map(cropName).join(" + ")).join(" → ")}
                  </p>
                </div>
                <SeasonStrip
                  seasons={s.plan.map((p) => ({
                    crop: p.crops[0] ?? "fallow",
                    name: p.crops.join("+"),
                    year: p.season,
                  }))}
                  label={`${first}–${first + 4}`}
                />
                <div className="rounded-input bg-surface-2 p-4">
                  <p className="text-small text-ink-2">{t("rotMargin")}</p>
                  <p className="font-mono text-big-number text-ink">${money(s.margin).toLocaleString()}</p>
                  <p className="text-small text-ink-2">{t("rotPer", { unit: area })}</p>
                  <p
                    className={`mt-1 text-small font-semibold ${s.delta.margin > 0 ? "text-ok" : s.delta.margin < 0 ? "text-urgent" : "text-ink-2"}`}
                  >
                    {s.kind === "current" ? t("rotSame") : t("rotVsNow", { delta: signed(s.delta.margin) })}
                  </p>
                </div>
                <ul className="flex flex-col gap-2 text-small">
                  {METRICS.map((m) => (
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
                      <Dots n={dots(s, m.key)} label={`${t(m.label)}: ${dots(s, m.key)}/5`} strong={isPick} />
                    </li>
                  ))}
                </ul>
                <p className="text-small text-ink-2">
                  {t("rotPrice", { n: s.priceWins })}{" "}
                  <InfoHint label={t("hintLabel")}>{t("hintPrices")}</InfoHint>
                </p>
                {s.capped && (
                  <p className="text-small text-week">
                    {t("rotCapped", { loss: Math.abs(money(s.capLoss)), unit: area })}
                  </p>
                )}
                <div className="text-small">
                  <p className="font-semibold text-ink">{t("rotPest")}</p>
                  {s.pestPressure.filter((p) => p.seasons > 0).length ? (
                    s.pestPressure
                      .filter((p) => p.seasons > 0)
                      .map((p) => (
                        <p key={p.pest} className="text-week">
                          {t("rotPestLine", { pest: p.pest.replace(/_/g, " "), n: p.seasons })}
                        </p>
                      ))
                  ) : (
                    <p className="text-ink-2">{t("rotNoPest")}</p>
                  )}
                </div>
                <Button
                  variant={isPick ? "primary" : "outline"}
                  icon={isPick ? <Check /> : undefined}
                  onClick={() => setChosen(s.id)}
                  className="mt-auto justify-center"
                >
                  {isPick ? t("rotChosen") : t("rotChoose")}
                </Button>
              </article>
            );
          })}
        </div>
      </section>

      {pick && (
        <section className="rounded-hero border-2 border-ink bg-surface p-6">
          <div className="mb-4 flex flex-wrap items-center gap-3">
            <Chip tone="neutral">{t("rotYourPick")}</Chip>
            <h2 className="text-h2 text-ink">
              {t("rotAlt", { letter: letters[scenarios.indexOf(pick)] ?? "" })} · {name(pick)}
            </h2>
          </div>
          <div className="grid gap-6 md:grid-cols-2">
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
                {pros(pick).length === 0 && <li className="text-small text-ink-2">{t("rotNoPros")}</li>}
              </ul>
            </div>
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
                {cons(pick).length === 0 && <li className="text-small text-ink-2">{t("rotNoCons")}</li>}
              </ul>
            </div>
          </div>
          {canSave && (
            <Button
              className="mt-6"
              icon={<Check />}
              onClick={() => save.mutate()}
              disabled={save.isPending || !firstCrop}
              aria-busy={save.isPending}
            >
              {save.isSuccess ? t("rotSaved", { season: first }) : t("rotSave", { season: first })}
            </Button>
          )}
        </section>
      )}

      <details className="rounded-card border border-line bg-surface p-6">
        <summary className="cursor-pointer text-h2 text-ink">{t("rotSliders")}</summary>
        <p className="mt-2 mb-4 text-small text-ink-2">{t("rotSlidersSub")}</p>
        <div className="grid gap-5 sm:grid-cols-3">
          <label className="flex flex-col gap-2 text-small text-ink-2">
            {t("rotDeltaT")}:{" "}
            <span className="font-mono text-ink">
              {draft.deltaT > 0 ? "+" : ""}
              {draft.deltaT} °C
            </span>
            <input
              type="range"
              min={0}
              max={3}
              step={0.5}
              value={draft.deltaT}
              onChange={(e) => setDraft({ ...draft, deltaT: Number(e.target.value) })}
            />
          </label>
          <label className="flex flex-col gap-2 text-small text-ink-2">
            {t("rotRain")}: <span className="font-mono text-ink">{draft.rain}%</span>
            <input
              type="range"
              min={-30}
              max={0}
              step={5}
              value={draft.rain}
              onChange={(e) => setDraft({ ...draft, rain: Number(e.target.value) })}
            />
          </label>
          <label className="flex flex-col gap-2 text-small text-ink-2">
            {t("rotCap")}:{" "}
            <span className="font-mono text-ink">{draft.cap ? water(draft.cap) : t("rotNoCap")}</span>
            <input
              type="range"
              min={0}
              max={600}
              step={25}
              value={draft.cap}
              onChange={(e) => setDraft({ ...draft, cap: Number(e.target.value) })}
            />
          </label>
        </div>
        <div className="mt-4 flex gap-3">
          <Button
            variant="outline"
            onClick={() =>
              setOverrides({
                ...(draft.deltaT ? { deltaT: draft.deltaT } : {}),
                ...(draft.rain ? { precipFactor: 1 + draft.rain / 100 } : {}),
                ...(draft.cap ? { waterCapMm: draft.cap } : {}),
              })
            }
            disabled={run.isFetching}
            aria-busy={run.isFetching}
          >
            {run.isFetching ? t("rotLoading") : t("rotRerun")}
          </Button>
          <Button
            variant="ghost"
            onClick={() => (setDraft({ deltaT: 0, rain: 0, cap: 0 }), setOverrides({}))}
          >
            {t("rotReset")}
          </Button>
        </div>
      </details>

      <section className="rounded-card border border-line bg-surface p-6">
        <h2 className="text-h2 text-ink">{t("rotCumTitle")}</h2>
        <p className="mb-4 text-small text-ink-2">
          {t("rotCumSub", { unit: area, from: first, to: first + 4 })}
        </p>
        <svg viewBox="0 0 720 240" role="img" aria-label={r("money_label")} className="w-full">
          {ticks.map((v) => (
            <g key={v}>
              <line
                x1="64"
                x2="564"
                y1={Y(v)}
                y2={Y(v)}
                className="stroke-line"
                strokeDasharray={v === 0 ? undefined : "3 4"}
              />
              <text x="56" y={Y(v) + 4} textAnchor="end" className="fill-ink-2 text-[11px]">
                {kfmt(v)}
              </text>
            </g>
          ))}
          <line x1="64" x2="564" y1={Y(0)} y2={Y(0)} className="stroke-ink-3" />
          {seasons.map((y, i) => (
            <text key={y} x={X(i)} y="236" textAnchor="middle" className="fill-ink-2 text-[12px]">
              {y}
            </text>
          ))}
          {cum.map((c, k) => (
            <g key={k}>
              <polyline
                fill="none"
                strokeWidth={k === scenarios.indexOf(pick!) ? 3.5 : 2}
                className={k === 0 ? "stroke-ink-2" : k === 1 ? "stroke-ink" : "stroke-week"}
                points={c.map((v, i) => `${X(i)},${Y(v)}`).join(" ")}
              />
              {c.map((v, i) => (
                <circle
                  key={i}
                  cx={X(i)}
                  cy={Y(v)}
                  r="3.5"
                  className={k === 0 ? "fill-ink-2" : k === 1 ? "fill-ink" : "fill-week"}
                />
              ))}
              <text x="572" y={endY[k]} className="fill-ink text-[12px] font-semibold">
                {letters[k]} ${c.at(-1)?.toLocaleString()}
              </text>
            </g>
          ))}
          {dips.slice(0, 1).map((k) => (
            <g key="dip">
              <circle
                cx={X(0)}
                cy={Y(cum[k]![0]!)}
                r="7"
                fill="none"
                strokeWidth="1.5"
                className="stroke-week"
              />
              <text x={X(0) + 12} y={Y(cum[k]![0]!) - 10} className="fill-week text-[11px] font-semibold">
                {t("rotDipTag")}
              </text>
            </g>
          ))}
        </svg>
        {dips.length > 0 && (
          <p className="mt-2 text-small text-ink-2">
            {t("rotDip", { letters: dips.map((k) => letters[k]).join(", "), year: first })}
          </p>
        )}
      </section>

      <section className="rounded-card border border-line bg-surface p-6">
        <h2 className="text-h2 text-ink">{t("rot2022")}</h2>
        <p className="mb-4 text-small text-ink-2">{t("rot2022Sub")}</p>
        <div className="grid gap-4 sm:grid-cols-3">
          {scenarios.map((s, i) => {
            const pct =
              Number.isFinite(s.if2022.margin) && Math.abs(s.if2022.typical) > 1
                ? Math.round(((s.if2022.typical - s.if2022.margin) / Math.abs(s.if2022.typical)) * 100)
                : null;
            return (
              <div key={s.id}>
                <p className="flex justify-between gap-2 text-small font-semibold text-ink">
                  <span>
                    {letters[i]} · {name(s)}
                  </span>
                  <span className={pct !== null && pct > 0 ? "text-urgent" : "text-ink-2"}>
                    {pct === null ? "—" : pct === 0 ? "0%" : `${pct > 0 ? "−" : "+"}${Math.abs(pct)}%`}
                  </span>
                </p>
                {pct !== 0 && (
                  <span aria-hidden className="mt-2 block h-2.5 overflow-hidden rounded-chip bg-muted">
                    <span
                      className={`block h-full ${s.id === pick?.id ? "bg-ink" : "bg-ink-2"}`}
                      style={{ width: `${pct === null ? 0 : Math.min(100, Math.max(2, pct))}%` }}
                    />
                  </span>
                )}
                {pct === 0 && <p className="mt-1 text-small text-ink-3">{t("rot2022Covered")}</p>}
                {pct !== null && pct !== 0 && (
                  <p className="mt-1 text-small text-ink-3">
                    {t("rot2022Season", {
                      season: s.if2022.season,
                      hit: signedPlain(s.if2022.margin),
                      typical: signedPlain(s.if2022.typical),
                      unit: area,
                    })}
                  </p>
                )}
              </div>
            );
          })}
        </div>
      </section>

      <details className="rounded-card border border-line bg-surface p-6">
        <summary className="cursor-pointer text-body font-semibold text-ink">{t("rotTable")}</summary>
        <table className="mt-4 w-full text-small">
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
            {[
              [t("rotMargin"), (s: ScenarioResult) => `$${money(s.margin)}`],
              [t("rotWater"), (s: ScenarioResult) => water(s.water)],
              [t("rotSoilC"), (s: ScenarioResult) => s.carbonChange.toFixed(2)],
              [t("rotErosion"), (s: ScenarioResult) => String(Math.round(s.erosion))],
              [t("rotDrought"), (s: ScenarioResult) => `$${money(s.drought)}`],
              [
                t("rot2022"),
                (s: ScenarioResult) =>
                  Number.isFinite(s.if2022.margin)
                    ? `${signedPlain(s.if2022.margin)} / ${signedPlain(s.if2022.typical)}`
                    : "—",
              ],
              [r("row_price"), (s: ScenarioResult) => `${s.priceWins}/10`],
              [r("row_score"), (s: ScenarioResult) => (s.score ?? 0).toFixed(2)],
            ].map(([label, f]) => (
              <tr key={label as string} className="border-t border-line">
                <th className="py-2 text-left font-sans font-normal text-ink-2">{label as string}</th>
                {scenarios.map((s) => (
                  <td key={s.id} className="py-2 text-right text-ink">
                    {(f as (s: ScenarioResult) => string)(s)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        <p className="mt-3 text-micro text-ink-3">{t("rotPrices", { asOf: run.data.priceAsOf })}</p>
        <p className="mt-1 text-micro text-ink-3">{t("rotIrrHint")}</p>
      </details>

      <Link href={`/fields/${fieldId}`} className="text-small text-ink-2 underline">
        ← {fieldName}
      </Link>
    </div>
  );
}
