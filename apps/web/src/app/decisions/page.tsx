import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { AppShell } from "@/components/AppShell";
import { SessionRefresher } from "@/components/SessionRefresher";
import { activeWorkspace, serverGet, type Me } from "@/lib/server-api";
import { DecisionsClient } from "./DecisionsClient";
import { OwnerDecisionsClient } from "./OwnerDecisionsClient";

interface WorkspaceDetail {
  id: string;
  name: string;
  fieldCount: number;
  role: Me["workspaces"][number]["role"];
}

/** Owner decisions (PD v2.10): the Owner answers; the Agronomist asks and replies. `?field=` filters (staff). */
export default async function DecisionsPage({ searchParams }: { searchParams: Promise<{ field?: string }> }) {
  const sp = await searchParams;
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
      crumb={t("navDecisions")}
    >
      {ws.data.role === "owner" ? (
        <OwnerDecisionsClient workspaceId={ws.data.id} />
      ) : (
        <DecisionsClient workspaceId={ws.data.id} fieldId={sp.field ?? null} />
      )}
    </AppShell>
  );
}
