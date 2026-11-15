"use client";

import { Button, SheetRow } from "@terrasight/ui";
import { Monitor, Moon, Sun } from "lucide-react";
import { useTranslations } from "next-intl";
import { THEME_MODES } from "@/lib/theme";
import { useTheme } from "./ThemeProvider";

/** Cycles system, light, dark. Default: an icon button; `row` renders a sheet row (phone "More") naming the mode. */
export function ThemeToggle({ className = "", row = false }: { className?: string; row?: boolean }) {
  const a = useTranslations("App");
  const { mode, setMode } = useTheme();
  const next = THEME_MODES[(THEME_MODES.indexOf(mode) + 1) % THEME_MODES.length]!;
  const Icon = mode === "dark" ? Moon : mode === "light" ? Sun : Monitor;
  const name = a(mode === "dark" ? "themeDark" : mode === "light" ? "themeLight" : "themeSystem");
  const label = a("themeToggle", { mode: name });
  if (row) return <SheetRow label={a("themeRow")} icon={<Icon />} trailing={name} onSelect={() => setMode(next)} />;
  return <Button variant="icon" label={label} icon={<Icon />} onClick={() => setMode(next)} className={className} />;
}
