"use client";

import { EmptyState, ErrorCard, Skeleton } from "@terrasight/ui";
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
}: {
  query: QueryLike<T>;
  children: (data: T) => ReactNode;
  /** Custom loading placeholder; defaults to the card skeleton. */
  skeleton?: ReactNode;
  isEmpty?: (data: T) => boolean;
  empty?: { text: string; actionLabel: string; onAction: () => void };
  silent?: boolean;
  className?: string;
}) {
  const t = useTranslations("App");
  if (query.data !== undefined) {
    if (empty && isEmpty?.(query.data))
      return (
        <EmptyState
          text={empty.text}
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
        title={t("qsErrTitle")}
        body={t("qsErrBody")}
        retryLabel={t("retry")}
        onRetry={() => void query.refetch()}
        {...(className ? { className } : {})}
      />
    );
  return skeleton ? <>{skeleton}</> : <Skeleton label={t("loading")} className={className ?? "w-full"} />;
}
