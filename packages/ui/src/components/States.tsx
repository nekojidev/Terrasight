"use client";

import { clsx } from "clsx";
import { AlertTriangle, ArrowRight, RotateCw } from "lucide-react";
import type { ReactNode } from "react";
import { Button } from "./Button";
import { Chip } from "./Chip";

export type SkeletonVariant = "card" | "rows" | "map" | "number" | "text";

const BLOCK = "motion-safe:animate-shimmer";

/** Loading skeleton that keeps the shape of what is loading, so the page doesn't jump (design 17). */
export function Skeleton({
  label,
  className,
  variant = "card",
  rows = 3,
}: {
  label: string;
  className?: string;
  variant?: SkeletonVariant;
  /** Row count for `rows` and line count for `text`. */
  rows?: number;
}) {
  const shell = { role: "status", "aria-label": label, "aria-busy": true } as const;
  if (variant === "map")
    return (
      <div
        {...shell}
        className={clsx("h-[46dvh] min-h-64 w-full rounded-hero border border-line bg-muted", BLOCK, className)}
      />
    );
  if (variant === "number")
    return (
      <div {...shell} className={clsx("flex flex-col gap-2", className)}>
        <span className={clsx("block h-10 w-24 rounded-btn bg-muted", BLOCK)} />
        <span className={clsx("block h-3 w-32 rounded-chip bg-muted", BLOCK)} />
      </div>
    );
  if (variant === "text")
    return (
      <div {...shell} className={clsx("flex flex-col gap-2", className)}>
        {Array.from({ length: rows }, (_, i) => (
          <span
            key={i}
            className={clsx("block h-3 rounded-chip bg-muted", BLOCK, i === rows - 1 && rows > 1 ? "w-2/3" : "w-full")}
          />
        ))}
      </div>
    );
  if (variant === "rows")
    return (
      <div {...shell} className={clsx("flex flex-col gap-3", className)}>
        {Array.from({ length: rows }, (_, i) => (
          <div key={i} className="flex items-center gap-3 rounded-card border border-line bg-surface p-4">
            <span className={clsx("block size-11 shrink-0 rounded-btn bg-muted", BLOCK)} />
            <span className="flex flex-1 flex-col gap-2">
              <span className={clsx("block h-3 w-1/2 rounded-chip bg-muted", BLOCK)} />
              <span className={clsx("block h-3 w-3/4 rounded-chip bg-muted", BLOCK)} />
            </span>
          </div>
        ))}
      </div>
    );
  return (
    <div {...shell} className={clsx("rounded-card border border-line bg-surface p-5", className)}>
      <div className="mb-4 flex gap-3">
        <span className={clsx("block size-14 rounded-btn bg-muted", BLOCK)} />
        <span className="flex flex-1 flex-col gap-2">
          <span className={clsx("block h-3 w-1/2 rounded-chip bg-muted", BLOCK)} />
          <span className={clsx("block h-3 w-4/5 rounded-chip bg-muted", BLOCK)} />
          <span className={clsx("block h-3 w-1/3 rounded-chip bg-muted", BLOCK)} />
        </span>
      </div>
      <span className={clsx("mb-3 block h-14 rounded-btn bg-muted", BLOCK)} />
      <span className={clsx("block h-10 w-1/2 rounded-btn bg-muted", BLOCK)} />
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
