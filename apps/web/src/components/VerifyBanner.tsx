"use client";

import { useQuery } from "@tanstack/react-query";
import { MailWarning, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";

const DISMISS_KEY = "ts_verify_dismissed_until";
const DISMISS_DAYS = 30;

function dismissedNow(): boolean {
  try {
    return Number(localStorage.getItem(DISMISS_KEY) ?? 0) > Date.now();
  } catch {
    return false;
  }
}

/**
 * "Verify your email" reminder in the app shell while the account's email is unverified. Compact and closable: a
 * dismissal is remembered on this device for 30 days (verification only gates accepting invitations).
 */
export function VerifyBanner() {
  const a = useTranslations("App");
  const me = useQuery({ queryKey: ["me"], queryFn: () => api<{ emailVerified?: boolean }>("/api/me") });
  const [state, setState] = useState<"idle" | "busy" | "sent">("idle");
  // Read after mount: localStorage is browser-only (no hydration mismatch).
  const [dismissed, setDismissed] = useState(true);
  useEffect(() => setDismissed(dismissedNow()), []);
  if (me.data?.emailVerified !== false || dismissed) return null;

  async function resend() {
    setState("busy");
    try {
      await api("/api/auth/resend-verification", { method: "POST" });
      setState("sent");
    } catch {
      setState("idle");
    }
  }
  function dismiss() {
    try {
      localStorage.setItem(DISMISS_KEY, String(Date.now() + DISMISS_DAYS * 864e5));
    } catch {
      /* storage blocked: hide for this page view only */
    }
    setDismissed(true);
  }

  return (
    <div role="status" className="flex items-center gap-2 rounded-input border border-line bg-week-soft px-3 py-2">
      <MailWarning aria-hidden className="size-4 shrink-0 text-week" strokeWidth={1.7} />
      <p className="min-w-0 flex-1 text-small text-ink">{state === "sent" ? a("verifyResent") : a("verifyBanner")}</p>
      {state !== "sent" && (
        <button
          type="button"
          onClick={() => void resend()}
          disabled={state === "busy"}
          className="focus-ring shrink-0 rounded-btn px-2 py-1 text-small font-semibold text-ink underline underline-offset-2"
        >
          {a("verifyResend")}
        </button>
      )}
      <button
        type="button"
        onClick={dismiss}
        aria-label={a("verifyDismiss")}
        className="focus-ring inline-flex size-8 shrink-0 items-center justify-center rounded-btn text-ink-2 hover:bg-muted"
      >
        <X aria-hidden className="size-4" strokeWidth={1.7} />
      </button>
    </div>
  );
}
