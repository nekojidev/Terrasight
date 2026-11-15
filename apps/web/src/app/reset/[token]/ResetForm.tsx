"use client";

import { Button, TextField } from "@terrasight/ui";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useState, type FormEvent } from "react";
import { api, ApiError } from "@/lib/api";

export function ResetForm({ token }: { token: string }) {
  const a = useTranslations("App");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    setBusy(true);
    setError(null);
    try {
      await api(`/api/auth/reset/${encodeURIComponent(token)}`, {
        body: { password: form.get("password") },
        noRefresh: true,
      });
      setDone(true);
    } catch (err) {
      setError(err instanceof ApiError ? err : null);
    }
    setBusy(false);
  }

  if (done)
    return (
      <div className="flex flex-col gap-5">
        <p role="status" className="text-body text-ink">
          {a("resetDone")}
        </p>
        <Link
          href="/login"
          className="focus-ring inline-flex min-h-14 items-center justify-center rounded-btn bg-ink px-6 text-body font-semibold text-surface"
        >
          {a("signIn")}
        </Link>
      </div>
    );

  const message =
    error?.code === "reset-link-invalid"
      ? a("resetInvalid")
      : error?.code === "rate-limited"
        ? a("errRateLimited")
        : error?.code === "invalid-input"
          ? a("errInvalid")
          : error
            ? a("errGeneric")
            : null;

  return (
    <form onSubmit={(e) => void submit(e)} noValidate className="flex flex-col gap-5">
      {message && (
        <p role="alert" className="rounded-input bg-urgent-soft px-4 py-3 text-body text-urgent">
          {message}
        </p>
      )}
      <TextField
        label={a("resetTitle")}
        name="password"
        type="password"
        autoComplete="new-password"
        required
        minLength={10}
        hint={a("passHint")}
        error={error?.field("password")}
      />
      <Button type="submit" size={56} className="w-full justify-center" disabled={busy} aria-busy={busy}>
        {a("resetGo")}
      </Button>
      {error?.code === "reset-link-invalid" && (
        <Link href="/forgot" className="focus-ring text-center text-body font-semibold text-ink-2">
          {a("forgotLink")}
        </Link>
      )}
    </form>
  );
}
