"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

import { SIDEBAR_COOKIE } from "@/lib/sidebar";

export { SIDEBAR_COOKIE };

interface SidebarState {
  collapsed: boolean;
  toggle: () => void;
}

const Ctx = createContext<SidebarState>({ collapsed: false, toggle: () => undefined });

function writeCookie(collapsed: boolean): void {
  try {
    document.cookie = `${SIDEBAR_COOKIE}=${collapsed ? "1" : "0"}; Path=/; Max-Age=31536000; SameSite=Lax`;
  } catch {
    /* cookies blocked: the choice just won't persist */
  }
}

function isTyping(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false;
  return el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName);
}

/** Desktop sidebar rail state. `initial` comes from the cookie read in the root layout (no layout shift). `[` toggles. */
export function SidebarStateProvider({ initial, children }: { initial: boolean; children: ReactNode }) {
  const [collapsed, setCollapsed] = useState(initial);

  const toggle = useCallback(() => {
    setCollapsed((c) => !c);
  }, []);

  useEffect(() => {
    writeCookie(collapsed);
  }, [collapsed]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "[" || e.ctrlKey || e.metaKey || e.altKey || e.defaultPrevented || isTyping(e.target)) return;
      toggle();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [toggle]);

  const value = useMemo(() => ({ collapsed, toggle }), [collapsed, toggle]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export const useSidebarState = (): SidebarState => useContext(Ctx);
