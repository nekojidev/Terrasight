import { cookies } from "next/headers";
import { getRequestConfig } from "next-intl/server";

export const LOCALES = ["uk", "en"] as const;
export type Locale = (typeof LOCALES)[number];
export const LOCALE_COOKIE = "ts_locale";

/**
 * No locale in the URL (Tech Design §15.2): the user's choice is kept in a cookie.
 * Messages = design/i18n (generated into messages/*.json) + app copy the design doesn't cover (src/messages).
 */
export default getRequestConfig(async () => {
  const value = (await cookies()).get(LOCALE_COOKIE)?.value;
  const locale: Locale = LOCALES.includes(value as Locale) ? (value as Locale) : "en";
  const design = (await import(`../../messages/${locale}.json`)).default;
  const app = (await import(`../messages/app.${locale}.json`)).default;
  return { locale, messages: { ...design, ...app } };
});
