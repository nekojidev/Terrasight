"use client";

import { clsx } from "clsx";
import { X } from "lucide-react";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";

export type ToastTone = "error" | "info";
interface ToastItem {
  id: number;
  message: string;
  tone: ToastTone;
}
interface ToastApi {
  show: (message: string, tone?: ToastTone) => void;
}

const Ctx = createContext<ToastApi>({ show: () => undefined });

/** Minimal toast stack: announces to screen readers, auto-dismisses, tokens only. */
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
    (message: string, tone: ToastTone = "error") => {
      const id = ++next.current;
      setItems((l) => [...l.slice(-2), { id, message, tone }]);
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
        className="pointer-events-none fixed inset-x-0 bottom-20 z-[60] flex flex-col items-center gap-2 px-4 lg:bottom-6"
      >
        {items.map((i) => (
          <div
            key={i.id}
            role={i.tone === "error" ? "alert" : "status"}
            className={clsx(
              "pointer-events-auto flex w-full max-w-[420px] items-start gap-3 rounded-input border px-4 py-3 text-body shadow-sheet",
              i.tone === "error" ? "border-urgent bg-urgent-soft text-urgent" : "border-line bg-surface text-ink",
            )}
          >
            <span className="min-w-0 flex-1">{i.message}</span>
            <button
              type="button"
              aria-label={dismissLabel}
              onClick={() => dismiss(i.id)}
              className="focus-ring inline-flex size-6 shrink-0 items-center justify-center rounded-chip"
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
