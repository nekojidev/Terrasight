"use client";

import { useEffect } from "react";
import "./globals.css";

/**
 * Last-resort boundary: it replaces the root layout, so there is no next-intl provider here.
 * The locale comes from the same cookie the layout reads; copy is inline (EN/UK).
 */
const COPY = {
  en: {
    title: "Something went wrong",
    body: "The page could not be shown. Your data is safe. Try again, or go back to the start.",
    again: "Try again",
    home: "Go home",
  },
  uk: {
    title: "Щось пішло не так",
    body: "Сторінку не вдалося показати. Ваші дані в безпеці. Спробуйте ще раз або поверніться на початок.",
    again: "Спробувати ще раз",
    home: "На головну",
  },
} as const;

function locale(): "en" | "uk" {
  try {
    return /(?:^|;\s*)ts_locale=uk(?:;|$)/.test(document.cookie) ? "uk" : "en";
  } catch {
    return "en";
  }
}

export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);
  const lang = locale();
  const c = COPY[lang];
  return (
    <html lang={lang}>
      <body className="min-h-dvh bg-bg text-ink">
        <main className="mx-auto flex min-h-dvh w-full max-w-[560px] flex-col justify-center gap-5 px-6 py-10">
          <h1 className="text-h1 text-ink">{c.title}</h1>
          <p role="alert" className="text-body text-ink-2">
            {c.body}
          </p>
          {error.digest && <p className="font-mono text-micro text-ink-3">{error.digest}</p>}
          <div className="flex flex-wrap gap-3">
            <button
              type="button"
              onClick={reset}
              className="focus-ring inline-flex h-12 items-center rounded-btn bg-ink px-5 text-body font-semibold text-surface"
            >
              {c.again}
            </button>
            {/* A plain anchor on purpose: after a root crash a full page load is the reliable way out. */}
            <a
              href="/"
              className="focus-ring inline-flex h-12 items-center rounded-btn border border-line-strong bg-surface px-5 text-body font-semibold text-ink"
            >
              {c.home}
            </a>
          </div>
        </main>
      </body>
    </html>
  );
}
