"use client";

import { useMutation } from "@tanstack/react-query";
import { Button, ConfirmDialog, Segmented, TextField } from "@terrasight/ui";
import { LogOut } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState, type FormEvent } from "react";
import { useErrorText, useReportError } from "@/components/useReportError";
import { api, ApiError, setCookie } from "@/lib/api";

interface Profile {
  name: string;
  email: string;
  uiLanguage: "uk" | "en";
}

/** Account settings: profile (saved on the server), password change, sign out everywhere. */
export function AccountClient({ initial }: { initial: Profile }) {
  const t = useTranslations("App");
  const router = useRouter();
  const report = useReportError();
  const errorText = useErrorText();
  const [profile, setProfile] = useState({ name: initial.name, uiLanguage: initial.uiLanguage });
  const [profileSaved, setProfileSaved] = useState(false);
  const [profileError, setProfileError] = useState<ApiError | null>(null);

  const saveProfile = useMutation({
    mutationFn: (body: { name: string; uiLanguage: "uk" | "en" }) => api("/api/me", { method: "PATCH", body }),
    onMutate: () => {
      setProfileSaved(false);
      setProfileError(null);
    },
    onSuccess: (_d, body) => {
      setProfileSaved(true);
      // The interface language is read from this cookie; the server copy follows the user across devices.
      setCookie("ts_locale", body.uiLanguage);
      router.refresh();
    },
    onError: (e) => (e instanceof ApiError && e.problem.status === 422 ? setProfileError(e) : report(e)),
  });
  const submitProfile = (e: FormEvent) => {
    e.preventDefault();
    saveProfile.mutate({ name: profile.name.trim(), uiLanguage: profile.uiLanguage });
  };

  const [pw, setPw] = useState({ current: "", next: "" });
  const [pwDone, setPwDone] = useState(false);
  const [pwError, setPwError] = useState<string | null>(null);
  const changePassword = useMutation({
    mutationFn: () =>
      api("/api/auth/password", { body: { currentPassword: pw.current, newPassword: pw.next }, noRefresh: false }),
    onMutate: () => {
      setPwDone(false);
      setPwError(null);
    },
    onSuccess: () => {
      setPw({ current: "", next: "" });
      setPwDone(true);
    },
    onError: (e) =>
      setPwError(
        e instanceof ApiError && e.code === "bad-credentials"
          ? t("accWrongPassword")
          : e instanceof ApiError && e.problem.status === 422
            ? t("passHint")
            : errorText(e),
      ),
  });
  const submitPassword = (e: FormEvent) => {
    e.preventDefault();
    changePassword.mutate();
  };

  const [confirmAll, setConfirmAll] = useState(false);
  const signOutAll = useMutation({
    mutationFn: () => api("/api/auth/logout-all", { method: "POST", body: {}, noRefresh: true }),
    onSuccess: () => {
      router.replace("/login");
      router.refresh();
    },
    onError: (e) => {
      setConfirmAll(false);
      report(e);
    },
  });

  return (
    <div className="grid min-w-0 gap-6 lg:grid-cols-2">
      <section aria-labelledby="acc-profile" className="h-fit rounded-card border border-line bg-surface p-5">
        <h2 id="acc-profile" className="mb-4 text-h3 text-ink">
          {t("accProfile")}
        </h2>
        <form onSubmit={submitProfile} className="flex flex-col gap-5" noValidate>
          <TextField
            label={t("name")}
            name="name"
            autoComplete="name"
            required
            maxLength={100}
            value={profile.name}
            onChange={(e) => setProfile({ ...profile, name: e.target.value })}
            error={profileError?.field("name")}
          />
          <TextField label={t("teamEmail")} name="email" value={initial.email} readOnly disabled />
          <Segmented
            variant="compact"
            label={t("accLanguage")}
            value={profile.uiLanguage}
            onChange={(uiLanguage) => setProfile({ ...profile, uiLanguage })}
            options={[
              { value: "uk", label: "UA" },
              { value: "en", label: "EN" },
            ]}
          />
          <div className="flex items-center gap-3">
            <Button
              type="submit"
              size={48}
              disabled={saveProfile.isPending || !profile.name.trim()}
              aria-busy={saveProfile.isPending}
            >
              {t("save")}
            </Button>
            {profileSaved && (
              <span role="status" className="text-small text-ok">
                {t("saved")}
              </span>
            )}
          </div>
        </form>
      </section>

      <div className="flex min-w-0 flex-col gap-6">
        <section aria-labelledby="acc-pass" className="rounded-card border border-line bg-surface p-5">
          <h2 id="acc-pass" className="mb-1 text-h3 text-ink">
            {t("accPassword")}
          </h2>
          <p className="mb-4 text-small text-ink-2">{t("accPasswordSub")}</p>
          <form onSubmit={submitPassword} className="flex flex-col gap-5" noValidate>
            <TextField
              label={t("accCurrentPassword")}
              name="currentPassword"
              type="password"
              autoComplete="current-password"
              required
              value={pw.current}
              onChange={(e) => setPw({ ...pw, current: e.target.value })}
            />
            <TextField
              label={t("accNewPassword")}
              name="newPassword"
              type="password"
              autoComplete="new-password"
              required
              minLength={10}
              hint={t("passHint")}
              value={pw.next}
              onChange={(e) => setPw({ ...pw, next: e.target.value })}
            />
            {pwError && (
              <p role="alert" className="text-small text-urgent">
                {pwError}
              </p>
            )}
            <div className="flex items-center gap-3">
              <Button
                type="submit"
                size={48}
                disabled={changePassword.isPending || !pw.current || pw.next.length < 10}
                aria-busy={changePassword.isPending}
              >
                {t("accChangePassword")}
              </Button>
              {pwDone && (
                <span role="status" className="text-small text-ok">
                  {t("accPasswordChanged")}
                </span>
              )}
            </div>
          </form>
        </section>

        <section aria-labelledby="acc-sessions" className="rounded-card border border-line bg-surface p-5">
          <h2 id="acc-sessions" className="mb-1 text-h3 text-ink">
            {t("accSessions")}
          </h2>
          <p className="mb-4 text-small text-ink-2">{t("accSessionsSub")}</p>
          <Button variant="outline" icon={<LogOut />} onClick={() => setConfirmAll(true)}>
            {t("accSignOutAll")}
          </Button>
        </section>
      </div>

      <ConfirmDialog
        open={confirmAll}
        title={t("accSignOutAllTitle")}
        confirmLabel={t("accSignOutAll")}
        cancelLabel={t("cancel")}
        busy={signOutAll.isPending}
        onConfirm={() => signOutAll.mutate()}
        onCancel={() => setConfirmAll(false)}
      >
        {t("accSignOutAllBody")}
      </ConfirmDialog>
    </div>
  );
}
