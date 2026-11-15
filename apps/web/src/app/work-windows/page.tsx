import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { AppShell } from "@/components/AppShell";
import { SessionRefresher } from "@/components/SessionRefresher";
import { activeWorkspace, serverGet, type Me } from "@/lib/server-api";
import { WorkWindowsClient } from "./WorkWindowsClient";

interface WorkspaceDetail {
  id: string;
  name: string;
  fieldCount: number;
  units: "metric" | "imperial";
  role: Me["workspaces"][number]["role"];
}

/** Sidebar "Work windows": when spraying, sowing, field traffic and fertiliser are possible this week. */
export default async function WorkWindowsPage() {
  const me = await serverGet<Me>("/api/me");
  if (!me.ok) {
    if (me.status === 401) return <SessionRefresher next="/work-windows" />;
    redirect("/login");
  }
  const active = await activeWorkspace(me.data);
  if (!active) redirect("/onboarding");
  const ws = await serverGet<WorkspaceDetail>(`/api/w/${active.id}`);
  if (!ws.ok) redirect("/");
  // The windows need brief.read (owner, admin, agronomist); a viewer lands on Home.
  if (ws.data.role === "viewer") redirect("/");
  const t = await getTranslations("App");
  return (
    <AppShell
      workspace={{ id: ws.data.id, name: ws.data.name, fieldCount: ws.data.fieldCount }}
      user={{ name: me.data.name, role: ws.data.role }}
      crumb={t("wwTitle")}
    >
      <WorkWindowsClient workspaceId={ws.data.id} units={ws.data.units} />
    </AppShell>
  );
}
