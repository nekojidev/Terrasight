import { cookies } from "next/headers";
import { getRequestConfig } from "next-intl/server";

export const LOCALES = ["uk", "en"] as const;
export type Locale = (typeof LOCALES)[number];
export const LOCALE_COOKIE = "ts_locale";

/** No locale in the URL (Tech Design §15.2): the user's setting is kept in a cookie. */
export default getRequestConfig(async () => {
  const value = (await cookies()).get(LOCALE_COOKIE)?.value;
  const locale: Locale = LOCALES.includes(value as Locale) ? (value as Locale) : "en";
  const messages = (await import(`../../messages/${locale}.json`)).default;
  return { locale, messages };
});
