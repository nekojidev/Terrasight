"use client";

import { clsx } from "clsx";
import { useId, useRef, type KeyboardEvent } from "react";

export interface TabItem {
  id: string;
  label: string;
  count?: number;
}

export interface TabsProps {
  items: TabItem[];
  value: string;
  onChange: (id: string) => void;
  /** Accessible name of the tab list. */
  label: string;
  className?: string;
}

/** ARIA tabs: roving tabindex, Arrow/Home/End keys. The caller renders the panel (give it role="tabpanel"). */
export function Tabs({ items, value, onChange, label, className }: TabsProps) {
  const base = useId();
  const refs = useRef<Array<HTMLButtonElement | null>>([]);
  const current = Math.max(
    0,
    items.findIndex((i) => i.id === value),
  );

  const move = (to: number) => {
    const n = items.length;
    const idx = ((to % n) + n) % n;
    const item = items[idx];
    if (!item) return;
    onChange(item.id);
    refs.current[idx]?.focus();
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === "ArrowRight") move(current + 1);
    else if (e.key === "ArrowLeft") move(current - 1);
    else if (e.key === "Home") move(0);
    else if (e.key === "End") move(items.length - 1);
    else return;
    e.preventDefault();
  };

  return (
    <div
      role="tablist"
      aria-label={label}
      onKeyDown={onKey}
      className={clsx("flex gap-1 overflow-x-auto border-b border-line [scrollbar-width:none]", className)}
    >
      {items.map((it, i) => {
        const selected = i === current;
        return (
          <button
            key={it.id}
            ref={(el) => {
              refs.current[i] = el;
            }}
            type="button"
            role="tab"
            id={`${base}-${it.id}`}
            aria-selected={selected}
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(it.id)}
            className={clsx(
              "focus-ring -mb-px inline-flex min-h-tap shrink-0 items-center gap-2 border-b-2 px-4 text-body font-semibold whitespace-nowrap",
              "transition-colors duration-instant ease-ts",
              selected ? "border-ink text-ink" : "border-transparent text-ink-2 hover:text-ink",
            )}
          >
            {it.label}
            {it.count !== undefined && (
              <span className="rounded-chip bg-muted px-2 text-small text-ink-2">{it.count}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}
