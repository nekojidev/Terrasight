import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { AppShell } from "@/components/AppShell";
import { SessionRefresher } from "@/components/SessionRefresher";
import { activeWorkspace, serverGet, type Me } from "@/lib/server-api";
import { ReportsClient } from "./ReportsClient";

interface WorkspaceDetail {
  id: string;
  name: string;
  fieldCount: number;
  isDemo: boolean;
  role: Me["workspaces"][number]["role"];
}

/** Design 15 (agronomist) / 16 (viewer): the Owner report (S-08.02). `?field=` shows one field's items. */
export default async function ReportsPage({ searchParams }: { searchParams: Promise<{ field?: string }> }) {
  const sp = await searchParams;
  const me = await serverGet<Me>("/api/me");
  if (!me.ok) {
    if (me.status === 401) return <SessionRefresher next="/reports" />;
    redirect("/login");
  }
  const active = await activeWorkspace(me.data);
  if (!active) redirect("/onboarding");
  const ws = await serverGet<WorkspaceDetail>(`/api/w/${active.id}`);
  if (!ws.ok) redirect("/");
  const t = await getTranslations("Reports");
  return (
    <AppShell
      workspace={{ name: ws.data.name, fieldCount: ws.data.fieldCount, isDemo: ws.data.isDemo }}
      user={{ name: me.data.name, role: ws.data.role }}
      crumb={t("crumb")}
    >
      <ReportsClient workspaceId={ws.data.id} role={ws.data.role} fieldId={sp.field ?? null} />
    </AppShell>
  );
}
