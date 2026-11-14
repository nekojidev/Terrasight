import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { Brand } from "@/components/Brand";
import { LanguageSwitch } from "@/components/LanguageSwitch";
import { serverGet, type Me } from "@/lib/server-api";
import { InviteAccept } from "./InviteAccept";

interface InvitationInfo {
  workspaceName: string;
  email: string;
  role: "owner" | "admin" | "agronomist" | "viewer";
  status: "open" | "accepted" | "expired";
}

/** Accepting an invitation (S-01.04). The design has no screen for this; it reuses the onboarding card. */
export default async function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const a = await getTranslations("App");
  const info = await serverGet<InvitationInfo>(`/api/invitations/${encodeURIComponent(token)}`);
  const me = await serverGet<Me>("/api/me");
  const next = `/invite/${token}`;

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-[560px] flex-col gap-6 px-4 py-10">
      <header className="flex items-center justify-between">
        <Brand />
        <LanguageSwitch />
      </header>
      <section className="rounded-card border border-line bg-surface p-8">
        {!info.ok ? (
          <p className="text-body text-ink-2">{a("errGeneric")}</p>
        ) : (
          <div className="flex flex-col gap-5">
            <h1 className="text-h1 text-ink">{a("inviteTitle", { workspace: info.data.workspaceName })}</h1>
            <p className="text-body text-ink-2">{a("inviteRole", { role: a(`role_${info.data.role}`) })}</p>
            {info.data.status === "accepted" ? (
              <p className="text-body text-ink">{a("inviteUsed")}</p>
            ) : info.data.status === "expired" ? (
              <p className="text-body text-ink">{a("inviteExpired")}</p>
            ) : me.ok ? (
              <InviteAccept token={token} email={info.data.email} />
            ) : (
              <>
                <p className="text-body text-ink-2">{a("inviteFor", { email: info.data.email })}</p>
                <div className="flex flex-col gap-3 sm:flex-row">
                  <Link
                    href={`/login?mode=signup&next=${encodeURIComponent(next)}`}
                    className="focus-ring inline-flex min-h-14 flex-1 items-center justify-center rounded-btn bg-ink px-6 text-body font-semibold text-surface"
                  >
                    {a("createAccount")}
                  </Link>
                  <Link
                    href={`/login?next=${encodeURIComponent(next)}`}
                    className="focus-ring inline-flex min-h-14 flex-1 items-center justify-center rounded-btn border border-line-strong px-6 text-body font-semibold text-ink"
                  >
                    {a("signIn")}
                  </Link>
                </div>
              </>
            )}
          </div>
        )}
      </section>
    </main>
  );
}
