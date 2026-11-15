"use client";

import { Button, TextField } from "@terrasight/ui";
import { CheckCircle2 } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useState, type FormEvent } from "react";
import { quietLink } from "@/components/AuthShell";
import { FormAlert } from "@/components/FormAlert";
import { api } from "@/lib/api";
import { authErrorKind, isEmail, RATE_LIMIT_MINUTES } from "@/lib/auth-errors";

export function ForgotForm() {
  const a = useTranslations("App");
  const t = useTranslations("Login");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [emailError, setEmailError] = useState<string | undefined>();
  const [formError, setFormError] = useState<string | null>(null);

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const email = String(new FormData(e.currentTarget).get("email") ?? "");
    setFormError(null);
    setSent(false);
    if (!email.trim() || !isEmail(email)) {
      setEmailError(email.trim() ? t("errEmailFormat") : t("errEmailEmpty"));
      return;
    }
    setEmailError(undefined);
    setBusy(true);
    try {
      await api("/api/auth/forgot", { body: { email }, noRefresh: true });
      setSent(true);
    } catch (err) {
      const kind = authErrorKind(err);
      if (kind === "invalid") setEmailError(t("errEmailFormat"));
      else
        setFormError(
          kind === "rate"
            ? t("errRate", { n: RATE_LIMIT_MINUTES })
            : kind === "net"
              ? t("errNet")
              : t("errServer"),
        );
    }
    setBusy(false);
  }

  return (
    <form onSubmit={(e) => void submit(e)} noValidate className="flex flex-col gap-5">
      {sent && (
        <p
          role="status"
          className="flex items-start gap-3 rounded-input bg-week-soft px-4 py-3 text-body text-ink"
        >
          <CheckCircle2 aria-hidden className="mt-0.5 size-5 shrink-0" />
          <span>{a("forgotSent")}</span>
        </p>
      )}
      {formError && <FormAlert>{formError}</FormAlert>}
      <TextField
        label={t("email")}
        name="email"
        type="email"
        inputMode="email"
        autoComplete="email"
        required
        error={emailError}
      />
      <Button type="submit" size={56} className="w-full justify-center" disabled={busy} aria-busy={busy}>
        {a("forgotGo")}
      </Button>
      <Link href="/login" className={quietLink}>
        {t("backToSignIn")}
      </Link>
    </form>
  );
}
