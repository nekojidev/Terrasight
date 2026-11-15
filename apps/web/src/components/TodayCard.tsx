"use client";

import { Button, Chip, DoneRow, FactorRows, type DoneRowProps, type Factor } from "@terrasight/ui";
import { Check, ChevronDown, Clock, MessageCircleQuestion } from "lucide-react";
import Link from "next/link";
import { useId, useState, type ReactNode } from "react";

export interface TodayCardProps {
  /** The first card of the day: larger, with a sticky action bar on a phone. */
  primary?: boolean;
  urgent: boolean;
  /** "in 6 days", "today", "by 21 November". */
  due: string;
  fieldHref: string;
  thumb: ReactNode;
  fieldName: string;
  strip?: ReactNode;
  title: string;
  titleMark?: ReactNode;
  /** What to do, one plain sentence. */
  action: string;
  whyText: string;
  factors: Factor[];
  confidence: string;
  confidenceHint?: ReactNode;
  labels: { accept: string; snooze: string; ask?: string; why: string; details: string };
  detailsHref: string;
  /** No handlers: the card is read-only (the Owner reads, the decisions are answered elsewhere). */
  onAccept?: () => void;
  onSnooze?: () => void;
  onAsk?: () => void;
  done?: Omit<DoneRowProps, "className">;
}

/** One card of the "Today" list: what, which field, by when, one primary action and a "Why?" expander. */
export function TodayCard(p: TodayCardProps) {
  const [open, setOpen] = useState(false);
  const whyId = useId();
  if (p.done) return <DoneRow {...p.done} />;
  const size = p.primary ? 56 : 44;
  return (
    <article
      className={
        p.primary
          ? "animate-rise rounded-hero bg-surface p-5 shadow-hero sm:p-6"
          : "rounded-card border border-line bg-surface p-4 sm:p-5"
      }
    >
      <div className="mb-3 flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <Chip tone={p.urgent ? "signal" : "neutral"} icon={<Clock />}>
          {p.due}
        </Chip>
        <Link
          href={p.fieldHref}
          className="focus-ring flex min-w-0 items-center gap-2 rounded-chip text-small text-ink-2 hover:underline"
        >
          {p.thumb}
          <span className="truncate font-semibold text-ink">{p.fieldName}</span>
          {p.strip}
        </Link>
      </div>
      <h3 className={p.primary ? "text-h2 text-ink" : "text-[18px] leading-6 font-semibold text-ink"}>
        {p.title}
        {p.titleMark}
      </h3>
      {p.action && <p className="mt-1 text-body text-ink-2">{p.action}</p>}
      <div
        className={
          p.primary
            ? "mt-4 flex flex-wrap items-center gap-3 max-sm:sticky max-sm:bottom-[88px] max-sm:z-10 max-sm:-mx-2 max-sm:rounded-card max-sm:bg-surface max-sm:p-2 max-sm:shadow-hero max-sm:[&>button]:flex-1"
            : "mt-3 flex flex-wrap items-center gap-2"
        }
      >
        {p.onAccept && (
          <Button size={size} icon={<Check />} onClick={p.onAccept}>
            {p.labels.accept}
          </Button>
        )}
        {p.onAsk && p.labels.ask && (
          <Button size={size} variant="outline" icon={<MessageCircleQuestion />} onClick={p.onAsk}>
            {p.labels.ask}
          </Button>
        )}
        {p.onSnooze && (
          <Button size={size} variant="outline" onClick={p.onSnooze}>
            {p.labels.snooze}
          </Button>
        )}
        {!p.onAccept && (
          <Link
            href={p.detailsHref}
            className="focus-ring inline-flex min-h-tap items-center rounded-btn border border-line-strong px-4 text-body font-semibold text-ink hover:bg-surface-2"
          >
            {p.labels.details}
          </Link>
        )}
        <button
          type="button"
          aria-expanded={open}
          aria-controls={whyId}
          onClick={() => setOpen((v) => !v)}
          className="focus-ring inline-flex min-h-tap items-center gap-1 rounded-btn px-2 text-body font-semibold text-ink underline underline-offset-4 max-sm:flex-none"
        >
          {p.labels.why}
          <ChevronDown aria-hidden className={`size-4 transition-transform ${open ? "rotate-180" : ""}`} />
        </button>
      </div>
      <div id={whyId} hidden={!open} className="mt-4 flex flex-col gap-4 rounded-input bg-surface-2 p-4">
        {p.whyText && <p className="text-body text-ink">{p.whyText}</p>}
        <FactorRows factors={p.factors} />
        <p className="flex flex-wrap items-center gap-1.5 text-small text-ink-2">
          {p.confidence}
          {p.confidenceHint}
          {p.onAccept && (
            <Link href={p.detailsHref} className="focus-ring ml-auto font-semibold text-ink underline">
              {p.labels.details}
            </Link>
          )}
        </p>
      </div>
    </article>
  );
}
