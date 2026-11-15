import { notFound, redirect } from "next/navigation";
import { Suspense } from "react";
import { AppShell } from "@/components/AppShell";
import { SessionRefresher } from "@/components/SessionRefresher";
import { activeWorkspace, serverGet, type Me } from "@/lib/server-api";
import { FieldClient, type FieldView } from "./FieldClient";

interface WorkspaceDetail {
  id: string;
  name: string;
  fieldCount: number;
  units: "metric" | "imperial";
  role: Me["workspaces"][number]["role"];
}

/** Design 08 (v5): header and tabs Overview · Season · Plan · Data & history; the tab lives in `?tab=`. */
export default async function FieldPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const me = await serverGet<Me>("/api/me");
  if (!me.ok) {
    if (me.status === 401) return <SessionRefresher next={`/fields/${id}`} />;
    redirect("/login");
  }
  const active = await activeWorkspace(me.data);
  if (!active) redirect("/onboarding");
  const [ws, field] = await Promise.all([
    serverGet<WorkspaceDetail>(`/api/w/${active.id}`),
    serverGet<FieldView>(`/api/w/${active.id}/fields/${id}`),
  ]);
  if (!ws.ok) redirect("/");
  if (!field.ok) notFound();

  return (
    <AppShell
      workspace={{ id: ws.data.id, name: ws.data.name, fieldCount: ws.data.fieldCount }}
      user={{ name: me.data.name, role: ws.data.role }}
      crumb={field.data.name}
    >
      <Suspense>
        <FieldClient workspaceId={ws.data.id} units={ws.data.units} canEdit initial={field.data} />
      </Suspense>
    </AppShell>
  );
}
