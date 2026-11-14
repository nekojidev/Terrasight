import { notFound, redirect } from "next/navigation";
import { AppShell } from "@/components/AppShell";
import { SessionRefresher } from "@/components/SessionRefresher";
import { activeWorkspace, serverGet, type Me } from "@/lib/server-api";
import { ZonesClient } from "./ZonesClient";

interface WorkspaceDetail {
  id: string;
  name: string;
  fieldCount: number;
  isDemo: boolean;
  role: Me["workspaces"][number]["role"];
}

/** Design 11: Zones & yield (FR-ZN-1, FR-YF-1 — a preview in the hackathon) with the field's real work log. */
export default async function ZonesPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const me = await serverGet<Me>("/api/me");
  if (!me.ok) {
    if (me.status === 401) return <SessionRefresher next={`/fields/${id}/zones`} />;
    redirect("/login");
  }
  const active = await activeWorkspace(me.data);
  if (!active) redirect("/onboarding");
  const [ws, field] = await Promise.all([
    serverGet<WorkspaceDetail>(`/api/w/${active.id}`),
    serverGet<{ id: string; name: string }>(`/api/w/${active.id}/fields/${id}`),
  ]);
  if (!ws.ok) redirect("/");
  if (!field.ok) notFound();
  return (
    <AppShell
      workspace={{ name: ws.data.name, fieldCount: ws.data.fieldCount, isDemo: ws.data.isDemo }}
      user={{ name: me.data.name, role: ws.data.role }}
      crumb={field.data.name}
    >
      <ZonesClient workspaceId={ws.data.id} fieldId={id} fieldName={field.data.name} />
    </AppShell>
  );
}
