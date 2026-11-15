"use client";

import { Button, Segmented, SelectField, TextField } from "@terrasight/ui";
import { ArrowLeft, ArrowRight, Copy } from "lucide-react";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { useMemo, useState, type FormEvent } from "react";
import { Brand } from "@/components/Brand";
import { api, ApiError, setCookie, WORKSPACE_COOKIE } from "@/lib/api";
import { zoneLabel } from "@/lib/time-zone";

interface CreatedWorkspace {
  id: string;
}
interface CreatedAgronomist {
  name: string;
  /** Absent when the person already had an account and was just added. */
  setupUrl?: string;
  expiresAt?: string;
}

/** Design 02: create the company, then add your agronomist (PD v2.10) in two steps (RFC §14.2). */
export function OnboardingWizard() {
  const t = useTranslations("Onboarding");
  const a = useTranslations("App");
  const locale = useLocale();
  const router = useRouter();
  const detected = useMemo(() => Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC", []);
  const zones = useMemo(() => {
    const all = typeof Intl.supportedValuesOf === "function" ? Intl.supportedValuesOf("timeZone") : [];
    return Array.from(new Set([detected, ...all, "UTC"]));
  }, [detected]);

  const [step, setStep] = useState<1 | 2>(1);
  const [workspaceId, setWorkspaceId] = useState<string | null>(null);
  const [companyName, setCompanyName] = useState("");
  const [timeZone, setTimeZone] = useState(detected);
  const [units, setUnits] = useState<"metric" | "imperial">(
    locale === "en" && detected.startsWith("America/") ? "imperial" : "metric",
  );
  const [reportLanguage, setReportLanguage] = useState<"uk" | "en">(locale === "uk" ? "uk" : "en");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const [agronomist, setAgronomist] = useState<CreatedAgronomist | null>(null);
  const [copied, setCopied] = useState(false);

  async function createCompany(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const name = String(new FormData(e.currentTarget).get("name") ?? "");
    setBusy(true);
    setError(null);
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
      setError(err instanceof ApiError ? err : null);
    } finally {
      setBusy(false);
    }
  }

  async function addAgronomist(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const name = String(form.get("agname") ?? "");
    const email = String(form.get("email") ?? "");
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ userId: string; setupUrl?: string; expiresAt?: string }>(
        `/api/w/${workspaceId}/members`,
        { body: { name, email, role: "agronomist" } },
      );
      setAgronomist({
        name,
        ...(r.setupUrl ? { setupUrl: r.setupUrl } : {}),
        ...(r.expiresAt ? { expiresAt: r.expiresAt } : {}),
      });
    } catch (err) {
      setError(err instanceof ApiError ? err : null);
    } finally {
      setBusy(false);
    }
  }

  const finish = () => {
    router.replace("/");
    router.refresh();
  };
  const setupUrl = agronomist?.setupUrl ? `${window.location.origin}${agronomist.setupUrl}` : "";

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-[560px] flex-col gap-6 px-4 py-10">
      <header className="flex items-center justify-between">
        <Brand />
        <span className="flex items-center gap-3 text-small text-ink-2">
          {t("step")} {step} {t("of2")}
          <span aria-hidden className="flex gap-2">
            <span className="block h-1 w-10 rounded-chip bg-ink" />
            <span className={`block h-1 w-10 rounded-chip ${step === 2 ? "bg-ink" : "bg-line"}`} />
          </span>
        </span>
      </header>

      <section className="animate-rise rounded-card border border-line bg-surface p-8">
        {error && (
          <p role="alert" className="mb-5 rounded-input bg-urgent-soft px-4 py-3 text-body text-urgent">
            {error.code === "invalid-input" ? a("errInvalid") : a("errGeneric")}
          </p>
        )}

        {step === 1 ? (
          <form onSubmit={createCompany} className="flex flex-col gap-6" noValidate>
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
              error={error?.field("name")}
            />
            <SelectField
              label={t("tz")}
              hint={t("tz_h")}
              value={timeZone}
              onChange={(e) => setTimeZone(e.target.value)}
              options={zones.map((z) => ({
                value: z,
                label: z === detected ? `${zoneLabel(z, locale)} — ${a("tzDetected")}` : zoneLabel(z, locale),
              }))}
            />
            <Segmented
              label={t("units")}
              value={units}
              onChange={setUnits}
              options={[
                { value: "metric", label: t("u_ha") },
                { value: "imperial", label: t("u_ac") },
              ]}
            />
            <Segmented
              variant="compact"
              label={t("lang")}
              value={reportLanguage}
              onChange={setReportLanguage}
              options={[
                { value: "uk", label: "UA" },
                { value: "en", label: "EN" },
              ]}
            />
            <Button
              type="submit"
              size={56}
              className="w-full justify-center"
              disabled={busy}
              aria-busy={busy}
            >
              {t("next")} <ArrowRight aria-hidden className="size-5" />
            </Button>
          </form>
        ) : agronomist ? (
          <div className="flex flex-col gap-5">
            <h1 className="text-h2 text-ink">{a("teamLinkTitle", { name: agronomist.name })}</h1>
            {setupUrl ? (
              <>
                <p className="text-body text-ink-2">
                  {a("teamLinkOnce", {
                    name: agronomist.name,
                    date: new Date(agronomist.expiresAt ?? Date.now()).toLocaleDateString(locale),
                  })}
                </p>
                <div className="flex gap-2">
                  <input
                    readOnly
                    value={setupUrl}
                    aria-label={a("teamCopyLink")}
                    className="min-h-13 w-full rounded-input border border-line bg-surface-2 px-4 font-mono text-small"
                  />
                  <Button
                    variant="outline"
                    size={52}
                    icon={<Copy />}
                    onClick={() => void navigator.clipboard.writeText(setupUrl).then(() => setCopied(true))}
                  >
                    {copied ? a("teamCopied") : a("teamCopyLink")}
                  </Button>
                </div>
              </>
            ) : (
              <p className="text-body text-ink-2">{a("teamExisting", { name: agronomist.name })}</p>
            )}
            <Button size={56} className="w-full justify-center" onClick={finish}>
              {a("continue")}
            </Button>
          </div>
        ) : (
          <form onSubmit={addAgronomist} className="flex flex-col gap-6" noValidate>
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
              error={error?.field("name")}
            />
            <TextField
              label={t("email")}
              name="email"
              type="email"
              autoComplete="off"
              required
              error={error?.field("email")}
            />
            <div className="flex flex-col gap-3 sm:flex-row">
              <Button
                type="button"
                variant="outline"
                size={56}
                icon={<ArrowLeft />}
                onClick={() => setStep(1)}
              >
                {t("back")}
              </Button>
              <Button type="button" variant="outline" size={56} className="sm:ml-auto" onClick={finish}>
                {t("skip")}
              </Button>
              <Button type="submit" size={56} disabled={busy} aria-busy={busy}>
                {t("invite")}
              </Button>
            </div>
            <p className="text-small text-ink-3">{t("later")}</p>
          </form>
        )}
      </section>
    </main>
  );
}
