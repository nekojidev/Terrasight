import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { AppShell } from "@/components/AppShell";
import { SessionRefresher } from "@/components/SessionRefresher";
import { activeWorkspace, serverGet, type Me } from "@/lib/server-api";
import { TeamClient } from "./TeamClient";

interface WorkspaceDetail {
  id: string;
  name: string;
  fieldCount: number;
  role: Me["workspaces"][number]["role"];
}

/** Team (PD v2.9): the Owner / Admin creates the company's users and shares one-time setup links. */
export default async function TeamPage() {
  const me = await serverGet<Me>("/api/me");
  if (!me.ok) {
    if (me.status === 401) return <SessionRefresher next="/settings/team" />;
    redirect("/login");
  }
  const active = await activeWorkspace(me.data);
  if (!active) redirect("/onboarding");
  const ws = await serverGet<WorkspaceDetail>(`/api/w/${active.id}`);
  if (!ws.ok) redirect("/");
  if (ws.data.role !== "owner" && ws.data.role !== "admin") redirect("/");
  const t = await getTranslations("App");
  return (
    <AppShell
      workspace={{ id: ws.data.id, name: ws.data.name, fieldCount: ws.data.fieldCount }}
      user={{ name: me.data.name, role: ws.data.role }}
      crumb={t("navTeam")}
    >
      <TeamClient workspaceId={ws.data.id} role={ws.data.role} meId={me.data.id} />
    </AppShell>
  );
}
