import { PageContainer } from "@terrasight/ui";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { AppShell } from "@/components/AppShell";
import { SessionRefresher } from "@/components/SessionRefresher";
import { SettingsNav } from "@/components/SettingsNav";
import { activeWorkspace, serverGet, type Me } from "@/lib/server-api";
import { WorkspaceSettingsClient } from "./WorkspaceSettingsClient";

interface WorkspaceDetail {
  id: string;
  name: string;
  fieldCount: number;
  role: Me["workspaces"][number]["role"];
}

/** Company settings (Owner): name, time zone, units, report language; export; archived fields. */
export default async function WorkspaceSettingsPage() {
  const me = await serverGet<Me>("/api/me");
  if (!me.ok) {
    if (me.status === 401) return <SessionRefresher next="/settings/workspace" />;
    redirect("/login");
  }
  const active = await activeWorkspace(me.data);
  if (!active) redirect("/onboarding");
  const ws = await serverGet<WorkspaceDetail>(`/api/w/${active.id}`);
  if (!ws.ok) redirect("/");
  if (ws.data.role !== "owner") redirect("/settings/account");
  const t = await getTranslations("App");
  return (
    <AppShell
      workspace={{ id: ws.data.id, name: ws.data.name, fieldCount: ws.data.fieldCount }}
      user={{ name: me.data.name, role: ws.data.role }}
      crumb={t("navSettings")}
    >
      <PageContainer width="narrow" className="flex min-w-0 flex-col">
        <h1 className="mb-4 text-h1 text-ink">{t("navSettings")}</h1>
        <SettingsNav active="workspace" owner />
        <WorkspaceSettingsClient
          workspaceId={ws.data.id}
          initial={{
            name: active.name,
            timeZone: active.timeZone,
            units: active.units,
            reportLanguage: active.reportLanguage,
          }}
        />
      </PageContainer>
    </AppShell>
  );
}
