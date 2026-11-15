"use client";

import { useTranslations } from "next-intl";

/** Placeholder while a map chunk loads (the maps are client-only, next/dynamic with ssr: false). */
export function MapSkeleton({ className = "h-[46dvh] min-h-64" }: { className?: string }) {
  const t = useTranslations("App");
  return (
    <div
      role="status"
      aria-busy="true"
      aria-label={t("mapLoading")}
      className={`w-full motion-safe:animate-pulse rounded-hero border border-line bg-muted ${className}`}
    />
  );
}
