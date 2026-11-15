import { notFound, redirect } from "next/navigation";
import { AppShell } from "@/components/AppShell";
import { SessionRefresher } from "@/components/SessionRefresher";
import { activeWorkspace, serverGet, type Me } from "@/lib/server-api";
import { ZonesClient, type FieldGeometry } from "./ZonesClient";

interface WorkspaceDetail {
  id: string;
  name: string;
  fieldCount: number;
  role: Me["workspaces"][number]["role"];
}

/** Rate-map zones of a field (PD FR-ZN-1..3): stable zones, latest NDVI, rate form and export. */
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
    serverGet<{ id: string; name: string; areaHa: number; geometry: FieldGeometry }>(
      `/api/w/${active.id}/fields/${id}`,
    ),
  ]);
  if (!ws.ok) redirect("/");
  if (!field.ok) notFound();
  return (
    <AppShell
      workspace={{ id: ws.data.id, name: ws.data.name, fieldCount: ws.data.fieldCount }}
      user={{ name: me.data.name, role: ws.data.role }}
      crumb={field.data.name}
    >
      <ZonesClient
        workspaceId={ws.data.id}
        fieldId={id}
        fieldName={field.data.name}
        geometry={field.data.geometry}
        canEdit
      />
    </AppShell>
  );
}
