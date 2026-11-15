import { useEffect, useState } from "react";

/**
 * Time helpers for client components. Nothing here reads the clock or the browser's zone during render:
 * "now" comes from `useNow()` (null on the server and on the hydration render, the real time after mount) and every
 * format names its time zone (the workspace's), so server HTML and the first client render always agree.
 */

export type Greeting = "hiMorning" | "hiDay" | "hiEvening";

/** The current time, or null until the component has mounted in the browser. */
export function useNow(): Date | null {
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    setNow(new Date());
  }, []);
  return now;
}

export const intlLocale = (locale: string): string => (locale === "uk" ? "uk-UA" : "en-US");

/** Local hour (0-23) in `timeZone`. */
export function hourIn(now: Date, timeZone: string): number {
  return Number(new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", hourCycle: "h23" }).format(now));
}

/** Local month (1-12) in `timeZone`. */
export function monthIn(now: Date, timeZone: string): number {
  return Number(new Intl.DateTimeFormat("en-US", { timeZone, month: "numeric" }).format(now));
}

/** Greeting for the workspace's local hour; a neutral one while the time is unknown. */
export function greetingKey(now: Date | null, timeZone: string): Greeting {
  if (!now) return "hiDay";
  const h = hourIn(now, timeZone);
  return h < 12 ? "hiMorning" : h < 18 ? "hiDay" : "hiEvening";
}

/** Short day + month in the workspace zone, e.g. "Nov 15". */
export function dateShortIn(iso: string, locale: string, timeZone: string): string {
  return new Intl.DateTimeFormat(intlLocale(locale), { timeZone, day: "numeric", month: "short" }).format(new Date(iso));
}

/** Clock time in the workspace zone, always 24-hour-agnostic per locale but zone-fixed. */
export function timeIn(iso: string, locale: string, timeZone: string): string {
  return new Intl.DateTimeFormat(intlLocale(locale), { timeZone, hour: "2-digit", minute: "2-digit" }).format(
    new Date(iso),
  );
}

/** Same calendar day in `timeZone`. */
export function isSameDayIn(a: Date, b: Date, timeZone: string): boolean {
  const key = (d: Date) => new Intl.DateTimeFormat("en-CA", { timeZone }).format(d);
  return key(a) === key(b);
}

/** Autumn checks (Sep-Dec) apply in the northern-hemisphere autumn, as before; `null` now means "not yet known". */
export function isAutumn(now: Date | null, timeZone: string): boolean {
  return now ? [9, 10, 11, 12].includes(monthIn(now, timeZone)) : false;
}
