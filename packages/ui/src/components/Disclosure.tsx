"use client";

import { clsx } from "clsx";
import { ChevronDown } from "lucide-react";
import { useId, useState, type ReactNode } from "react";

export interface DisclosureProps {
  summary: ReactNode;
  children: ReactNode;
  defaultOpen?: boolean;
  className?: string;
}

/** Expand/collapse section: aria-expanded button, rotating chevron, height animates via grid rows. */
export function Disclosure({ summary, children, defaultOpen = false, className }: DisclosureProps) {
  const [open, setOpen] = useState(defaultOpen);
  const id = useId();
  return (
    <div className={className}>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((o) => !o)}
        className="focus-ring flex min-h-tap w-full items-center justify-between gap-3 rounded-btn text-left text-body font-semibold text-ink"
      >
        <span className="min-w-0 flex-1">{summary}</span>
        <ChevronDown
          aria-hidden
          strokeWidth={1.7}
          className={clsx("size-5 shrink-0 transition-transform duration-base ease-ts", open && "rotate-180")}
        />
      </button>
      <div
        id={id}
        role="region"
        aria-hidden={!open}
        className={clsx(
          "grid transition-[grid-template-rows] duration-base ease-ts",
          open ? "grid-rows-[1fr]" : "grid-rows-[0fr] invisible",
        )}
      >
        <div className="overflow-hidden">{children}</div>
      </div>
    </div>
  );
}
