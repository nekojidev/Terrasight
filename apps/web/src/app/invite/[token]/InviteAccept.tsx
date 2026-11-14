"use client";

import { Button } from "@terrasight/ui";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { api, ApiError, setCookie, WORKSPACE_COOKIE } from "@/lib/api";

export function InviteAccept({ token, email }: { token: string; email: string }) {
  const a = useTranslations("App");
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function accept() {
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ workspaceId: string }>(`/api/invitations/${token}/accept`, { method: "POST" });
      setCookie(WORKSPACE_COOKIE, r.workspaceId);
      router.replace("/");
      router.refresh();
    } catch (e) {
      const code = e instanceof ApiError ? e.code : "";
      setError(
        code === "invitation-other-email"
          ? a("inviteOtherEmail", { email })
          : code === "invitation-used"
            ? a("inviteUsed")
            : code === "invitation-expired"
              ? a("inviteExpired")
              : a("errGeneric"),
      );
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {error && (
        <p role="alert" className="rounded-input bg-urgent-soft px-4 py-3 text-body text-urgent">
          {error}
        </p>
      )}
      <Button
        size={56}
        className="w-full justify-center"
        onClick={() => void accept()}
        disabled={busy}
        aria-busy={busy}
      >
        {a("inviteAccept")}
      </Button>
    </div>
  );
}
