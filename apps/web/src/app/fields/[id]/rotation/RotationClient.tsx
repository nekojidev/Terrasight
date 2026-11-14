"use client";

import { useMutation, useQuery } from "@tanstack/react-query";
import { rank, type Metric, type ScenarioResult } from "@terrasight/scenario-engine";
import { Button, Chip, SeasonStrip, cropColour } from "@terrasight/ui";
import { Check, Droplet, Leaf, PiggyBank, ShieldCheck, Sparkles } from "lucide-react";
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
  priceAsOf: string;
  names: Record<string, Localised>;
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

/** Rotation screen (design 10, S-06.04): decision first, evidence below; priorities re-rank in the browser. */
export function RotationClient({
  workspaceId,
  fieldId,
  fieldName,
  units,
  canSave,
}: {
  workspaceId: string;
  fieldId: string;
  fieldName: string;
  units: "metric" | "imperial";
  canSave: boolean;
}) {
  const t = useTranslations("App");
  const r = useTranslations("Rotation");
  const locale = useLocale() as "en" | "uk";
  const [priority, setPriority] = useState<Metric | null>(null);
  const [chosen, setChosen] = useState<string | null>(null);
  const run = useQuery({
    queryKey: ["scenarios", workspaceId, fieldId],
    queryFn: () => api<RunView>(`/api/w/${workspaceId}/fields/${fieldId}/scenario-runs`, { body: {} }),
    staleTime: Infinity,
  });

  const area = units === "imperial" ? "ac" : "ha";
  const money = (perHa: number) => Math.round(units === "imperial" ? perHa / AC : perHa);
  const water = (mm: number) =>
    units === "imperial" ? `${(mm / 25.4).toFixed(1)} in` : `${Math.round(mm)} mm`;
  const signed = (v: number) => `${v >= 0 ? "+" : "−"}$${Math.abs(money(v)).toLocaleString()}`;

  const scenarios = useMemo(() => {
    if (!run.data?.result) return [];
    const all = [run.data.result.current, ...run.data.result.alternatives];
    const w = priority
      ? { margin: 0.25, water: 0.25, soil: 0.25, drought: 0.25, [priority]: 3 }
      : { margin: 1, water: 1, soil: 1, drought: 1 };
    return rank(all, w as Record<Metric, number>);
  }, [run.data, priority]);
  const best = scenarios.reduce<ScenarioResult | null>(
    (b, s) => (!b || (s.score ?? 0) > (b.score ?? 0) ? s : b),
    null,
  );
  const pick = scenarios.find((s) => s.id === chosen) ?? best;
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

  if (run.isPending) return <p className="text-body text-ink-2">{t("rotLoading")}</p>;
  if (run.isError || !run.data) return <p className="text-body text-urgent">{t("errGeneric")}</p>;
  if (run.data.noLibrary)
    return (
      <p className="rounded-card border border-line bg-surface p-6 text-body text-ink-2">
        {t("rotNoLibrary")}
      </p>
    );

  const name = (s: ScenarioResult) =>
    s.kind === "current"
      ? s.label === "detected"
        ? t("rotDetected")
        : t("rotCurrent")
      : (run.data!.names[s.id]?.[locale] ?? s.id);
  const cropName = (c: string) => c.replace(/_/g, " ");
  const letters = ["A", "B", "C"];
  const seasons = Array.from({ length: 5 }, (_, i) => first + i);

  // Cumulative margin chart (sum of simulated years, no extrapolation).
  const cum = scenarios.map((s) =>
    s.marginBySeason.reduce<number[]>((acc, m) => [...acc, (acc.at(-1) ?? 0) + money(m)], []),
  );
  const lo = Math.min(0, ...cum.flat());
  const hi = Math.max(1, ...cum.flat());
  const X = (i: number) => 40 + (i / 4) * 520;
  const Y = (v: number) => 210 - ((v - lo) / (hi - lo)) * 190;

  return (
    <div className="flex flex-col gap-8">
      <header className="flex flex-col gap-3">
        <h1 className="text-h1 text-ink">{fieldName}</h1>
        <FieldTabs fieldId={fieldId} active={2} />
      </header>
      <section className="flex flex-wrap items-center justify-between gap-4 rounded-hero bg-ink p-7 text-surface">
        <div className="flex items-center gap-5">
          <span
            aria-hidden
            className="size-14 rounded-chip border-4 border-surface/20"
            style={{ backgroundColor: cropColour(firstCrop ?? "fallow") }}
          />
          <div>
            <p className="font-mono text-small tracking-wide text-signal uppercase">
              {chosen && chosen !== best?.id
                ? t("rotYourChoice", { season: first })
                : t("rotRecommended", { season: first })}
            </p>
            <p className="text-h1">{cropName(firstCrop ?? "fallow")}</p>
            <p className="text-small text-surface/70">{t("rotBannerSub", { from: first, to: first + 4 })}</p>
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
              onClick={() => setPriority(priority === p.key ? null : p.key)}
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
                {isBest && (
                  <Chip
                    tone="neutral"
                    icon={<Check />}
                    className="absolute -top-3 left-5 bg-ink text-surface"
                  >
                    {t("rotBest")}
                  </Chip>
                )}
                <div>
                  <p className="text-small text-ink-2">{t("rotAlt", { letter: letters[i] ?? "" })}</p>
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
                <dl className="grid grid-cols-2 gap-2 text-small">
                  <dt className="text-ink-2">{t("rotWater")}</dt>
                  <dd className="text-right font-mono text-ink">{water(s.water)}</dd>
                  <dt className="text-ink-2">{t("rotSoilC")}</dt>
                  <dd className="text-right font-mono text-ink">
                    {s.carbonChange >= 0 ? "+" : ""}
                    {s.carbonChange.toFixed(1)} t C/ha
                  </dd>
                  <dt className="text-ink-2">{t("rotErosion")}</dt>
                  <dd className="text-right font-mono text-ink">{Math.round(s.erosion)}</dd>
                  <dt className="text-ink-2">{t("rotDrought")}</dt>
                  <dd className="text-right font-mono text-ink">${money(s.drought).toLocaleString()}</dd>
                </dl>
                <p className="text-small text-ink-2">{t("rotPrice", { n: s.priceWins })}</p>
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

      <section className="rounded-card border border-line bg-surface p-6">
        <h2 className="text-h2 text-ink">{t("rotCumTitle")}</h2>
        <p className="mb-4 text-small text-ink-2">
          {t("rotCumSub", { unit: area, from: first, to: first + 4 })}
        </p>
        <svg viewBox="0 0 680 240" role="img" aria-label={r("money_label")} className="w-full">
          <line x1="40" x2="560" y1={Y(0)} y2={Y(0)} className="stroke-line" />
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
              <text x="570" y={Y(c.at(-1) ?? 0) + 4} className="fill-ink text-[12px] font-semibold">
                {letters[k]} ${c.at(-1)?.toLocaleString()}
              </text>
            </g>
          ))}
        </svg>
      </section>

      <section className="rounded-card border border-line bg-surface p-6">
        <h2 className="text-h2 text-ink">{t("rot2022")}</h2>
        <p className="mb-4 text-small text-ink-2">{t("rot2022Sub")}</p>
        <div className="grid gap-4 sm:grid-cols-3">
          {scenarios.map((s, i) => (
            <div key={s.id}>
              <p className="flex justify-between text-small font-semibold text-ink">
                <span>
                  {letters[i]} · {name(s)}
                </span>
                <span className={s.if2022.margin < s.margin ? "text-urgent" : "text-ink-2"}>
                  ${money(s.if2022.margin).toLocaleString()}
                </span>
              </p>
              <p className="text-micro text-ink-3">{s.if2022.season}</p>
            </div>
          ))}
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
              [t("rot2022"), (s: ScenarioResult) => `$${money(s.if2022.margin)}`],
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
      </details>

      <Link href={`/fields/${fieldId}`} className="text-small text-ink-2 underline">
        ← {fieldName}
      </Link>
    </div>
  );
}
