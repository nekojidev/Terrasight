import type { Metadata } from "next";
import { JetBrains_Mono, Onest } from "next/font/google";
import { NextIntlClientProvider } from "next-intl";
import { getLocale } from "next-intl/server";
import { cookies } from "next/headers";
import type { CSSProperties, ReactNode } from "react";
import { SidebarStateProvider } from "@/components/SidebarState";
import { SIDEBAR_COOKIE } from "@/lib/sidebar";
import { ThemeProvider } from "@/components/ThemeProvider";
import { THEME_BOOT_SCRIPT, THEME_COOKIE, parseThemeMode } from "@/lib/theme";
import { Providers } from "./providers";
import "./globals.css";

// Self-hosted by next/font; the token families point at these (design/tokens.css names Onest and JetBrains Mono).
const onest = Onest({
  subsets: ["latin", "cyrillic"],
  weight: ["400", "600", "700"],
  variable: "--font-onest",
});
const mono = JetBrains_Mono({
  subsets: ["latin", "cyrillic"],
  weight: ["400", "600"],
  variable: "--font-jbmono",
});

export const metadata: Metadata = { title: "Terrasight", description: "Morning brief for agronomists" };

export default async function RootLayout({ children }: { children: ReactNode }) {
  const locale = await getLocale();
  const mode = parseThemeMode((await cookies()).get(THEME_COOKIE)?.value);
  const sidebarCollapsed = (await cookies()).get(SIDEBAR_COOKIE)?.value === "1";
  const fonts = {
    "--ts-font": "var(--font-onest), system-ui, -apple-system, 'Segoe UI', sans-serif",
    "--ts-mono": "var(--font-jbmono), ui-monospace, monospace",
  } as CSSProperties;
  return (
    <html
      lang={locale}
      className={`${onest.variable} ${mono.variable}`}
      style={fonts}
      data-theme={mode === "system" ? undefined : mode}
      data-theme-mode={mode}
      suppressHydrationWarning
    >
      <body className="min-h-dvh bg-bg">
        {/* "system": resolve prefers-color-scheme before the content paints (no flash). First in <body>: an inline
            script in a hand-written <head> breaks hydration (React #418). */}
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOT_SCRIPT }} />
        <NextIntlClientProvider>
          <ThemeProvider initial={mode}>
            <SidebarStateProvider initial={sidebarCollapsed}>
              <Providers>{children}</Providers>
            </SidebarStateProvider>
          </ThemeProvider>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
