"use client";

import { clsx } from "clsx";
import { Check } from "lucide-react";
import { useEffect, useState } from "react";

export interface DoneRowProps {
  /** "Asked the owner" / "Snoozed until tomorrow 06:00". */
  label: string;
  undoLabel: string;
  /** Server-sent end of the Undo window (RFC §10.4: action time + 8 s). */
  undoUntil: Date | string | number;
  onUndo: () => void;
  /** Injected for tests. */
  now?: () => number;
  className?: string;
}

/**
 * Done state for Accept and Snooze (design 17): ink row with a lime check, Undo and a visible countdown bar.
 * The countdown follows the server's `undoUntil`, so it matches what the server will still accept.
 */
export function DoneRow({ label, undoLabel, undoUntil, onUndo, now = Date.now, className }: DoneRowProps) {
  const end = new Date(undoUntil).getTime();
  const [initial] = useState(() => Math.max(0, end - now()));
  const [open, setOpen] = useState(initial > 0);

  // The bar is a CSS animation; this timer only flips the row when the server's window ends.
  useEffect(() => {
    if (!open) return;
    const t = setInterval(() => {
      if (end - now() <= 0) setOpen(false);
    }, 100);
    return () => clearInterval(t);
  }, [end, now, open]);

  return (
    <div className={clsx("flex flex-col gap-2", className)}>
      <div
        role="status"
        aria-live="polite"
        className="flex items-center gap-3 rounded-card bg-ink px-4 py-3 text-surface"
      >
        <span
          aria-hidden
          className="inline-flex size-7 items-center justify-center rounded-chip bg-ok text-surface"
        >
          <Check className="size-4" strokeWidth={2} />
        </span>
        <span className="flex-1 text-body">{label}</span>
        {open && (
          <button
            type="button"
            onClick={onUndo}
            className="focus-ring min-h-tap rounded-btn px-2 text-body font-semibold text-signal dark:text-on-signal"
          >
            {undoLabel}
          </button>
        )}
      </div>
      {open && (
        <span aria-hidden className="block h-1 overflow-hidden rounded-chip bg-line">
          <span
            className="animate-countdown block h-full bg-ok"
            style={{ animationDuration: `${initial}ms` }}
          />
        </span>
      )}
    </div>
  );
}
