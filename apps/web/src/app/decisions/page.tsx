import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { AppShell } from "@/components/AppShell";
import { SessionRefresher } from "@/components/SessionRefresher";
import { activeWorkspace, serverGet, type Me } from "@/lib/server-api";
import { OwnerDecisionsClient } from "./OwnerDecisionsClient";

interface WorkspaceDetail {
  id: string;
  name: string;
  fieldCount: number;
  role: Me["workspaces"][number]["role"];
}

/** Decisions: the owner / manager (Viewer) sees what needs them; staff see their asked decisions. */
export default async function DecisionsPage() {
  const me = await serverGet<Me>("/api/me");
  if (!me.ok) {
    if (me.status === 401) return <SessionRefresher next="/decisions" />;
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
      crumb={t("odCrumb")}
    >
      {ws.data.role === "viewer" ? (
        <OwnerDecisionsClient workspaceId={ws.data.id} />
      ) : (
        <p className="text-body text-ink-2">{t("odStaffSoon")}</p>
      )}
    </AppShell>
  );
}
