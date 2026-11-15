import type { ClimateMetric, ClimateMetricId, ClimateShift, YearSetComparison, YearSetId } from "@terrasight/shared";

type Lang = "en" | "uk";

const METRIC_TITLE: Record<ClimateMetricId, Record<Lang, string>> = {
  seasonTemp: { en: "Growing-season temperature", uk: "Температура вегетаційного сезону" },
  hotDaysFlowering: { en: "Hot days in the flowering window", uk: "Спекотні дні у вікні цвітіння" },
  seasonPrecip: { en: "Growing-season rainfall", uk: "Опади вегетаційного сезону" },
  longestDrySpell: { en: "Longest dry spell", uk: "Найдовший сухий період" },
  gdd: { en: "Growing degree days", uk: "Сума активних температур (GDD)" },
  lastSpringFrost: { en: "Last spring frost", uk: "Останній весняний мороз" },
  firstAutumnFrost: { en: "First autumn frost", uk: "Перший осінній мороз" },
  frostFreeDays: { en: "Frost-free days", uk: "Дні без морозу" },
};

const UNIT: Record<string, string> = {
  degC: "°C",
  days: "days",
  mm: "mm",
  degDays: "degree-days",
  dayOfYear: "day of year",
};

const r2 = (n: number) => Math.round(n * 100) / 100;
/** Quantity as the number check and the tool card read it: no precision, so any rounding of the exact value passes. */
const qty = (value: number | null | undefined, unit: string) =>
  value === null || value === undefined || !Number.isFinite(value) ? null : { value: r2(value), unit };

/** Frost dates and the like are compared in days, whatever their day-of-year unit. */
const deltaUnit = (u: string) => (u === "dayOfYear" ? "days" : (UNIT[u] ?? u));

function metric(m: ClimateMetric, lang: Lang) {
  const unit = UNIT[m.unit] ?? m.unit;
  return {
    title: METRIC_TITLE[m.id][lang],
    baseline: qty(m.baseline, unit),
    recent: qty(m.recent, unit),
    change: qty(m.delta, deltaUnit(m.unit)),
    slopePerDecade: qty(m.trend.slopePerDecade, deltaUnit(m.unit)),
    trend: m.trend.significant ? "clear_trend" : "no_clear_trend",
    ...(m.yearsWithout && (m.yearsWithout.baseline || m.yearsWithout.recent)
      ? { yearsWithoutTheEvent: { baseline: m.yearsWithout.baseline, recent: m.yearsWithout.recent } }
      : {}),
  };
}

/** The climate shift as a tool result: the same numbers as the climate screen, with the caveats the answer must keep. */
export function climateShiftResult(field: string, c: ClimateShift, lang: Lang) {
  if (c.status !== "ready")
    return {
      field,
      status: c.status,
      ...(c.reason ? { reason: c.reason } : {}),
      note:
        c.status === "pending"
          ? "The weather record of this field is still being gathered; no climate numbers yet."
          : "The climate shift cannot be computed for this field; say so and do not estimate it.",
    };
  const firstYear = c.periods.baseline.from;
  const lastYear = c.periods.recent.to;
  return {
    field,
    periods: {
      baselineFrom: c.periods.baseline.from,
      baselineTo: c.periods.baseline.to,
      recentFrom: c.periods.recent.from,
      recentTo: c.periods.recent.to,
    },
    growingSeason: c.season,
    crop: c.crop,
    floweringWindow: {
      from: c.flowering.from,
      to: c.flowering.to,
      threshold: qty(c.flowering.thresholdC, "°C"),
      thresholdVerified: c.flowering.verified,
      genericWindow: c.flowering.fallback,
    },
    metrics: c.metrics.map((m) => metric(m, lang)),
    skippedYears: c.skippedYears,
    source: c.source && {
      dataset: c.source.dataset,
      from: c.source.from,
      lastDate: c.source.lastDate,
      resolution: { value: c.source.resolutionKm, unit: "km" },
      note: `NASA POWER numbers belong to a grid cell of about ${c.source.resolutionKm} km; neighbouring fields in the same cell share them.`,
    },
    gpmCheck: !c.gpm
      ? null
      : c.gpm.status === "ready"
        ? {
            status: "ready",
            powerRainChange: qty(c.gpm.powerChangePct, "%"),
            gpmRainChange: qty(c.gpm.imergChangePct, "%"),
            agree: c.gpm.agree,
            lastDate: c.gpm.lastDate,
          }
        : { status: "unavailable" },
    note: `This describes the past (${firstYear}–${lastYear}), not a forecast. A metric with trend "no_clear_trend" shows no clear trend and must not be described as a change.`,
  };
}

const SET_TITLE: Record<YearSetId, Record<Lang, string>> = {
  all: { en: "All weather years", uk: "Усі роки погоди" },
  "climate-1981-2000": { en: "Early climate, 1981–2000", uk: "Ранній клімат, 1981–2000" },
  "last-15": { en: "Last 15 years", uk: "Останні 15 років" },
  "trend-2030": { en: "Recent trend extended to 2030", uk: "Недавній тренд, продовжений до 2030" },
};

/** The year-set comparison as a tool result (a sensitivity analysis, never a forecast). */
export function yearSetResult(field: string, c: YearSetComparison, lang: Lang) {
  const name = (id: string) => c.names[id]?.[lang] ?? id;
  const money = c.mode === "money";
  return {
    field,
    kind: "sensitivity analysis of the ranking to the weather years used (not a forecast)",
    mode: c.mode,
    currency: c.currency,
    bestChangesBetweenSets: c.bestChanges,
    sets: c.sets.map((s) => ({
      title: SET_TITLE[s.id][lang],
      firstYear: s.years.from,
      lastYear: s.years.to,
      yearsUsed: s.years.count,
      // Only the parts of the shift that were applied (a non-significant trend is not extended).
      ...(s.shift && (s.shift.applied.temperature || s.shift.applied.precipitation)
        ? {
            weatherShift: {
              ...(s.shift.applied.temperature ? { temperature: qty(s.shift.deltaT, "°C") } : {}),
              ...(s.shift.applied.precipitation ? { precipitationFactor: qty(s.shift.precipFactor, "") } : {}),
            },
          }
        : {}),
      best: name(s.best),
      options: s.options.map((o) => ({
        title: `${name(o.id)} (${SET_TITLE[s.id][lang]})`,
        rank: o.rank,
        ...(money
          ? {
              marginPerHaPerYear: qty(o.margin, c.currency ?? ""),
              marginInWorstTenPercent: qty(o.drought, c.currency ?? ""),
            }
          : { relativeYieldInWorstTenPercent: qty(o.drought, "") }),
      })),
    })),
    note: "A sensitivity analysis of the ranking to the weather years used, not a forecast or a projection. The plan itself stays on 5 seasons, 2026–2030, and the recommendation stays on all years.",
  };
}
