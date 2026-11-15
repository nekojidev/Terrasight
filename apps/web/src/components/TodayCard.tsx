"use client";

import {
  BigNumber,
  Button,
  Chip,
  Disclosure,
  DoneRow,
  FactorRows,
  Kicker,
  Menu,
  Surface,
  type DoneRowProps,
  type Factor,
} from "@terrasight/ui";
import { AlertTriangle, CalendarClock, Check, ChevronRight, Clock, MessageCircleQuestion } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { CSSProperties, ReactNode } from "react";

export interface TodayCardProps {
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
  /** Up to 3 key numbers, already formatted; unknown ones are left out by the caller. */
  numbers?: Array<{ value: string; label: string; weight: number }>;
  /** The trust line (reliability, data level, sources). */
  trust: ReactNode;
  /** "Start with this". */
  startLabel: string;
  moreLabel: string;
  labels: { accept: string; snooze: string; ask?: string; why: string; details: string };
  detailsHref: string;
  /** No handlers: the card is read-only (the Owner reads, the decisions are answered elsewhere). */
  onAccept?: () => void;
  onSnooze?: () => void;
  onAsk?: () => void;
  done?: Omit<DoneRowProps, "className">;
}

/**
 * The headline recommendation of the day: what, which field, by when, up to three key numbers, one reliability
 * line, exactly one primary action ("Accept"); Snooze and Details sit in the "⋯" menu beside the title.
 */
export function TodayCard(p: TodayCardProps) {
  const router = useRouter();
  if (p.done) return <DoneRow {...p.done} />;
  const menu = [
    ...(p.onSnooze ? [{ id: "snooze", label: p.labels.snooze, icon: <Clock />, onSelect: p.onSnooze }] : []),
    { id: "details", label: p.labels.details, icon: <ChevronRight />, onSelect: () => router.push(p.detailsHref) },
  ];
  return (
    <Surface as="article" tone="hero" pad="md" className="animate-rise sm:p-6">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <span className="flex flex-wrap items-center gap-2">
          <Chip tone="signal">{p.startLabel}</Chip>
          <Chip tone={p.urgent ? "urgent" : "neutral"} icon={p.urgent ? <AlertTriangle /> : <Clock />}>
            {p.due}
          </Chip>
        </span>
        <Link
          href={p.fieldHref}
          className="focus-ring flex min-h-tap min-w-0 items-center gap-2 rounded-chip text-small text-ink-2 hover:underline"
        >
          {p.thumb}
          <span className="truncate font-semibold text-ink">{p.fieldName}</span>
          {p.strip}
        </Link>
      </div>
      <div className="flex items-start justify-between gap-3">
        <h3 className="text-h2 text-ink">
          {p.title}
          {p.titleMark}
        </h3>
        <Menu label={p.moreLabel} items={menu} align="end" />
      </div>
      {p.action && <p className="mt-1 text-body text-ink-2">{p.action}</p>}
      {p.numbers && p.numbers.length > 0 && (
        <div className="mt-5 grid gap-4 sm:grid-cols-3">
          {p.numbers.slice(0, 3).map((n) => (
            <BigNumber key={n.label} value={n.value} label={n.label} weight={n.weight} />
          ))}
        </div>
      )}
      <div className="mt-4">{p.trust}</div>
      {/* In the card's own flow: it never sits on top of the title or the numbers (v6 defect 1). */}
      <div className="mt-4 flex flex-wrap items-center gap-3">
        {p.onAccept && (
          <Button size={56} icon={<Check />} onClick={p.onAccept} className="max-sm:flex-1">
            {p.labels.accept}
          </Button>
        )}
        {p.onAsk && p.labels.ask && (
          <Button size={56} variant="outline" icon={<MessageCircleQuestion />} onClick={p.onAsk} className="max-sm:flex-1">
            {p.labels.ask}
          </Button>
        )}
      </div>
      <Disclosure summary={p.labels.why} className="mt-3">
        <div className="mt-2 flex flex-col gap-4 rounded-input bg-surface-2 p-4">
          {p.whyText && <p className="text-body text-ink">{p.whyText}</p>}
          <FactorRows factors={p.factors} />
        </div>
      </Disclosure>
    </Surface>
  );
}

export interface TodayRowProps {
  urgent: boolean;
  /** Visible status word ("Urgent", "This week"); paired with an icon, never colour alone. */
  status: string;
  due: string;
  fieldName: string;
  title: string;
  titleMark?: ReactNode;
  /** One-line reason. */
  reason?: string;
  href: string;
  thumb?: ReactNode;
  /** Position in the list: drives the rise-in delay. */
  index: number;
  /** The row changed since the last refresh. */
  flash?: boolean;
  done?: Omit<DoneRowProps, "className">;
}

/** One row of the prioritised Today list: status (icon + word), field, one-line reason, when. */
export function TodayRow(p: TodayRowProps) {
  if (p.done) return <DoneRow {...p.done} />;
  const Icon = p.urgent ? AlertTriangle : CalendarClock;
  return (
    <Link
      href={p.href}
      style={{ "--i": p.index } as CSSProperties}
      className={`focus-ring stagger animate-rise flex min-h-tap items-center gap-3 rounded-card border border-line bg-surface p-4 hover:bg-surface-2 ${
        p.flash ? "animate-flash" : ""
      }`}
    >
      {p.thumb}
      <span className="min-w-0 flex-1">
        <Kicker as="span" className="flex items-center gap-1.5">
          <Icon aria-hidden className={`size-3.5 ${p.urgent ? "text-urgent" : "text-week"}`} strokeWidth={2} />
          {p.status}
        </Kicker>
        <span className="mt-0.5 block text-body font-semibold text-ink">
          {p.title}
          {p.titleMark}
        </span>
        <span className="block truncate text-caption text-ink-2">
          {p.fieldName}{p.reason ? ` · ${p.reason}` : ""}
        </span>
      </span>
      <span className="flex shrink-0 items-center gap-1 text-caption font-semibold whitespace-nowrap text-ink-2">
        {p.due}
        <ChevronRight aria-hidden className="size-4" strokeWidth={1.7} />
      </span>
    </Link>
  );
}
