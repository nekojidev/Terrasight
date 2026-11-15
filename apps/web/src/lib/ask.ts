"use client";

import { usePathname, useRouter } from "next/navigation";
import { useCallback } from "react";
import { fieldIdFromPath } from "@/lib/palette";

export interface AskOptions {
  /** Field the question is about; defaults to the field on the current page. */
  fieldId?: string | null;
}

/**
 * URL of the assistant with a prepared question. Contract with the assistant page (unit 8):
 * `/assistant?ask=<question>&field=<fieldId>` fills the composer and does NOT send; the user presses Send.
 */
export function askHref(question: string, opts: AskOptions = {}): string {
  const params = new URLSearchParams({ ask: question });
  if (opts.fieldId) params.set("field", opts.fieldId);
  return `/assistant?${params}`;
}

/** `const openAsk = useOpenAsk(); openAsk("Why is the risk high?", { fieldId })` opens the assistant, question prefilled. */
export function useOpenAsk(): (question: string, opts?: AskOptions) => void {
  const router = useRouter();
  const path = usePathname();
  return useCallback(
    (question, opts = {}) => {
      const q = question.trim();
      if (!q) return;
      router.push(askHref(q, { fieldId: opts.fieldId === undefined ? fieldIdFromPath(path) : opts.fieldId }));
    },
    [router, path],
  );
}
