"use client";

import { clsx } from "clsx";
import { Check, Clock } from "lucide-react";
import { useId, useState, type ReactNode } from "react";
import { Button } from "./Button";
import { DoneRow, type DoneRowProps } from "./DoneRow";
import { FactorRows, type Factor } from "./FactorRows";

export interface QueueRowProps {
  thumb: ReactNode;
  title: string;
  /** "Pivot 14 · Kansas · Finney County". */
  meta: string;
  /** Deadline text in the urgency colour, e.g. "this week". */
  due: string;
  dueTone?: "urgent" | "week" | "ok";
  strip?: ReactNode;
  factors: Factor[];
  labels: { why: string; accept: string; snooze: string };
  onAccept: () => void;
  onSnooze: () => void;
  done?: Omit<DoneRowProps, "className">;
  /** "Snoozed until tomorrow 06:00" after the Undo window closes. */
  snoozedLabel?: string;
  className?: string;
}

const DUE: Record<NonNullable<QueueRowProps["dueTone"]>, string> = {
  urgent: "text-urgent",
  week: "text-week",
  ok: "text-ok",
};

/** Compact row in "Next, this week": collapsed / Why expanded / done / snoozed (design/README §3). */
export function QueueRow(p: QueueRowProps) {
  const [open, setOpen] = useState(false);
  const whyId = useId();
  if (p.done) return <DoneRow {...p.done} className={p.className} />;
  return (
    <article className={clsx("rounded-card border border-line bg-surface p-4", p.className)}>
      <div className="flex items-center gap-4">
        {p.thumb}
        <div className="min-w-0 flex-1">
          <h3 className="text-[18px] leading-6 font-semibold text-ink">{p.title}</h3>
          <p className="flex flex-wrap items-center gap-x-2 text-small text-ink-2">
            <span>{p.meta}</span>
            <span className={clsx("font-semibold", DUE[p.dueTone ?? "week"])}>{p.due}</span>
            {p.strip}
          </p>
          {p.snoozedLabel && <p className="text-small text-ink-3">{p.snoozedLabel}</p>}
        </div>
        <Button variant="ghost" aria-expanded={open} aria-controls={whyId} onClick={() => setOpen((v) => !v)}>
          {p.labels.why}
        </Button>
        <Button variant="icon" label={p.labels.accept} icon={<Check />} onClick={p.onAccept} />
        <Button variant="icon" label={p.labels.snooze} icon={<Clock />} onClick={p.onSnooze} />
      </div>
      <div id={whyId} hidden={!open} className="mt-4 rounded-input bg-surface-2 p-4">
        <FactorRows factors={p.factors} />
      </div>
    </article>
  );
}
