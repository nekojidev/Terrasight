"use client";

import { EmptyState, ErrorCard, Skeleton, type SkeletonVariant } from "@terrasight/ui";
import { useTranslations } from "next-intl";
import type { ReactNode } from "react";

/** The slice of a TanStack query that QueryState needs. */
interface QueryLike<T> {
  data: T | undefined;
  isError: boolean;
  refetch: () => unknown;
}

/**
 * One place for the three states of a query: loading skeleton, error card with Retry, empty.
 * `silent` renders nothing while loading or failing (badges, one-line hints).
 * Data that is already on screen stays on screen when a background refetch fails.
 */
export function QueryState<T>({
  query,
  children,
  skeleton,
  isEmpty,
  empty,
  silent = false,
  className,
  skeletonVariant,
  what,
  still,
}: {
  query: QueryLike<T>;
  children: (data: T) => ReactNode;
  /** Custom loading placeholder; defaults to the card skeleton. */
  skeleton?: ReactNode;
  isEmpty?: (data: T) => boolean;
  empty?: { text: string; still?: string; actionLabel: string; onAction: () => void };
  /** What the user still sees while the query failed ("Showing the last check from 06:00"). */
  still?: string;
  silent?: boolean;
  className?: string;
  /** Shape of the default loading placeholder (card by default). */
  skeletonVariant?: SkeletonVariant;
  /** Short name of what failed ("Fields"); shown in the error title when given. */
  what?: string;
}) {
  const t = useTranslations("App");
  if (query.data !== undefined) {
    if (empty && isEmpty?.(query.data))
      return (
        <EmptyState
          text={empty.text}
          {...(empty.still ? { still: empty.still } : {})}
          actionLabel={empty.actionLabel}
          onAction={empty.onAction}
          {...(className ? { className } : {})}
        />
      );
    return <>{children(query.data)}</>;
  }
  if (silent) return null;
  if (query.isError)
    return (
      <ErrorCard
        title={what ? t("qsErrWhat", { what }) : t("qsErrTitle")}
        body={t("qsErrBody")}
        {...(still ? { still } : {})}
        retryLabel={t("retry")}
        onRetry={() => void query.refetch()}
        {...(className ? { className } : {})}
      />
    );
  return skeleton ? <>{skeleton}</> : (
    <Skeleton
      label={t("loading")}
      className={className ?? "w-full"}
      {...(skeletonVariant ? { variant: skeletonVariant } : {})}
    />
  );
}
