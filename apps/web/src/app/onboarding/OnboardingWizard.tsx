"use client";

import { Button, Segmented, SelectField, TextField } from "@terrasight/ui";
import { ArrowLeft, ArrowRight, Copy } from "lucide-react";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { useMemo, useState, type FormEvent } from "react";
import { Brand } from "@/components/Brand";
import { api, ApiError, setCookie, WORKSPACE_COOKIE } from "@/lib/api";

interface CreatedWorkspace {
  id: string;
}
interface CreatedInvitation {
  email: string;
  token: string;
}

/** Offset label like "UTC−6" for a zone, at the current date. */
function utcOffset(tz: string): string {
  try {
    const part = new Intl.DateTimeFormat("en-US", { timeZone: tz, timeZoneName: "shortOffset" })
      .formatToParts(new Date())
      .find((p) => p.type === "timeZoneName")?.value;
    return (part ?? "GMT").replace("GMT", "UTC").replace("-", "−") || "UTC";
  } catch {
    return "UTC";
  }
}

function zoneLabel(tz: string): string {
  return `${tz.replaceAll("_", " ").replace("/", " / ")} (${utcOffset(tz) === "UTC" ? "UTC" : utcOffset(tz)})`;
}

/** Design 02: create the company in two steps (RFC §14.2). */
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
  const [invitation, setInvitation] = useState<CreatedInvitation | null>(null);
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

  async function invite(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const email = String(new FormData(e.currentTarget).get("email") ?? "");
    setBusy(true);
    setError(null);
    try {
      setInvitation(
        await api<CreatedInvitation>(`/api/w/${workspaceId}/invitations`, {
          body: { email, role: "viewer" },
        }),
      );
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
  const inviteUrl = invitation ? `${window.location.origin}/invite/${invitation.token}` : "";

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
                label: z === detected ? `${zoneLabel(z)} — ${a("tzDetected")}` : zoneLabel(z),
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
        ) : invitation ? (
          <div className="flex flex-col gap-5">
            <h1 className="text-h2 text-ink">{a("inviteLinkTitle", { email: invitation.email })}</h1>
            <p className="text-body text-ink-2">{a("inviteLinkNote")}</p>
            <div className="flex gap-2">
              <input
                readOnly
                value={inviteUrl}
                aria-label={a("copy")}
                className="min-h-13 w-full rounded-input border border-line bg-surface-2 px-4 font-mono text-small"
              />
              <Button
                variant="outline"
                size={52}
                icon={<Copy />}
                onClick={() => void navigator.clipboard.writeText(inviteUrl).then(() => setCopied(true))}
              >
                {copied ? a("copied") : a("copy")}
              </Button>
            </div>
            <Button size={56} className="w-full justify-center" onClick={finish}>
              {a("continue")}
            </Button>
          </div>
        ) : (
          <form onSubmit={invite} className="flex flex-col gap-6" noValidate>
            <div>
              <h1 className="text-h1 text-ink">{t("s2t")}</h1>
              <p className="mt-2 text-body text-ink-2">{t("s2s")}</p>
            </div>
            <TextField
              label={t("email")}
              name="email"
              type="email"
              autoComplete="email"
              required
              error={error?.field("email")}
            />
            <div className="rounded-input bg-surface-2 p-4">
              <p className="text-body font-semibold text-ink">{t("role")}</p>
              <p className="text-small text-ink-2">{t("role_s")}</p>
            </div>
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
