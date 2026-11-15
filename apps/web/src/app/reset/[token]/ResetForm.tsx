"use client";

import { Button } from "@terrasight/ui";
import { CheckCircle2, Link2Off } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useState, type FormEvent } from "react";
import { primaryLink, quietLink } from "@/components/AuthShell";
import { FormAlert } from "@/components/FormAlert";
import { PASSWORD_MIN, PasswordField } from "@/components/PasswordField";
import { api } from "@/lib/api";
import { authErrorKind, RATE_LIMIT_MINUTES } from "@/lib/auth-errors";

export function ResetForm({ token }: { token: string }) {
  const a = useTranslations("App");
  const t = useTranslations("Login");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [gone, setGone] = useState(false);
  const [passError, setPassError] = useState<string | undefined>();
  const [formError, setFormError] = useState<string | null>(null);

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const password = String(new FormData(e.currentTarget).get("password") ?? "");
    setFormError(null);
    if (password.length < PASSWORD_MIN) {
      setPassError(password ? t("errPassShort", { n: PASSWORD_MIN }) : t("errPassEmpty"));
      return;
    }
    setPassError(undefined);
    setBusy(true);
    try {
      await api(`/api/auth/reset/${encodeURIComponent(token)}`, { body: { password }, noRefresh: true });
      setDone(true);
    } catch (err) {
      const kind = authErrorKind(err);
      if (kind === "gone") setGone(true);
      else if (kind === "invalid") setPassError(t("errPassShort", { n: PASSWORD_MIN }));
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

  if (done)
    return (
      <div className="flex flex-col gap-5">
        <p role="status" className="flex items-start gap-3 text-body text-ink">
          <CheckCircle2 aria-hidden className="mt-0.5 size-5 shrink-0 text-ok" />
          <span>{a("resetDone")}</span>
        </p>
        <Link href="/login" className={primaryLink}>
          {a("signIn")}
        </Link>
      </div>
    );

  if (gone)
    return (
      <div role="alert" className="flex flex-col gap-4">
        <p className="flex items-start gap-3 text-h3 text-ink">
          <Link2Off aria-hidden className="mt-1 size-5 shrink-0 text-urgent" />
          <span>{t("linkGoneTitle")}</span>
        </p>
        <p className="text-body text-ink-2">{t("resetGoneBody")}</p>
        <p className="text-body text-ink-2">{t("resetGoneNext")}</p>
        <Link href="/forgot" className={primaryLink}>
          {t("resetRequest")}
        </Link>
        <Link href="/login" className={quietLink}>
          {t("backToSignIn")}
        </Link>
      </div>
    );

  return (
    <form onSubmit={(e) => void submit(e)} noValidate className="flex flex-col gap-5">
      {formError && <FormAlert>{formError}</FormAlert>}
      <PasswordField
        label={a("resetTitle")}
        name="password"
        autoComplete="new-password"
        required
        rules
        error={passError}
      />
      <Button type="submit" size={56} className="w-full justify-center" disabled={busy} aria-busy={busy}>
        {a("resetGo")}
      </Button>
    </form>
  );
}
