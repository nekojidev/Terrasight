import type { Metadata } from "next";
import { JetBrains_Mono, Onest } from "next/font/google";
import { NextIntlClientProvider } from "next-intl";
import { getLocale } from "next-intl/server";
import type { CSSProperties, ReactNode } from "react";
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
  const fonts = {
    "--ts-font": "var(--font-onest), system-ui, -apple-system, 'Segoe UI', sans-serif",
    "--ts-mono": "var(--font-jbmono), ui-monospace, monospace",
  } as CSSProperties;
  return (
    <html lang={locale} className={`${onest.variable} ${mono.variable}`} style={fonts}>
      <body className="min-h-dvh bg-bg">
        <NextIntlClientProvider>
          <Providers>{children}</Providers>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
