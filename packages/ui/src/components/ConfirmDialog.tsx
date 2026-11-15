"use client";

import { useEffect, useId, useRef, type ReactNode } from "react";
import { Button } from "./Button";
import { trapTab } from "./focus";

export interface ConfirmDialogProps {
  open: boolean;
  title: string;
  children?: ReactNode;
  confirmLabel: string;
  cancelLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
  busy?: boolean;
}

/** Styled replacement for window.confirm: centred dialog, Esc and backdrop cancel, focus returns on close. */
export function ConfirmDialog(p: ConfirmDialogProps) {
  const titleId = useId();
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!p.open) return;
    const previous = document.activeElement as HTMLElement | null;
    ref.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") p.onCancel();
      else trapTab(e, ref.current);
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      previous?.focus();
    };
  }, [p.open, p.onCancel]);
  if (!p.open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <button
        type="button"
        aria-label={p.cancelLabel}
        className="animate-fade absolute inset-0 bg-scrim"
        onClick={p.onCancel}
      />
      <div
        ref={ref}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className="animate-pop relative w-full max-w-[440px] rounded-card bg-surface p-6 shadow-sheet outline-none"
      >
        <h2 id={titleId} className="text-h2 mb-3 text-ink">
          {p.title}
        </h2>
        {p.children && <div className="mb-6 text-body text-ink-2">{p.children}</div>}
        <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
          <Button variant="outline" size={48} className="justify-center" onClick={p.onCancel}>
            {p.cancelLabel}
          </Button>
          <Button size={48} className="justify-center" onClick={p.onConfirm} disabled={p.busy} aria-busy={p.busy}>
            {p.confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}
