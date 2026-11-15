"use client";

import { Button, TextField } from "@terrasight/ui";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useState, type FormEvent } from "react";
import { api, ApiError } from "@/lib/api";

export function ForgotForm() {
  const a = useTranslations("App");
  const t = useTranslations("Login");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    setBusy(true);
    setError(null);
    try {
      await api("/api/auth/forgot", { body: { email: form.get("email") }, noRefresh: true });
      setSent(true);
    } catch (err) {
      setError(err instanceof ApiError ? err : null);
    }
    setBusy(false);
  }

  const message =
    error?.code === "rate-limited"
      ? a("errRateLimited")
      : error?.code === "invalid-input"
        ? a("errInvalid")
        : error
          ? a("errGeneric")
          : null;

  return (
    <form onSubmit={(e) => void submit(e)} noValidate className="flex flex-col gap-5">
      {sent && (
        <p role="status" className="rounded-input bg-week-soft px-4 py-3 text-body text-ink">
          {a("forgotSent")}
        </p>
      )}
      {message && (
        <p role="alert" className="rounded-input bg-urgent-soft px-4 py-3 text-body text-urgent">
          {message}
        </p>
      )}
      <TextField
        label={t("email")}
        name="email"
        type="email"
        autoComplete="email"
        required
        error={error?.field("email")}
      />
      <Button type="submit" size={56} className="w-full justify-center" disabled={busy} aria-busy={busy}>
        {a("forgotGo")}
      </Button>
      <Link href="/login" className="focus-ring text-center text-body font-semibold text-ink-2">
        {a("backToSignIn")}
      </Link>
    </form>
  );
}
