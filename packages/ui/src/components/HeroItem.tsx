"use client";

import { clsx } from "clsx";
import { Check, ShieldCheck } from "lucide-react";
import type { ReactNode } from "react";
import { BigNumber, type BigNumberProps } from "./BigNumber";
import { Button } from "./Button";
import { DoneRow, type DoneRowProps } from "./DoneRow";

export interface HeroItemProps {
  /** Lime "Start here" chip or urgency chip. */
  chip: ReactNode;
  /** Field badge: thumbnail, name, region, season strip. */
  field: ReactNode;
  title: string;
  numbers: BigNumberProps[];
  /** "High confidence · Full data". */
  confidence: string;
  /** Optional `InfoHint` explaining confidence, data tier and the key numbers. */
  confidenceHint?: ReactNode;
  labels: { accept: string; snooze: string; details: string };
  detailsHref: string;
  onAccept: () => void;
  onSnooze: () => void;
  /** Phone only (design 05): a "Why" factors block shown instead of the three big numbers. */
  why?: ReactNode;
  /** When set, the hero shows the done row with Undo instead of its actions. */
  done?: Omit<DoneRowProps, "className">;
  className?: string;
}

/** The first Urgent item at display size (design 04, RFC §10.5). One per screen. */
export function HeroItem(p: HeroItemProps) {
  return (
    <article className={clsx("animate-rise rounded-hero bg-surface p-5 shadow-hero sm:p-8", p.className)}>
      <header className="mb-4 flex flex-wrap sm:mb-6 items-start justify-between gap-4">
        {p.chip}
        {p.field}
      </header>
      <h2 className="text-h1 sm:text-display mb-5 max-w-[20ch] text-ink sm:mb-8">{p.title}</h2>
      {p.why && <div className="mb-5 rounded-input bg-surface-2 p-4 sm:hidden">{p.why}</div>}
      <div className={clsx("mb-8 grid grid-cols-1 gap-6 sm:grid-cols-3", p.why && "max-sm:hidden")}>
        {p.numbers.slice(0, 3).map((n) => (
          <BigNumber key={n.label} {...n} />
        ))}
      </div>
      {p.done ? (
        <DoneRow {...p.done} />
      ) : (
        <div className="flex flex-wrap items-center gap-3 max-sm:[&>button]:flex-1">
          <Button size={56} icon={<Check />} onClick={p.onAccept}>
            {p.labels.accept}
          </Button>
          <Button size={56} variant="outline" onClick={p.onSnooze}>
            {p.labels.snooze}
          </Button>
          <a
            href={p.detailsHref}
            className="focus-ring inline-flex min-h-tap items-center px-2 text-body font-semibold text-ink underline underline-offset-4"
          >
            {p.labels.details}
          </a>
        </div>
      )}
      <p className="mt-4 flex items-center justify-end gap-1.5 text-small text-ink-2">
        <ShieldCheck aria-hidden className="size-4 text-ok" strokeWidth={1.7} />
        {p.confidence}
        {p.confidenceHint}
      </p>
    </article>
  );
}
