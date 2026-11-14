"use client";

import { clsx } from "clsx";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { setCookie } from "@/lib/api";

/** UA / EN switch (design 01–03). Stores the choice in a cookie and re-renders the server components. */
export function LanguageSwitch({ className }: { className?: string }) {
  const locale = useLocale();
  const router = useRouter();
  const t = useTranslations("Login");
  const set = (l: "uk" | "en") => {
    setCookie("ts_locale", l);
    router.refresh();
  };
  return (
    <div
      role="group"
      aria-label={t("lang_group")}
      className={clsx("flex rounded-input border border-line bg-surface p-1", className)}
    >
      {(["uk", "en"] as const).map((l) => (
        <button
          key={l}
          type="button"
          aria-pressed={locale === l}
          onClick={() => set(l)}
          className={clsx(
            "focus-ring min-h-tap rounded-btn px-3 text-body font-semibold",
            locale === l ? "bg-bg text-ink" : "text-ink-2",
          )}
        >
          {l === "uk" ? "UA" : "EN"}
        </button>
      ))}
    </div>
  );
}
