"use client";

import { clsx } from "clsx";
import { ChevronDown } from "lucide-react";
import { useId, useState, type ReactNode } from "react";

export interface DisclosureProps {
  summary: ReactNode;
  children: ReactNode;
  defaultOpen?: boolean;
  className?: string;
  /** Quiet text after the title, visible only while closed (e.g. "3 checks · 2 sources"). */
  summaryNote?: string;
  /** Controlled mode: pass `open` and `onOpenChange` together. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** Id of the collapsible region (an anchor target for links). */
  id?: string;
}

/** Expand/collapse section: aria-expanded button, rotating chevron, height animates via grid rows. */
export function Disclosure({
  summary,
  children,
  defaultOpen = false,
  className,
  summaryNote,
  open: openProp,
  onOpenChange,
  id: idProp,
}: DisclosureProps) {
  const [inner, setInner] = useState(defaultOpen);
  const generated = useId();
  const id = idProp ?? generated;
  const open = openProp ?? inner;
  const toggle = () => {
    const next = !open;
    if (openProp === undefined) setInner(next);
    onOpenChange?.(next);
  };
  return (
    <div className={className}>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={id}
        onClick={toggle}
        className="focus-ring flex min-h-tap w-full items-center justify-between gap-3 rounded-btn text-left text-body font-semibold text-ink"
      >
        <span className="min-w-0 flex-1">
          {summary}
          {summaryNote && !open && (
            <span className="ml-2 text-small font-normal text-ink-3">{summaryNote}</span>
          )}
        </span>
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
