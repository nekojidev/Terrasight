"use client";

import { Button, ProgressBar, Surface, TextField, useToast } from "@terrasight/ui";
import { ArrowRight, Check, Copy } from "lucide-react";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { useMemo, useState, type FormEvent } from "react";
import { Brand } from "@/components/Brand";
import { TimeZoneField } from "@/components/TimeZoneField";
import { api, ApiError, setCookie, WORKSPACE_COOKIE } from "@/lib/api";
import { authErrorKind, isEmail } from "@/lib/auth-errors";
import { useActionToast } from "@/lib/useActionToast";
import { useFormat } from "@/lib/useFormat";

interface CreatedWorkspace {
  id: string;
}
interface CreatedAgronomist {
  name: string;
  setupUrl: string;
  expiresAt: string;
}

/** Design 02: create the company, then add your agronomist (PD v2.10) in two steps (RFC §14.2). */
export function OnboardingWizard() {
  const t = useTranslations("Onboarding");
  const a = useTranslations("App");
  const locale = useLocale();
  const router = useRouter();
  const toast = useToast();
  const action = useActionToast();
  const f = useFormat();
  const detected = useMemo(() => Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC", []);

  const [step, setStep] = useState<1 | 2>(1);
  const [workspaceId, setWorkspaceId] = useState<string | null>(null);
  const [companyName, setCompanyName] = useState("");
  const [timeZone, setTimeZone] = useState(detected);
  const [editZone, setEditZone] = useState(false);
  // Defaults only: units are corrected by the first field's country (screens follow each field), both live in Settings.
  const units: "metric" | "imperial" =
    locale === "en" && detected.startsWith("America/") ? "imperial" : "metric";
  const reportLanguage: "uk" | "en" = locale === "uk" ? "uk" : "en";
  const [busy, setBusy] = useState(false);
  const [fields, setFields] = useState<{ name?: string; agname?: string; email?: string }>({});
  const [agronomist, setAgronomist] = useState<CreatedAgronomist | null>(null);
  const [copied, setCopied] = useState(false);

  async function createCompany(name: string) {
    setBusy(true);
    try {
      const body = { name, timeZone, units, reportLanguage };
      // Coming back from step 2 edits the company created a moment ago instead of creating another.
      const ws = workspaceId
        ? await api<CreatedWorkspace>(`/api/w/${workspaceId}`, { method: "PATCH", body })
        : await api<CreatedWorkspace>("/api/workspaces", { body });
      setCookie(WORKSPACE_COOKIE, ws.id);
      setWorkspaceId(ws.id);
      setCompanyName(name);
      setStep(2);
    } catch (err) {
      if (err instanceof ApiError && err.code === "invalid-input")
        setFields({ name: err.field("name") ?? t("errName") });
      else action.fail(err, t("saveFail"), () => void createCompany(name));
    } finally {
      setBusy(false);
    }
  }

  function submitCompany(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const name = String(new FormData(e.currentTarget).get("name") ?? "").trim();
    if (!name) return setFields({ name: t("errName") });
    setFields({});
    void createCompany(name);
  }

  async function addAgronomist(name: string, email: string) {
    setBusy(true);
    try {
      const r = await api<{ userId: string; setupUrl: string; expiresAt: string }>(
        `/api/w/${workspaceId}/members`,
        { body: { name, email, role: "agronomist" } },
      );
      setAgronomist({ name, setupUrl: r.setupUrl, expiresAt: r.expiresAt });
    } catch (err) {
      const kind = authErrorKind(err);
      if (kind === "taken") setFields({ email: t("errEmailInUse") });
      else if (kind === "invalid") setFields({ email: t("errAgEmail") });
      else action.fail(err, t("inviteFail"), () => void addAgronomist(name, email));
    } finally {
      setBusy(false);
    }
  }

  function submitAgronomist(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const name = String(form.get("agname") ?? "").trim();
    const email = String(form.get("email") ?? "").trim();
    const found: typeof fields = {};
    if (!name) found.agname = t("errAgName");
    if (!isEmail(email)) found.email = t("errAgEmail");
    setFields(found);
    if (Object.keys(found).length) return;
    void addAgronomist(name, email);
  }

  const finish = () => {
    router.replace("/");
    router.refresh();
  };
  const setupUrl = agronomist ? `${window.location.origin}${agronomist.setupUrl}` : "";
  const copy = () =>
    void navigator.clipboard.writeText(setupUrl).then(
      () => {
        setCopied(true);
        toast.show(t("copied"), "info");
      },
      (err) => action.fail(err, t("copy")),
    );

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-[560px] flex-col gap-6 px-4 py-10">
      <header className="flex flex-col gap-4">
        <Brand />
        <div className="flex flex-col gap-2">
          <p className="text-caption font-semibold text-ink-2">{t("stepOf", { n: step })}</p>
          <ProgressBar value={step} max={2} label={t("progress")} />
        </div>
      </header>

      <Surface as="section" pad="lg" className="animate-rise sm:p-8">
        {step === 1 ? (
          <form onSubmit={submitCompany} className="flex flex-col gap-6" noValidate>
            <div>
              <h1 className="text-h1 text-ink">{t("s1t")}</h1>
              <p className="mt-2 text-body text-ink-2">{t("s1s")}</p>
            </div>
            <TextField
              label={t("name")}
              name="name"
              required
              maxLength={80}
              autoComplete="organization"
              defaultValue={companyName}
              error={fields.name}
            />
            {/* Time zone is detected from the browser: a quiet line, editable. Units come from the first field. */}
            {editZone ? (
              <TimeZoneField value={timeZone} onChange={setTimeZone} detected={detected} hint={t("tz_h")} />
            ) : (
              <p className="flex flex-wrap items-center gap-x-2 text-small text-ink-2">
                {t("tzLine", { tz: timeZone.replace(/_/g, " ") })}
                <Button variant="link" className="min-h-tap" onClick={() => setEditZone(true)}>
                  {t("tzChange")}
                </Button>
              </p>
            )}
            <Button
              type="submit"
              size={56}
              className="w-full justify-center"
              disabled={busy}
              aria-busy={busy}
              icon={<ArrowRight />}
            >
              {t("next")}
            </Button>
          </form>
        ) : agronomist ? (
          <div className="flex flex-col gap-5">
            <h2 className="text-h2 text-ink">{t("linkTitle", { name: agronomist.name })}</h2>
            <p className="text-body text-ink-2">
              {t("linkNote", { name: agronomist.name, date: f.date(agronomist.expiresAt, "full") })}
            </p>
            <input
              readOnly
              value={setupUrl}
              aria-label={t("linkLabel")}
              onFocus={(e) => e.currentTarget.select()}
              className="focus-ring min-h-13 w-full rounded-input border border-line-control bg-surface-2 px-4 font-mono text-caption text-ink"
            />
            <Button
              variant="outline"
              size={48}
              className="w-full justify-center"
              icon={copied ? <Check /> : <Copy />}
              onClick={copy}
            >
              {copied ? a("teamCopied") : t("copy")}
            </Button>
            <Button size={56} className="w-full justify-center" onClick={finish}>
              {a("continue")}
            </Button>
          </div>
        ) : (
          <form onSubmit={submitAgronomist} className="flex flex-col gap-6" noValidate>
            <div>
              <h1 className="text-h1 text-ink">{t("s2t")}</h1>
              <p className="mt-2 text-body text-ink-2">{t("s2s")}</p>
            </div>
            <TextField
              label={t("agname")}
              name="agname"
              autoComplete="off"
              required
              maxLength={100}
              error={fields.agname}
            />
            <TextField
              label={t("email")}
              name="email"
              type="email"
              inputMode="email"
              autoComplete="off"
              required
              error={fields.email}
            />
            <Button
              type="submit"
              size={56}
              className="w-full justify-center"
              disabled={busy}
              aria-busy={busy}
            >
              {t("invite")}
            </Button>
            <div className="flex flex-col items-center gap-1">
              <Button variant="link" onClick={finish} className="min-h-tap">
                {t("skipSelf")}
              </Button>
              <Button
                variant="link"
                className="min-h-tap text-ink-2"
                onClick={() => {
                  setFields({});
                  setStep(1);
                }}
              >
                {t("back")}
              </Button>
            </div>
            <p className="text-center text-caption text-ink-2">{t("later")}</p>
          </form>
        )}
      </Surface>
    </main>
  );
}
