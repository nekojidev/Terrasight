"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, type ReactNode } from "react";

/** A consumer returns true when it took the question (so the asker doesn't need a fallback). */
type Handler = (question: string) => boolean;

interface Bus {
  /** Sends a question to the assistant panel on this page. Returns false when no panel can take it. */
  ask: (question: string) => boolean;
  register: (handler: Handler) => () => void;
}

const Ctx = createContext<Bus>({ ask: () => false, register: () => () => undefined });

/** Small event channel between a page's cards ("Why so?") and the assistant panel beside the field. */
export function AssistantBusProvider({ children }: { children: ReactNode }) {
  const handlers = useRef(new Set<Handler>());
  const register = useCallback((h: Handler) => {
    handlers.current.add(h);
    return () => {
      handlers.current.delete(h);
    };
  }, []);
  const ask = useCallback((q: string) => {
    for (const h of handlers.current) if (h(q)) return true;
    return false;
  }, []);
  const value = useMemo(() => ({ ask, register }), [ask, register]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

/** `AssistantBus.ask(question)` for cards. */
export const useAssistantBus = (): Pick<Bus, "ask"> => {
  const { ask } = useContext(Ctx);
  return { ask };
};

/** The assistant panel registers here while mounted. */
export function useAssistantAsk(handler: Handler): void {
  const { register } = useContext(Ctx);
  const ref = useRef(handler);
  useEffect(() => {
    ref.current = handler;
  });
  useEffect(() => register((q) => ref.current(q)), [register]);
}
