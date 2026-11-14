"use client";

import { Monitor, Moon, Sun } from "lucide-react";
import { useTranslations } from "next-intl";
import { THEME_MODES } from "@/lib/theme";
import { useTheme } from "./ThemeProvider";

/** Icon button cycling system, light, dark. */
export function ThemeToggle({ className = "" }: { className?: string }) {
  const a = useTranslations("App");
  const { mode, setMode } = useTheme();
  const next = THEME_MODES[(THEME_MODES.indexOf(mode) + 1) % THEME_MODES.length]!;
  const Icon = mode === "dark" ? Moon : mode === "light" ? Sun : Monitor;
  const name = a(mode === "dark" ? "themeDark" : mode === "light" ? "themeLight" : "themeSystem");
  const label = a("themeToggle", { mode: name });
  return (
    <button
      type="button"
      onClick={() => setMode(next)}
      aria-label={label}
      title={label}
      className={`focus-ring inline-flex size-11 items-center justify-center rounded-btn text-ink-2 hover:bg-surface-2 ${className}`}
    >
      <Icon aria-hidden className="size-5" strokeWidth={1.7} />
    </button>
  );
}
