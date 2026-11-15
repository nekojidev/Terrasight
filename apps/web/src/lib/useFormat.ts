"use client";

import { useLocale } from "next-intl";
import { useMemo } from "react";
import {
  formatArea,
  formatDate,
  formatDistance,
  formatMoney,
  formatNumber,
  formatPercent,
  formatRain,
  formatTemp,
  formatWind,
  formatYield,
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
      area: (hectares: number) => formatArea(hectares, units, locale),
      distance: (metres: number) => formatDistance(metres, units, locale),
      yield: (tPerHa: number) => formatYield(tPerHa, units, locale),
      temp: (celsius: number) => formatTemp(celsius, units, locale),
      wind: (metresPerSecond: number) => formatWind(metresPerSecond, units, locale),
      rain: (mm: number) => formatRain(mm, units, locale),
      plural: (n: number, forms: PluralForms) => plural(n, locale, forms),
    }),
    [locale, units],
  );
}
