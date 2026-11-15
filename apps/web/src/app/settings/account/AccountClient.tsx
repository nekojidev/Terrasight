"use client";

import { useMutation } from "@tanstack/react-query";
import { Button, ConfirmDialog, Segmented, Surface, TextField, useToast } from "@terrasight/ui";
import { LogOut } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState, type FormEvent } from "react";
import { PASSWORD_MIN, PasswordField } from "@/components/PasswordField";
import { api, ApiError, setCookie } from "@/lib/api";
import { useActionToast } from "@/lib/useActionToast";

interface Profile {
  name: string;
  email: string;
  uiLanguage: "uk" | "en";
}

const isInvalid = (e: unknown): e is ApiError => e instanceof ApiError && e.problem.status === 422;

/** Account settings: profile (saved on the server), password change, and a danger zone (sign out everywhere). */
export function AccountClient({ initial }: { initial: Profile }) {
  const t = useTranslations("App");
  const s = useTranslations("Settings");
  const l = useTranslations("Login");
  const router = useRouter();
  const toast = useToast();
  const action = useActionToast();
  const [profile, setProfile] = useState({ name: initial.name, uiLanguage: initial.uiLanguage });
  const [profileError, setProfileError] = useState<ApiError | null>(null);

  const saveProfile = useMutation({
    mutationFn: (body: { name: string; uiLanguage: "uk" | "en" }) =>
      api("/api/me", { method: "PATCH", body }),
    onMutate: () => setProfileError(null),
    onSuccess: (_d, body) => {
      toast.show(s("profileSaved"), "info");
      // The interface language is read from this cookie; the server copy follows the user across devices.
      setCookie("ts_locale", body.uiLanguage);
      router.refresh();
    },
    onError: (e, body) =>
      isInvalid(e) ? setProfileError(e) : action.fail(e, s("profileFail"), () => saveProfile.mutate(body)),
  });
  const submitProfile = (e: FormEvent) => {
    e.preventDefault();
    saveProfile.mutate({ name: profile.name.trim(), uiLanguage: profile.uiLanguage });
  };

  const [pw, setPw] = useState({ current: "", next: "" });
  const [pwErrors, setPwErrors] = useState<{ current?: string; next?: string }>({});
  const changePassword = useMutation({
    mutationFn: () =>
      api("/api/auth/password", { body: { currentPassword: pw.current, newPassword: pw.next } }),
    onMutate: () => setPwErrors({}),
    onSuccess: () => {
      setPw({ current: "", next: "" });
      toast.show(s("passwordChangedToast"), "info");
    },
    onError: (e) => {
      if (e instanceof ApiError && e.code === "bad-credentials")
        setPwErrors({ current: t("accWrongPassword") });
      else if (isInvalid(e)) setPwErrors({ next: l("errPassShort", { n: PASSWORD_MIN }) });
      else action.fail(e, s("passwordFail"), () => changePassword.mutate());
    },
  });
  const submitPassword = (e: FormEvent) => {
    e.preventDefault();
    const found: typeof pwErrors = {};
    if (!pw.current) found.current = l("errPassEmpty");
    if (pw.next.length < PASSWORD_MIN) found.next = l("errPassShort", { n: PASSWORD_MIN });
    setPwErrors(found);
    if (!Object.keys(found).length) changePassword.mutate();
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
      action.fail(e, s("signOutFail"), () => signOutAll.mutate());
    },
  });

  return (
    <div className="flex min-w-0 flex-col gap-6">
      <Surface as="section" aria-labelledby="acc-profile">
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
          <div>
            <Button
              type="submit"
              size={48}
              disabled={saveProfile.isPending || !profile.name.trim()}
              aria-busy={saveProfile.isPending}
            >
              {t("save")}
            </Button>
          </div>
        </form>
      </Surface>

      <Surface as="section" aria-labelledby="acc-pass">
        <h2 id="acc-pass" className="mb-1 text-h3 text-ink">
          {t("accPassword")}
        </h2>
        <p className="mb-4 text-small text-ink-2">{t("accPasswordSub")}</p>
        <form onSubmit={submitPassword} className="flex flex-col gap-5" noValidate>
          <PasswordField
            label={t("accCurrentPassword")}
            name="currentPassword"
            autoComplete="current-password"
            required
            value={pw.current}
            onChange={(e) => setPw({ ...pw, current: e.target.value })}
            error={pwErrors.current}
          />
          <PasswordField
            label={t("accNewPassword")}
            name="newPassword"
            autoComplete="new-password"
            required
            rules
            value={pw.next}
            onChange={(e) => setPw({ ...pw, next: e.target.value })}
            error={pwErrors.next}
          />
          <div>
            <Button
              type="submit"
              size={48}
              disabled={changePassword.isPending}
              aria-busy={changePassword.isPending}
            >
              {t("accChangePassword")}
            </Button>
          </div>
        </form>
      </Surface>

      <Surface as="section" aria-labelledby="acc-danger" className="border-urgent">
        <h2 id="acc-danger" className="mb-1 text-h3 text-urgent">
          {s("dangerTitle")}
        </h2>
        <p className="mb-4 text-small text-ink-2">{s("dangerAccountSub")}</p>
        <h3 className="text-body font-semibold text-ink">{t("accSessions")}</h3>
        <p className="mb-3 text-small text-ink-2">{t("accSessionsSub")}</p>
        <Button variant="outline" icon={<LogOut />} onClick={() => setConfirmAll(true)}>
          {t("accSignOutAll")}
        </Button>
      </Surface>

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
