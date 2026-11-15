"use client";

import { clsx } from "clsx";
import { MoreHorizontal } from "lucide-react";
import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";

export interface MenuItem {
  id: string;
  label: string;
  icon?: ReactNode;
  danger?: boolean;
  onSelect: () => void;
}

export interface MenuProps {
  /** Accessible name of the trigger button ("More actions"). */
  label: string;
  items: MenuItem[];
  align?: "start" | "end";
  className?: string;
}

/** "⋯" overflow menu: role=menu popover, arrow keys, Esc closes and returns focus, outside click closes. */
export function Menu({ label, items, align = "end", className }: MenuProps) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLSpanElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const refs = useRef<Array<HTMLButtonElement | null>>([]);
  const menuId = useId();

  useEffect(() => {
    if (!open) return;
    refs.current[0]?.focus();
    const onDown = (e: Event) => {
      if (root.current && !root.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [open]);

  const close = (refocus: boolean) => {
    setOpen(false);
    if (refocus) trigger.current?.focus();
  };
  const focusAt = (i: number) => {
    const n = items.length;
    refs.current[((i % n) + n) % n]?.focus();
  };
  const onMenuKey = (e: KeyboardEvent) => {
    const at = refs.current.findIndex((r) => r === document.activeElement);
    if (e.key === "ArrowDown") focusAt(at + 1);
    else if (e.key === "ArrowUp") focusAt(at - 1);
    else if (e.key === "Home") focusAt(0);
    else if (e.key === "End") focusAt(items.length - 1);
    else if (e.key === "Escape") close(true);
    else if (e.key === "Tab") {
      close(false);
      return;
    } else return;
    e.preventDefault();
  };

  return (
    <span ref={root} className={clsx("relative inline-flex", className)}>
      <button
        ref={trigger}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-label={label}
        title={label}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown" && !open) {
            e.preventDefault();
            setOpen(true);
          }
        }}
        className="focus-ring inline-flex size-11 items-center justify-center rounded-btn border border-line-control bg-surface text-ink transition-colors duration-instant hover:bg-surface-2"
      >
        <MoreHorizontal aria-hidden className="size-5" strokeWidth={1.7} />
      </button>
      {open && (
        <div
          id={menuId}
          role="menu"
          aria-label={label}
          onKeyDown={onMenuKey}
          className={clsx(
            "animate-pop absolute top-full z-40 mt-2 min-w-48 rounded-input border border-line bg-surface p-1 shadow-hero",
            align === "end" ? "right-0 origin-top-right" : "left-0 origin-top-left",
          )}
        >
          {items.map((it, i) => (
            <button
              key={it.id}
              ref={(el) => {
                refs.current[i] = el;
              }}
              type="button"
              role="menuitem"
              tabIndex={-1}
              onClick={() => {
                close(true);
                it.onSelect();
              }}
              className={clsx(
                "focus-ring flex min-h-tap w-full items-center gap-3 rounded-btn px-3 text-left text-body hover:bg-muted focus-visible:bg-muted",
                it.danger ? "text-urgent" : "text-ink",
              )}
            >
              {it.icon && (
                <span aria-hidden className="inline-flex [&>svg]:size-5 [&>svg]:stroke-[1.7]">
                  {it.icon}
                </span>
              )}
              {it.label}
            </button>
          ))}
        </div>
      )}
    </span>
  );
}
