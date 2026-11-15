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
export function formatTemp(celsius: number, units: Units, locale: FormatLocale, digits = 0): string {
  return units === "imperial"
    ? unitNumber((celsius * 9) / 5 + 32, locale, "fahrenheit", digits)
    : unitNumber(celsius, locale, "celsius", digits);
}

/** First sign becomes a true minus (U+2212); the plus is explicit; a value that rounds to zero carries no sign. */
function trueMinus(text: string): string {
  return text.replace(/[-\u2010\u2011]/, "\u2212");
}

/** `+1.4`, `−0.6`, `0`: explicit sign, true minus sign, never "-0". */
export function formatSigned(
  n: number,
  locale: FormatLocale,
  opts: { maximumFractionDigits?: number; minimumFractionDigits?: number } = {},
): string {
  return trueMinus(
    new Intl.NumberFormat(tag(locale), {
      maximumFractionDigits: opts.maximumFractionDigits ?? 1,
      ...(opts.minimumFractionDigits !== undefined ? { minimumFractionDigits: opts.minimumFractionDigits } : {}),
      signDisplay: "exceptZero",
    }).format(n),
  );
}

function signedUnit(n: number, locale: FormatLocale, unit: string, digits: number): string {
  return trueMinus(
    new Intl.NumberFormat(tag(locale), {
      style: "unit",
      unit,
      unitDisplay: "short",
      maximumFractionDigits: digits,
      signDisplay: "exceptZero",
    }).format(n),
  );
}

/**
 * A temperature DIFFERENCE in °C in; "+1.4 °C", or imperial "+2.5 °F". A difference is scaled by 9/5 only, without
 * the +32 offset of an absolute temperature (1 °C of difference is 1.8 °F, not 33.8).
 */
export function formatTempDelta(deltaCelsius: number, units: Units, locale: FormatLocale, digits = 1): string {
  return units === "imperial"
    ? signedUnit((deltaCelsius * 9) / 5, locale, "fahrenheit", digits)
    : signedUnit(deltaCelsius, locale, "celsius", digits);
}

/** A rainfall difference in mm in; signed mm or in. */
export function formatRainDelta(deltaMm: number, units: Units, locale: FormatLocale): string {
  return units === "imperial"
    ? signedUnit(deltaMm / MM_PER_IN, locale, "inch", 2)
    : signedUnit(deltaMm, locale, "millimeter", Math.abs(deltaMm) < 10 ? 1 : 0);
}

/** Day of year (1 = 1 January, non-leap calendar) as a date without a weekday: "12 May" / "May 12" per locale. */
export function formatDayOfYear(doy: number, locale: FormatLocale): string {
  const d = new Date(Date.UTC(2023, 0, Math.round(doy)));
  return new Intl.DateTimeFormat(tag(locale), { day: "numeric", month: "short", timeZone: "UTC" }).format(d);
}

export type DayShift = { days: number; direction: "earlier" | "later" | "same" };

/** A change of a day-of-year in days, as a size and a direction; the caller words it ("8 days earlier"). */
export function dayShift(deltaDays: number, digits = 0): DayShift {
  const f = 10 ** digits;
  const days = Math.round(Math.abs(deltaDays) * f) / f;
  return { days, direction: days === 0 ? "same" : deltaDays < 0 ? "earlier" : "later" };
}

/** Metres per second in; km/h or mph out. */
export function formatWind(metresPerSecond: number, units: Units, locale: FormatLocale): string {
  return units === "imperial"
    ? unitNumber(metresPerSecond * MPH_PER_MS, locale, "mile-per-hour", 0)
    : // Metric wind stays in m/s: the work-window thresholds and local forecasts are stated in m/s.
      unitNumber(metresPerSecond, locale, "meter-per-second", metresPerSecond < 10 ? 1 : 0);
}

/**
 * Money per hectare in, labelled per hectare or per acre by the unit system: "$130 per ha" / "$52 per ac"
 * (UK: "130 $ за га" / "52 $ за ак"). The amount is converted, not only relabelled.
 */
export function moneyPerArea(
  amountPerHa: number,
  currency: "USD" | "UAH",
  units: Units,
  locale: FormatLocale,
  opts: { compact?: boolean; maximumFractionDigits?: number } = {},
): string {
  const imperial = units === "imperial";
  const money = formatMoney(imperial ? amountPerHa * HA_PER_AC : amountPerHa, currency, locale, opts);
  const unit = locale === "uk" ? (imperial ? "ак" : "га") : imperial ? "ac" : "ha";
  return `${money}\u00A0${locale === "uk" ? "за" : "per"}\u00A0${unit}`;
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
