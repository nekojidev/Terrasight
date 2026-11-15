"use client";

import { Button, TextField } from "@terrasight/ui";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { useState, type FormEvent } from "react";
import { FormAlert } from "@/components/FormAlert";
import { PASSWORD_MIN, PasswordField } from "@/components/PasswordField";
import { api, ApiError } from "@/lib/api";
import { authErrorKind, isEmail, RATE_LIMIT_MINUTES } from "@/lib/auth-errors";

type Mode = "signin" | "signup";

/** Sign in (design 01) and sign up (same screen; the design has no separate sign-up screen). */
export function LoginForm() {
  const t = useTranslations("Login");
  const a = useTranslations("App");
  const locale = useLocale();
  const router = useRouter();
  const params = useSearchParams();
  const next = safeNext(params.get("next"));
  const [mode, setMode] = useState<Mode>(params.get("mode") === "signup" ? "signup" : "signin");
  const [busy, setBusy] = useState(false);
  const [fields, setFields] = useState<{ name?: string; email?: string; password?: string }>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [sentTo, setSentTo] = useState<string | null>(null);

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const found: typeof fields = {};
    const name = String(form.get("name") ?? "").trim();
    const email = String(form.get("email") ?? "");
    const password = String(form.get("password") ?? "");
    if (mode === "signup" && !name) found.name = t("errNameEmpty");
    if (!email.trim()) found.email = t("errEmailEmpty");
    else if (!isEmail(email)) found.email = t("errEmailFormat");
    if (!password) found.password = t("errPassEmpty");
    else if (mode === "signup" && password.length < PASSWORD_MIN)
      found.password = t("errPassShort", { n: PASSWORD_MIN });
    setFields(found);
    setFormError(null);
    if (Object.keys(found).length) return;
    setBusy(true);
    try {
      if (mode === "signup") {
        await api("/api/auth/signup", {
          body: {
            name: form.get("name"),
            email: form.get("email"),
            password: form.get("password"),
            uiLanguage: locale,
          },
          noRefresh: true,
        });
        // The answer is the same for new and existing addresses (no enumeration) and opens no session. A new account
        // exists already (no email verification), so signing in with the same credentials works; for an address that
        // already had an account it fails like any wrong password, and we say "you may already have an account".
        try {
          await api("/api/auth/login", {
            body: { email: form.get("email"), password: form.get("password") },
            noRefresh: true,
          });
        } catch (err) {
          if (err instanceof ApiError && err.code === "bad-credentials") {
            setSentTo(String(form.get("email")));
            setBusy(false);
            return;
          }
          throw err;
        }
      } else {
        await api("/api/auth/login", {
          body: { email: form.get("email"), password: form.get("password") },
          noRefresh: true,
        });
      }
      router.replace(next);
      router.refresh();
    } catch (err) {
      const kind = authErrorKind(err);
      if (kind === "bad") setFields({ password: t("errBad") });
      else if (kind === "taken") setFields({ email: t("errTaken") });
      else if (kind === "invalid")
        setFields(
          mode === "signup"
            ? { password: t("errPassShort", { n: PASSWORD_MIN }) }
            : { password: t("errBad") },
        );
      else if (kind === "rate") setFormError(t("errRate", { n: RATE_LIMIT_MINUTES }));
      else if (kind === "net") setFormError(t("errNet"));
      else setFormError(t("errServer"));
      setBusy(false);
    }
  }

  if (sentTo)
    return (
      <div role="status" className="flex w-full max-w-[560px] flex-col gap-5">
        <h1 className="text-h1 text-ink">{a("checkEmailTitle")}</h1>
        <p className="text-body text-ink-2">{a("checkEmailBody", { email: sentTo })}</p>
        <Button
          type="button"
          size={56}
          className="mt-2 w-full justify-center"
          onClick={() => {
            setSentTo(null);
            setMode("signin");
          }}
        >
          {a("signIn")}
        </Button>
      </div>
    );

  return (
    <form onSubmit={submit} noValidate className="flex w-full max-w-[560px] flex-col gap-5">
      <div className="flex flex-col gap-2">
        <h1 className="text-h1 text-ink">{mode === "signin" ? t("title") : t("signupTitle")}</h1>
        {mode === "signup" && <p className="text-body text-ink-2">{t("signupSub")}</p>}
      </div>
      {params.get("expired") === "1" && !formError && (
        <p role="status" className="rounded-input bg-week-soft px-4 py-3 text-body text-week">
          {a("sessionExpired")}
        </p>
      )}
      {formError && <FormAlert>{formError}</FormAlert>}
      {mode === "signup" && (
        <TextField
          label={t("name")}
          name="name"
          autoComplete="name"
          required
          maxLength={100}
          error={fields.name}
        />
      )}
      <TextField
        label={t("email")}
        name="email"
        type="email"
        inputMode="email"
        autoComplete="email"
        required
        error={fields.email}
      />
      <PasswordField
        label={t("pass")}
        name="password"
        autoComplete={mode === "signin" ? "current-password" : "new-password"}
        required
        rules={mode === "signup"}
        error={fields.password}
      />
      {mode === "signin" && (
        <Link
          href="/forgot"
          className="focus-ring -mt-2 inline-flex min-h-tap items-center self-start text-body font-semibold text-ink-2 underline underline-offset-4"
        >
          {t("forgot")}
        </Link>
      )}
      <Button type="submit" size={56} className="mt-2 w-full justify-center" disabled={busy} aria-busy={busy}>
        {mode === "signin" ? t("go") : t("createGo")}
      </Button>
      <div className="flex flex-col items-center gap-2 border-t border-line pt-5">
        <p className="text-body text-ink-2">{mode === "signin" ? t("noacc") : t("haveAcc")}</p>
        <Button
          type="button"
          variant="outline"
          size={48}
          className="w-full justify-center"
          onClick={() => {
            setMode(mode === "signin" ? "signup" : "signin");
            setFields({});
            setFormError(null);
          }}
        >
          {mode === "signin" ? t("create") : t("signinLink")}
        </Button>
      </div>
    </form>
  );
}

/** Only same-site relative paths, never another origin. */
function safeNext(value: string | null): string {
  return value && value.startsWith("/") && !value.startsWith("//") ? value : "/";
}
