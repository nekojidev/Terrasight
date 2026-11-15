import { intlLocale } from "./time";

/**
 * Locale- and unit-aware formatting, as pure functions (no clock, no browser zone). Everything goes through Intl,
 * so there are no hand-made "$12k" or "12.5 ha" strings. Time zones are explicit (`timeZone` option) and reuse the
 * locale tag from `time.ts`. Components use these through `useFormat()`.
 */

export type FormatLocale = "uk" | "en";
export type Units = "metric" | "imperial";
export type DateStyle = "day" | "dayMonth" | "full" | "time" | "dateTime";

const HA_PER_AC = 0.40468564224;
const M_PER_FT = 0.3048;
const M_PER_MI = 1609.344;
const MM_PER_IN = 25.4;
const KMH_PER_MS = 3.6;
const MPH_PER_MS = 2.2369362920544;

const tag = (locale: FormatLocale): string => intlLocale(locale);

const DATE_OPTIONS: Record<DateStyle, Intl.DateTimeFormatOptions> = {
  day: { day: "numeric" },
  dayMonth: { day: "numeric", month: "short" },
  full: { day: "numeric", month: "long", year: "numeric" },
  time: { hour: "2-digit", minute: "2-digit" },
  dateTime: { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" },
};

/** Dates and times. Pass the workspace `timeZone` so server and client render the same text. */
export function formatDate(
  d: Date | string | number,
  locale: FormatLocale,
  style: DateStyle = "dayMonth",
  opts: { timeZone?: string } = {},
): string {
  return new Intl.DateTimeFormat(tag(locale), {
    ...DATE_OPTIONS[style],
    ...(opts.timeZone ? { timeZone: opts.timeZone } : {}),
  }).format(new Date(d));
}

export function formatNumber(
  n: number,
  locale: FormatLocale,
  opts: { maximumFractionDigits?: number; minimumFractionDigits?: number } = {},
): string {
  return new Intl.NumberFormat(tag(locale), { maximumFractionDigits: opts.maximumFractionDigits ?? 1, ...opts }).format(n);
}

/** `fraction` is 0.25 for 25 %. */
export function formatPercent(fraction: number, locale: FormatLocale, opts: { maximumFractionDigits?: number } = {}): string {
  return new Intl.NumberFormat(tag(locale), {
    style: "percent",
    maximumFractionDigits: opts.maximumFractionDigits ?? 0,
  }).format(fraction);
}

export function formatMoney(
  amount: number,
  currency: "USD" | "UAH",
  locale: FormatLocale,
  opts: { compact?: boolean; maximumFractionDigits?: number } = {},
): string {
  return new Intl.NumberFormat(tag(locale), {
    style: "currency",
    currency,
    maximumFractionDigits: opts.maximumFractionDigits ?? 0,
    ...(opts.compact ? { notation: "compact" as const } : {}),
  }).format(amount);
}

function unitNumber(n: number, locale: FormatLocale, unit: string, digits: number): string {
  return new Intl.NumberFormat(tag(locale), {
    style: "unit",
    unit,
    unitDisplay: "short",
    maximumFractionDigits: digits,
  }).format(n);
}

/** Hectares in, "ha" or "ac" out. */
export function formatArea(hectares: number, units: Units, locale: FormatLocale): string {
  return units === "imperial"
    ? unitNumber(hectares / HA_PER_AC, locale, "acre", 1)
    : unitNumber(hectares, locale, "hectare", 1);
}

/** Metres in; m / km, or ft / mi. */
export function formatDistance(metres: number, units: Units, locale: FormatLocale): string {
  if (units === "imperial") {
    const ft = metres / M_PER_FT;
    return ft < 1000 ? unitNumber(ft, locale, "foot", 0) : unitNumber(metres / M_PER_MI, locale, "mile", 1);
  }
  return metres < 1000 ? unitNumber(metres, locale, "meter", 0) : unitNumber(metres / 1000, locale, "kilometer", 1);
}

/** Tonnes per hectare in; "t/ha" or, imperial, "t/ac" (short tons are not used: it stays metric tonnes). */
export function formatYield(tPerHa: number, units: Units, locale: FormatLocale): string {
  const imperial = units === "imperial";
  const value = imperial ? tPerHa * HA_PER_AC : tPerHa;
  const unit = locale === "uk" ? (imperial ? "т/ак" : "т/га") : imperial ? "t/ac" : "t/ha";
  return `${formatNumber(value, locale, { maximumFractionDigits: 1 })}\u00A0${unit}`;
}

/** Degrees Celsius in. */
export function formatTemp(celsius: number, units: Units, locale: FormatLocale): string {
  return units === "imperial"
    ? unitNumber((celsius * 9) / 5 + 32, locale, "fahrenheit", 0)
    : unitNumber(celsius, locale, "celsius", 0);
}

/** Metres per second in; km/h or mph out. */
export function formatWind(metresPerSecond: number, units: Units, locale: FormatLocale): string {
  return units === "imperial"
    ? unitNumber(metresPerSecond * MPH_PER_MS, locale, "mile-per-hour", 0)
    : unitNumber(metresPerSecond * KMH_PER_MS, locale, "kilometer-per-hour", 0);
}

/** Millimetres in; mm or in. */
export function formatRain(mm: number, units: Units, locale: FormatLocale): string {
  return units === "imperial"
    ? unitNumber(mm / MM_PER_IN, locale, "inch", 2)
    : unitNumber(mm, locale, "millimeter", mm < 10 ? 1 : 0);
}

export interface PluralForms {
  one: string;
  few?: string;
  many?: string;
  other: string;
  zero?: string;
  two?: string;
}

/** Picks the right word form with Intl.PluralRules (Ukrainian: one / few / many). `{n}` in a form is replaced. */
export function plural(n: number, locale: FormatLocale, forms: PluralForms): string {
  const cat = new Intl.PluralRules(tag(locale)).select(n) as keyof PluralForms;
  const form = forms[cat] ?? forms.other;
  return form.replace("{n}", formatNumber(n, locale, { maximumFractionDigits: 0 }));
}
