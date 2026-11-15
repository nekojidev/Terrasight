"use client";

import { Button, TextField } from "@terrasight/ui";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { useState, type FormEvent } from "react";
import { api, ApiError } from "@/lib/api";

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
  const [error, setError] = useState<ApiError | null>(null);
  const [sentTo, setSentTo] = useState<string | null>(null);

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    setBusy(true);
    setError(null);
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
        // The answer is the same for new and existing addresses and opens no session: check the mailbox, then sign in.
        setSentTo(String(form.get("email")));
        setBusy(false);
        return;
      } else {
        await api("/api/auth/login", {
          body: { email: form.get("email"), password: form.get("password") },
          noRefresh: true,
        });
      }
      router.replace(next);
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err : null);
      setBusy(false);
    }
  }

  const message =
    error?.code === "bad-credentials"
      ? a("errBadCredentials")
      : error?.code === "email-taken"
        ? a("errEmailTaken")
        : error?.code === "rate-limited"
          ? a("errRateLimited")
          : error?.code === "invalid-input"
            ? a("errInvalid")
            : error
              ? a("errGeneric")
              : null;

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
      <h1 className="text-h1 text-ink">{mode === "signin" ? t("title") : a("signupTitle")}</h1>
      {mode === "signup" && <p className="-mt-3 text-body text-ink-2">{a("signupSub")}</p>}
      {message && (
        <p role="alert" className="rounded-input bg-urgent-soft px-4 py-3 text-body text-urgent">
          {message}
        </p>
      )}
      {mode === "signup" && (
        <TextField
          label={a("name")}
          name="name"
          autoComplete="name"
          required
          maxLength={100}
          error={error?.field("name")}
        />
      )}
      <TextField
        label={t("email")}
        name="email"
        type="email"
        autoComplete="email"
        required
        error={error?.field("email")}
      />
      <TextField
        label={t("pass")}
        name="password"
        type="password"
        autoComplete={mode === "signin" ? "current-password" : "new-password"}
        required
        minLength={mode === "signup" ? 10 : undefined}
        hint={mode === "signup" ? a("passHint") : undefined}
        error={error?.field("password")}
      />
      {mode === "signin" && (
        <Link href="/forgot" className="focus-ring -mt-2 self-start text-body font-semibold text-ink-2">
          {a("forgotLink")}
        </Link>
      )}
      <Button type="submit" size={56} className="mt-2 w-full justify-center" disabled={busy} aria-busy={busy}>
        {mode === "signin" ? t("go") : a("createAccount")}
      </Button>
      <p className="text-center text-body text-ink-2">
        {mode === "signin" ? t("noacc") : a("haveAccount")}{" "}
        <button
          type="button"
          className="focus-ring font-semibold text-ink"
          onClick={() => {
            setMode(mode === "signin" ? "signup" : "signin");
            setError(null);
          }}
        >
          {mode === "signin" ? t("create") : a("signIn")}
        </button>
      </p>
    </form>
  );
}

/** Only same-site relative paths, never another origin. */
function safeNext(value: string | null): string {
  return value && value.startsWith("/") && !value.startsWith("//") ? value : "/";
}
