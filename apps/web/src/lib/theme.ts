export const THEME_COOKIE = "ts_theme";
export const THEME_MODES = ["system", "light", "dark"] as const;
export type ThemeMode = (typeof THEME_MODES)[number];

export function parseThemeMode(value: string | undefined): ThemeMode {
  return THEME_MODES.includes(value as ThemeMode) ? (value as ThemeMode) : "system";
}

/** Runs in <head> before paint: for "system", copy prefers-color-scheme into data-theme (tokens.css matches [data-theme="dark"]). */
export const THEME_BOOT_SCRIPT = `(function(){var d=document.documentElement;if(d.getAttribute("data-theme-mode")==="system"&&window.matchMedia("(prefers-color-scheme: dark)").matches)d.setAttribute("data-theme","dark")})()`;
