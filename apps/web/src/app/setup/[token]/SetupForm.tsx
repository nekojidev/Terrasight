"use client";

import { Button, TextField } from "@terrasight/ui";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState, type FormEvent } from "react";
import { api, ApiError } from "@/lib/api";

export function SetupForm({ token }: { token: string }) {
  const a = useTranslations("App");
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    setBusy(true);
    setError(null);
    try {
      await api(`/api/auth/setup/${encodeURIComponent(token)}`, {
        body: { password: form.get("password") },
        noRefresh: true,
      });
      router.replace("/");
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err : null);
      setBusy(false);
    }
  }

  const message =
    error?.code === "setup-link-invalid"
      ? a("setupInvalid")
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
        label={a("setupTitle")}
        name="password"
        type="password"
        autoComplete="new-password"
        required
        minLength={10}
        hint={a("passHint")}
        error={error?.field("password")}
      />
      <Button type="submit" size={56} className="w-full justify-center" disabled={busy} aria-busy={busy}>
        {a("setupGo")}
      </Button>
    </form>
  );
}
