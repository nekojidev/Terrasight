"use client";

import { useToast } from "@terrasight/ui";
import { useTranslations } from "next-intl";
import { useCallback } from "react";
import { ApiError } from "@/lib/api";

/** Maps a failed action to short, localised copy. */
export function useErrorText(): (e: unknown) => string {
  const t = useTranslations("App");
  return useCallback(
    (e: unknown) => {
      if (e instanceof ApiError) {
        if (e.code === "rate-limited") return t("errRateLimited");
        if (e.code === "invalid-input") return t("errInvalid");
        if (e.problem.status === 403) return t("errForbidden");
        return t("errGeneric");
      }
      return e instanceof TypeError ? t("errNetwork") : t("errGeneric");
    },
    [t],
  );
}

/** Returns `report(e)`: shows the failure as a toast. Use as a `catch` handler or a mutation `onError`. */
export function useReportError(): (e: unknown) => void {
  const toast = useToast();
  const text = useErrorText();
  return useCallback((e: unknown) => toast.show(text(e)), [toast, text]);
}
