"use client";

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { setCookie } from "@/lib/api";
import { THEME_COOKIE, type ThemeMode } from "@/lib/theme";

const ThemeContext = createContext<{ mode: ThemeMode; setMode: (m: ThemeMode) => void }>({
  mode: "system",
  setMode: () => undefined,
});

export const useTheme = () => useContext(ThemeContext);

function apply(mode: ThemeMode) {
  const root = document.documentElement;
  const dark = mode === "dark" || (mode === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
  root.setAttribute("data-theme-mode", mode);
  root.setAttribute("data-theme", dark ? "dark" : "light");
}

/** Theme choice (light / dark / system) kept in the ts_theme cookie; the server renders it on <html>. */
export function ThemeProvider({ initial, children }: { initial: ThemeMode; children: ReactNode }) {
  const [mode, setModeState] = useState<ThemeMode>(initial);

  const setMode = useCallback((m: ThemeMode) => {
    setCookie(THEME_COOKIE, m);
    apply(m);
    setModeState(m);
  }, []);

  // "system" follows the OS while the page is open.
  useEffect(() => {
    if (mode !== "system") return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => apply("system");
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [mode]);

  return <ThemeContext.Provider value={{ mode, setMode }}>{children}</ThemeContext.Provider>;
}
