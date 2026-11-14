"use client";

import { clsx } from "clsx";
import { AlertTriangle, ArrowRight, RotateCw } from "lucide-react";
import type { ReactNode } from "react";
import { Button } from "./Button";
import { Chip } from "./Chip";

/** Loading skeleton that keeps the card's shape, so the page doesn't jump (design 17). */
export function Skeleton({ label, className }: { label: string; className?: string }) {
  return (
    <div
      role="status"
      aria-label={label}
      aria-busy="true"
      className={clsx("rounded-card border border-line bg-surface p-5", className)}
    >
      <div className="mb-4 flex gap-3">
        <span className="block size-14 rounded-btn bg-muted" />
        <span className="flex flex-1 flex-col gap-2">
          <span className="block h-3 w-1/2 rounded-chip bg-muted" />
          <span className="block h-3 w-4/5 rounded-chip bg-muted" />
          <span className="block h-3 w-1/3 rounded-chip bg-muted" />
        </span>
      </div>
      <span className="mb-3 block h-14 rounded-btn bg-muted" />
      <span className="block h-10 w-1/2 rounded-btn bg-muted" />
    </div>
  );
}

/** Source error: what failed, what is shown instead, and Retry (design 17, RFC §10.2). */
export function ErrorCard({
  title,
  body,
  stamp,
  retryLabel,
  onRetry,
  className,
}: {
  title: string;
  body: string;
  stamp?: string;
  retryLabel: string;
  onRetry: () => void;
  className?: string;
}) {
  return (
    <div role="alert" className={clsx("rounded-card border border-line bg-surface p-5", className)}>
      <div className="mb-3 flex gap-3">
        <span
          aria-hidden
          className="inline-flex size-9 shrink-0 items-center justify-center rounded-btn bg-week-soft text-week"
        >
          <AlertTriangle className="size-5" strokeWidth={1.7} />
        </span>
        <div>
          <p className="text-[18px] leading-6 font-semibold text-ink">{title}</p>
          <p className="text-body text-ink-2">{body}</p>
        </div>
      </div>
      {stamp && (
        <Chip tone="source" className="mb-3 w-full rounded-btn">
          {stamp}
        </Chip>
      )}
      <Button size={48} icon={<RotateCw />} className="w-full justify-center" onClick={onRetry}>
        {retryLabel}
      </Button>
    </div>
  );
}

/** Empty state with one action (design 17, 03). */
export function EmptyState({
  text,
  actionLabel,
  onAction,
  icon,
  className,
}: {
  text: string;
  actionLabel: string;
  onAction: () => void;
  icon?: ReactNode;
  className?: string;
}) {
  return (
    <div className={clsx("rounded-card border border-line bg-surface p-5", className)}>
      <p className="mb-4 text-body text-ink-2">{text}</p>
      <Button
        variant="outline"
        size={48}
        icon={icon ?? <ArrowRight />}
        className="w-full justify-center"
        onClick={onAction}
      >
        {actionLabel}
      </Button>
    </div>
  );
}
