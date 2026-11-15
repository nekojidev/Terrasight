import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { AppShell } from "@/components/AppShell";
import { SessionRefresher } from "@/components/SessionRefresher";
import { SettingsNav } from "@/components/SettingsNav";
import { activeWorkspace, serverGet, type Me } from "@/lib/server-api";
import { AccountClient } from "./AccountClient";

interface WorkspaceDetail {
  id: string;
  name: string;
  fieldCount: number;
  role: Me["workspaces"][number]["role"];
}

/** My account: name, interface language, password, sign out everywhere. */
export default async function AccountPage() {
  const me = await serverGet<Me>("/api/me");
  if (!me.ok) {
    if (me.status === 401) return <SessionRefresher next="/settings/account" />;
    redirect("/login");
  }
  const active = await activeWorkspace(me.data);
  if (!active) redirect("/onboarding");
  const ws = await serverGet<WorkspaceDetail>(`/api/w/${active.id}`);
  if (!ws.ok) redirect("/");
  const t = await getTranslations("App");
  return (
    <AppShell
      workspace={{ id: ws.data.id, name: ws.data.name, fieldCount: ws.data.fieldCount }}
      user={{ name: me.data.name, role: ws.data.role }}
      crumb={t("navSettings")}
    >
      <div className="flex min-w-0 flex-col">
        <h1 className="mb-4 text-h1 text-ink">{t("navSettings")}</h1>
        <SettingsNav active="account" owner={ws.data.role === "owner"} />
        <AccountClient initial={{ name: me.data.name, email: me.data.email, uiLanguage: me.data.uiLanguage }} />
      </div>
    </AppShell>
  );
}
