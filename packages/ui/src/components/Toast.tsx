"use client";

import { clsx } from "clsx";
import { X } from "lucide-react";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";

export type ToastTone = "error" | "info";
export interface ToastAction {
  label: string;
  onClick: () => void;
}
export interface ToastOptions {
  action?: ToastAction;
}
interface ToastItem {
  id: number;
  message: string;
  tone: ToastTone;
  action?: ToastAction;
}
interface ToastApi {
  show: (message: string, tone?: ToastTone, opts?: ToastOptions) => void;
}

const Ctx = createContext<ToastApi>({ show: () => undefined });

/**
 * Toast stack: announces to screen readers, tokens only. Info toasts dismiss after 6 s; error toasts stay until
 * dismissed (the person must be able to read what went wrong and use the action).
 */
export function ToastProvider({ children, dismissLabel }: { children: ReactNode; dismissLabel: string }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const next = useRef(0);
  const timers = useRef(new Map<number, ReturnType<typeof setTimeout>>());

  const dismiss = useCallback((id: number) => {
    setItems((l) => l.filter((i) => i.id !== id));
    const t = timers.current.get(id);
    if (t) clearTimeout(t);
    timers.current.delete(id);
  }, []);
  const show = useCallback(
    (message: string, tone: ToastTone = "error", opts?: ToastOptions) => {
      const id = ++next.current;
      setItems((l) => [...l.slice(-2), { id, message, tone, ...(opts?.action ? { action: opts.action } : {}) }]);
      if (tone !== "error")
        timers.current.set(
          id,
          setTimeout(() => dismiss(id), 6000),
        );
    },
    [dismiss],
  );
  useEffect(() => {
    const m = timers.current;
    return () => m.forEach((t) => clearTimeout(t));
  }, []);

  const api = useMemo(() => ({ show }), [show]);
  return (
    <Ctx.Provider value={api}>
      {children}
      <div
        aria-live="polite"
        className="pointer-events-none fixed inset-x-0 bottom-[calc(var(--ts-tabbar)+16px+env(safe-area-inset-bottom))] z-[60] flex flex-col items-center gap-2 px-4 lg:bottom-6"
      >
        {items.map((i) => (
          <div
            key={i.id}
            role={i.tone === "error" ? "alert" : "status"}
            className={clsx(
              "animate-pop pointer-events-auto flex w-full max-w-[420px] items-center gap-2 rounded-input border py-1 pr-1 pl-4 text-body shadow-sheet",
              i.tone === "error" ? "border-urgent bg-urgent-soft text-urgent" : "border-line bg-surface text-ink",
            )}
          >
            <span className="min-w-0 flex-1 py-2">{i.message}</span>
            {i.action && (
              <button
                type="button"
                onClick={() => {
                  i.action?.onClick();
                  dismiss(i.id);
                }}
                className="focus-ring min-h-tap shrink-0 rounded-btn px-3 text-body font-semibold underline underline-offset-4"
              >
                {i.action.label}
              </button>
            )}
            <button
              type="button"
              aria-label={dismissLabel}
              onClick={() => dismiss(i.id)}
              className="focus-ring inline-flex size-11 shrink-0 items-center justify-center rounded-chip"
            >
              <X aria-hidden className="size-4" />
            </button>
          </div>
        ))}
      </div>
    </Ctx.Provider>
  );
}

export const useToast = (): ToastApi => useContext(Ctx);
