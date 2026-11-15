"use client";

import { useLocale } from "next-intl";
import { useMemo } from "react";
import {
  dayShift,
  formatArea,
  formatDayOfYear,
  formatDate,
  formatDateRelative,
  formatDistance,
  formatMoney,
  formatNumber,
  formatPercent,
  formatRain,
  formatRainDelta,
  formatSigned,
  formatTemp,
  formatTempDelta,
  formatWind,
  formatYield,
  moneyPerArea,
  plural,
  type DateStyle,
  type FormatLocale,
  type PluralForms,
  type Units,
} from "./format";

export interface UseFormatOptions {
  /** ISO country code of the field or workspace; "US" selects imperial units. Metric otherwise. */
  country?: string;
  /** Explicit unit system (e.g. the workspace setting); wins over `country`. */
  units?: Units;
}

/** Formatters bound to the current UI locale and unit system. */
export function useFormat(options: UseFormatOptions = {}) {
  const raw = useLocale();
  const locale: FormatLocale = raw === "uk" ? "uk" : "en";
  const units: Units = options.units ?? (options.country?.toUpperCase() === "US" ? "imperial" : "metric");
  return useMemo(
    () => ({
      locale,
      units,
      date: (d: Date | string | number, style?: DateStyle, opts?: { timeZone?: string }) =>
        formatDate(d, locale, style, opts),
      number: (n: number, opts?: { maximumFractionDigits?: number; minimumFractionDigits?: number }) =>
        formatNumber(n, locale, opts),
      percent: (fraction: number, opts?: { maximumFractionDigits?: number }) => formatPercent(fraction, locale, opts),
      money: (amount: number, currency: "USD" | "UAH", opts?: { compact?: boolean; maximumFractionDigits?: number }) =>
        formatMoney(amount, currency, locale, opts),
      /** Today / tomorrow / yesterday as words, every other day `short`. `now` defaults to the current time. */
      dateRel: (d: Date | string | number, opts?: { now?: Date | number; style?: DateStyle; timeZone?: string }) =>
        formatDateRelative(d, opts?.now ?? Date.now(), locale, opts?.style, opts?.timeZone ? { timeZone: opts.timeZone } : {}),
      moneyPerArea: (amountPerHa: number, currency: "USD" | "UAH") => moneyPerArea(amountPerHa, currency, units, locale),
      area: (hectares: number) => formatArea(hectares, units, locale),
      distance: (metres: number) => formatDistance(metres, units, locale),
      yield: (tPerHa: number) => formatYield(tPerHa, units, locale),
      temp: (celsius: number, digits?: number) => formatTemp(celsius, units, locale, digits),
      tempDelta: (deltaCelsius: number, digits?: number) => formatTempDelta(deltaCelsius, units, locale, digits),
      rainDelta: (deltaMm: number) => formatRainDelta(deltaMm, units, locale),
      signed: (n: number, opts?: { maximumFractionDigits?: number; minimumFractionDigits?: number }) =>
        formatSigned(n, locale, opts),
      dayOfYear: (doy: number) => formatDayOfYear(doy, locale),
      dayShift: (deltaDays: number, digits?: number) => dayShift(deltaDays, digits),
      wind: (metresPerSecond: number) => formatWind(metresPerSecond, units, locale),
      rain: (mm: number) => formatRain(mm, units, locale),
      count: (n: number, forms: PluralForms) => plural(n, locale, forms),
      plural: (n: number, forms: PluralForms) => plural(n, locale, forms),
    }),
    [locale, units],
  );
}
