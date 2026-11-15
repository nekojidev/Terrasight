"use client";

import { useToast } from "@terrasight/ui";
import { useTranslations } from "next-intl";
import { useCallback } from "react";

/**
 * One way to report a failed action: an error toast "<what>: <reason>" that stays until dismissed, with Retry when the
 * caller can repeat the action. The reason is the error's message (the server's problem detail for an ApiError).
 */
export function useActionToast() {
  const toast = useToast();
  const t = useTranslations("App");
  const fail = useCallback(
    (error: unknown, what: string, retry?: () => void) => {
      const reason = (error instanceof Error && error.message) || t("actionFailedUnknown");
      toast.show(
        t("actionFailed", { what, reason }),
        "error",
        retry ? { action: { label: t("retry"), onClick: retry } } : undefined,
      );
    },
    [toast, t],
  );
  return { fail };
}
