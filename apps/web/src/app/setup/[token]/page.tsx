import { getTranslations } from "next-intl/server";
import { AuthShell } from "@/components/AuthShell";
import { serverGet } from "@/lib/server-api";
import { SetupForm, SetupGone } from "./SetupForm";

/** The one-time "set your password" link created by the company owner (PD v2.9). */
export default async function SetupPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const a = await getTranslations("App");
  const info = await serverGet<{ name: string; email: string }>(
    `/api/auth/setup/${encodeURIComponent(token)}`,
  );
  return (
    <AuthShell>
      {info.ok ? (
        <>
          <h1 className="text-h1 text-ink">{a("setupTitle")}</h1>
          <p className="text-body text-ink-2">
            {a("setupSub", { name: info.data.name, email: info.data.email })}
          </p>
          <SetupForm token={token} />
        </>
      ) : (
        <SetupGone />
      )}
    </AuthShell>
  );
}
