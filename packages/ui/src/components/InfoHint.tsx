"use client";

import { clsx } from "clsx";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";

export interface InfoHintProps {
  /** Accessible name of the "i" button, e.g. "What does this mean?". Localised by the caller. */
  label: string;
  /** 1–3 short lines. Plain text or a node. */
  children: ReactNode;
  /** Which edge of the button the popover lines up with. */
  align?: "start" | "end";
  className?: string;
}

/**
 * A small "i" button with a popover (design/README §5): opens on hover, focus and tap, closes on Escape,
 * outside tap or blur. The popover is a `role="tooltip"` referenced by `aria-describedby`.
 */
export function InfoHint({ label, children, align = "start", className }: InfoHintProps) {
  const id = useId();
  const root = useRef<HTMLSpanElement>(null);
  const [pinned, setPinned] = useState(false);
  const [hover, setHover] = useState(false);
  const open = pinned || hover;

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setPinned(false);
        setHover(false);
      }
    };
    const onDown = (e: Event) => {
      if (root.current && !root.current.contains(e.target as Node)) setPinned(false);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onDown);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onDown);
    };
  }, [open]);

  return (
    <span
      ref={root}
      className={clsx("relative inline-flex align-middle", className)}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
    >
      <button
        type="button"
        aria-label={label}
        aria-expanded={open}
        aria-describedby={open ? id : undefined}
        onClick={() => setPinned((p) => !p)}
        onBlur={(e) => {
          if (!root.current?.contains(e.relatedTarget as Node | null)) setPinned(false);
        }}
        className="focus-ring relative inline-flex size-5 items-center justify-center rounded-chip border border-line-strong bg-surface font-mono text-micro leading-none font-semibold text-ink-2 before:absolute before:-inset-3 before:content-[''] hover:bg-muted hover:text-ink"
      >
        <span aria-hidden>i</span>
      </button>
      {open && (
        <span
          id={id}
          role="tooltip"
          className={clsx(
            "absolute top-full z-30 mt-2 w-max max-w-[min(18rem,calc(100vw-2rem))] rounded-input border border-line bg-surface px-3 py-2 text-left text-small font-normal tracking-normal whitespace-normal text-ink shadow-sheet",
            align === "end" ? "right-0" : "left-0",
          )}
        >
          {children}
        </span>
      )}
    </span>
  );
}
