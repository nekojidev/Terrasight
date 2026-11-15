"use client";

import { useQuery } from "@tanstack/react-query";
import { MailWarning } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { api } from "@/lib/api";

/** "Verify your email" banner in the app shell, shown while the signed-in account's email is unverified. */
export function VerifyBanner() {
  const a = useTranslations("App");
  const me = useQuery({ queryKey: ["me"], queryFn: () => api<{ emailVerified?: boolean }>("/api/me") });
  const [state, setState] = useState<"idle" | "busy" | "sent">("idle");
  if (me.data?.emailVerified !== false) return null;

  async function resend() {
    setState("busy");
    try {
      await api("/api/auth/resend-verification", { method: "POST" });
      setState("sent");
    } catch {
      setState("idle");
    }
  }

  return (
    <div role="status" className="flex flex-wrap items-center gap-3 rounded-card border border-line bg-week-soft p-4">
      <MailWarning aria-hidden className="size-5 shrink-0 text-week" strokeWidth={1.7} />
      <p className="min-w-0 flex-1 text-body text-ink">{state === "sent" ? a("verifyResent") : a("verifyBanner")}</p>
      {state !== "sent" && (
        <button
          type="button"
          onClick={() => void resend()}
          disabled={state === "busy"}
          className="focus-ring min-h-tap rounded-btn border border-line-strong px-4 text-body font-semibold text-ink"
        >
          {a("verifyResend")}
        </button>
      )}
    </div>
  );
}
