"use client";

import { Button } from "@terrasight/ui";
import { Link2Off } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState, type FormEvent } from "react";
import { primaryLink } from "@/components/AuthShell";
import { FormAlert } from "@/components/FormAlert";
import { PASSWORD_MIN, PasswordField } from "@/components/PasswordField";
import { api } from "@/lib/api";
import { authErrorKind, RATE_LIMIT_MINUTES } from "@/lib/auth-errors";

/** Shown when the link was used or has expired: what happened and what to do next. */
export function SetupGone() {
  const t = useTranslations("Login");
  const a = useTranslations("App");
  return (
    <div role="alert" className="flex flex-col gap-4">
      <p className="flex items-start gap-3 text-h3 text-ink">
        <Link2Off aria-hidden className="mt-1 size-5 shrink-0 text-urgent" />
        <span>{t("linkGoneTitle")}</span>
      </p>
      <p className="text-body text-ink-2">{t("setupGoneBody")}</p>
      <p className="text-body text-ink-2">{t("setupGoneNext")}</p>
      <Link href="/login" className={primaryLink}>
        {a("setupSignIn")}
      </Link>
    </div>
  );
}

export function SetupForm({ token }: { token: string }) {
  const a = useTranslations("App");
  const t = useTranslations("Login");
  const router = useRouter();
  const [busy, setBusy] = useState(false);
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
      await api(`/api/auth/setup/${encodeURIComponent(token)}`, { body: { password }, noRefresh: true });
      router.replace("/");
      router.refresh();
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
      setBusy(false);
    }
  }

  if (gone) return <SetupGone />;

  return (
    <form onSubmit={(e) => void submit(e)} noValidate className="flex flex-col gap-5">
      {formError && <FormAlert>{formError}</FormAlert>}
      <PasswordField
        label={a("setupTitle")}
        name="password"
        autoComplete="new-password"
        required
        rules
        error={passError}
      />
      <Button type="submit" size={56} className="w-full justify-center" disabled={busy} aria-busy={busy}>
        {a("setupGo")}
      </Button>
    </form>
  );
}
