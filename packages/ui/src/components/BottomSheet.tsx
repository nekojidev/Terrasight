"use client";

import { clsx } from "clsx";
import { useEffect, useId, useRef, type ReactNode } from "react";
import { Button } from "./Button";

export interface BottomSheetProps {
  open: boolean;
  title: string;
  children: ReactNode;
  primaryLabel: string;
  cancelLabel: string;
  onPrimary: () => void;
  onClose: () => void;
  primaryDisabled?: boolean;
}

/** Phone confirmations and the scouting counter (design 05, 12). Esc and the backdrop close it. */
export function BottomSheet(p: BottomSheetProps) {
  const titleId = useId();
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!p.open) return;
    const previous = document.activeElement as HTMLElement | null;
    ref.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && p.onClose();
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      previous?.focus();
    };
  }, [p.open, p.onClose]);

  if (!p.open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center">
      <button
        type="button"
        aria-label={p.cancelLabel}
        className="absolute inset-0 bg-ink/40"
        onClick={p.onClose}
      />
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className={clsx(
          "animate-sheet-in relative w-full max-w-[480px] rounded-t-sheet bg-surface p-6 pb-8 shadow-sheet outline-none",
        )}
      >
        <span aria-hidden className="mx-auto mb-4 block h-1 w-10 rounded-chip bg-line-strong" />
        <h2 id={titleId} className="text-h2 mb-4 text-ink">
          {p.title}
        </h2>
        <div className="mb-6">{p.children}</div>
        <div className="flex flex-col gap-3">
          <Button
            size={52}
            className="w-full justify-center"
            onClick={p.onPrimary}
            disabled={p.primaryDisabled}
          >
            {p.primaryLabel}
          </Button>
          <Button size={52} variant="outline" className="w-full justify-center" onClick={p.onClose}>
            {p.cancelLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}
